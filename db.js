/**
 * db.js — PostgreSQL (Render free tier)
 *
 * IMPORTANT: This module requires DATABASE_URL to be set.
 * There is NO silent in-memory fallback — if the database is not
 * configured or not reachable, every call throws loudly so the
 * API never reports "success" for data that wasn't actually saved.
 */

const { Pool } = require('pg');

if (!process.env.DATABASE_URL) {
  throw new Error(
    '[db] DATABASE_URL is not set. ' +
    'On Render: go to your Web Service -> Environment -> "Add from database" ' +
    'and select your PostgreSQL instance. For local dev, copy the External ' +
    'Database URL from Render Postgres dashboard into your .env file.'
  );
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }, // required for Render PostgreSQL
});

let ready = false;

/**
 * Connects, verifies connectivity, and ensures the table exists.
 * MUST be awaited before the server starts accepting requests.
 */
async function init() {
  // 1. Verify we can actually reach the database
  const test = await pool.query('SELECT NOW() AS now');
  console.log(`[db] Connected to PostgreSQL - server time: ${test.rows[0].now}`);

  // 2. Ensure table exists
  await pool.query(`
    CREATE TABLE IF NOT EXISTS waitlist (
      id          TEXT PRIMARY KEY,
      name        TEXT NOT NULL,
      email       TEXT NOT NULL UNIQUE,
      city        TEXT,
      device      TEXT,
      ip          TEXT,
      created_at  TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  // 3. Verify the table is actually queryable (catches permission issues etc.)
  await pool.query('SELECT COUNT(*) FROM waitlist');

  ready = true;
  console.log('[db] Table "waitlist" verified and ready');
}

function assertReady() {
  if (!ready) {
    throw new Error('[db] Database not initialized - init() must complete before queries run.');
  }
}

module.exports = {

  init,

  isReady() {
    return ready;
  },

  async ping() {
    const { rows } = await pool.query('SELECT NOW() AS now');
    return rows[0].now;
  },

  async all() {
    assertReady();
    const { rows } = await pool.query('SELECT * FROM waitlist ORDER BY created_at DESC');
    return rows;
  },

  async count() {
    assertReady();
    const { rows } = await pool.query('SELECT COUNT(*) FROM waitlist');
    return parseInt(rows[0].count, 10);
  },

  async findByEmail(email) {
    assertReady();
    const { rows } = await pool.query('SELECT * FROM waitlist WHERE email = $1', [email]);
    return rows[0] || null;
  },

  /**
   * Inserts a row and returns the row as actually stored in Postgres
   * (via RETURNING). Throws if the insert did not return a row -
   * the caller MUST treat that as a failure, not a success.
   */
  async addEntry(entry) {
    assertReady();
    const { rows } = await pool.query(
      `INSERT INTO waitlist (id, name, email, city, device, ip)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [entry.id, entry.name, entry.email, entry.city, entry.device, entry.ip]
    );

    if (!rows[0]) {
      throw new Error('[db] Insert did not return a row - write was not confirmed.');
    }

    return rows[0];
  },

  async removeById(id) {
    assertReady();
    const { rowCount } = await pool.query('DELETE FROM waitlist WHERE id = $1', [id]);
    return rowCount > 0;
  },
};
