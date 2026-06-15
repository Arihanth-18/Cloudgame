require('dotenv').config();

const express   = require('express');
const cors      = require('cors');
const path      = require('path');
const rateLimit = require('express-rate-limit');
const { v4: uuidv4 } = require('uuid');
const db        = require('./db');

const app  = express();
const PORT = process.env.PORT || 3000;

/* ── Middleware ──────────────────────────────────────────── */
app.use(express.json());
app.use(cors({
  origin: process.env.FRONTEND_URL || '*',
  methods: ['GET', 'POST', 'DELETE'],
}));
app.use(express.static(path.join(__dirname)));

const waitlistLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, max: 10,
  message: { success: false, message: 'Too many requests. Please try again later.' },
});

const adminLimiter = rateLimit({
  windowMs: 60 * 1000, max: 30,
  message: { success: false, message: 'Too many requests.' },
});

/* ── Helpers ─────────────────────────────────────────────── */
function validateEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email).toLowerCase());
}

function sanitize(str, maxLen = 200) {
  if (typeof str !== 'string') return '';
  return str.trim().slice(0, maxLen);
}

function isAdmin(req) {
  const secret = req.query.secret || req.headers['x-admin-secret'];
  return process.env.ADMIN_SECRET && secret === process.env.ADMIN_SECRET;
}

/* ── POST /api/waitlist ──────────────────────────────────── */
app.post('/api/waitlist', waitlistLimiter, async (req, res) => {
  try {
    const { name, email, city, device } = req.body;

    if (!name || !email || !city || !device) {
      return res.status(400).json({ success: false, message: 'All fields are required.' });
    }
    if (!validateEmail(email)) {
      return res.status(400).json({ success: false, message: 'Invalid email address.' });
    }

    const cleanEmail  = sanitize(email, 254).toLowerCase();
    const cleanName   = sanitize(name, 100);
    const cleanCity   = sanitize(city, 100);
    const cleanDevice = sanitize(device, 200);

    const existing = await db.findByEmail(cleanEmail);
    if (existing) {
      return res.status(409).json({ success: false, message: 'You are already on the waitlist!' });
    }

    const entry = {
      id:        uuidv4(),
      name:      cleanName,
      email:     cleanEmail,
      city:      cleanCity,
      device:    cleanDevice,
      ip:        req.ip,
    };

    // 1. Insert and get back the row Postgres actually stored
    const saved = await db.addEntry(entry);

    // 2. Verify it independently with a fresh read-back from the DB.
    //    Only if this confirms the row exists do we report success.
    const verify = await db.findByEmail(cleanEmail);
    if (!verify || verify.id !== entry.id) {
      console.error(`[waitlist] VERIFY FAILED for ${cleanEmail} - row not found after insert`);
      return res.status(500).json({
        success: false,
        message: 'Could not confirm your registration was saved. Please try again.',
      });
    }

    const position = await db.count();
    console.log(`[waitlist] Confirmed signup #${position}: ${cleanEmail} (${cleanCity}) - id=${saved.id}`);

    return res.status(201).json({
      success:  true,
      message:  'You have been added to the waitlist!',
      position,
    });
  } catch (err) {
    console.error('[waitlist] Error:', err.message);
    return res.status(500).json({ success: false, message: 'Something went wrong. Please try again.' });
  }
});

/* ── GET /api/waitlist/count ─────────────────────────────── */
app.get('/api/waitlist/count', async (req, res) => {
  try {
    const count = await db.count();
    res.json({ success: true, count });
  } catch (err) {
    console.error('[waitlist/count] Error:', err.message);
    res.status(500).json({ success: false, count: 0 });
  }
});

/* ── GET /api/admin/entries ──────────────────────────────── */
app.get('/api/admin/entries', adminLimiter, async (req, res) => {
  if (!isAdmin(req)) return res.status(401).json({ success: false, message: 'Unauthorized.' });

  try {
    const entries  = await db.all();
    const page     = Math.max(1, parseInt(req.query.page) || 1);
    const pageSize = Math.min(100, parseInt(req.query.limit) || 50);
    const start    = (page - 1) * pageSize;
    const slice    = entries.slice(start, start + pageSize);

    res.json({
      success: true, total: entries.length, page, pageSize,
      entries: slice.map(e => ({
        id: e.id, name: e.name, email: e.email,
        city: e.city, device: e.device, createdAt: e.created_at,
      })),
    });
  } catch (err) {
    console.error('[admin/entries] Error:', err.message);
    res.status(500).json({ success: false, message: 'Failed to fetch entries.' });
  }
});

/* ── GET /api/admin/export.csv ───────────────────────────── */
app.get('/api/admin/export.csv', adminLimiter, async (req, res) => {
  if (!isAdmin(req)) return res.status(401).json({ success: false, message: 'Unauthorized.' });

  try {
    const entries = await db.all();
    const header  = 'id,name,email,city,device,createdAt\n';
    const rows    = entries.map(e =>
      [e.id, e.name, e.email, e.city, `"${(e.device||'').replace(/"/g,'""')}"`, e.created_at].join(',')
    ).join('\n');

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="cloudplay-waitlist.csv"');
    res.send(header + rows);
  } catch (err) {
    console.error('[admin/export] Error:', err.message);
    res.status(500).json({ success: false, message: 'Export failed.' });
  }
});

/* ── DELETE /api/admin/entries/:id ──────────────────────── */
app.delete('/api/admin/entries/:id', adminLimiter, async (req, res) => {
  if (!isAdmin(req)) return res.status(401).json({ success: false, message: 'Unauthorized.' });

  try {
    const removed = await db.removeById(req.params.id);
    if (!removed) return res.status(404).json({ success: false, message: 'Entry not found.' });
    res.json({ success: true, message: 'Entry removed.' });
  } catch (err) {
    console.error('[admin/delete] Error:', err.message);
    res.status(500).json({ success: false, message: 'Delete failed.' });
  }
});

/* ── Health check — shows real DB connectivity ───────────── */
app.get('/health', async (req, res) => {
  try {
    const now   = await db.ping();
    const count = await db.count();
    res.json({
      status: 'ok',
      database: 'connected',
      dbTime: now,
      entries: count,
      uptime: process.uptime(),
    });
  } catch (err) {
    res.status(503).json({
      status: 'error',
      database: 'disconnected',
      message: err.message,
      uptime: process.uptime(),
    });
  }
});

/* ── SPA fallback ────────────────────────────────────────── */
app.get('/{*path}', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

/* ── Start — only after DB is verified ready ─────────────── */
async function start() {
  try {
    console.log('[startup] Connecting to database...');
    await db.init();
  } catch (err) {
    console.error('\n  FATAL: Could not connect to database.');
    console.error(`  ${err.message}\n`);
    console.error('  The server will NOT start, because without a verified');
    console.error('  database connection, registrations could appear to');
    console.error('  succeed without actually being saved.\n');
    process.exit(1);
  }

  app.listen(PORT, () => {
    console.log(`\n  ┌─────────────────────────────────────────┐`);
    console.log(`  │  CloudPlay is running                    │`);
    console.log(`  │  http://localhost:${PORT}                    │`);
    console.log(`  │  Database: connected                     │`);
    console.log(`  └─────────────────────────────────────────┘\n`);
  });
}

start();
