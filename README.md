# CloudPlay — Phase 1

Landing page + waitlist backend. Uses PostgreSQL on Render (free).

## Project structure

```
cloudplay/
├── index.html    ← landing page (deployed on Vercel)
├── server.js     ← Express API (deployed on Render)
├── db.js         ← PostgreSQL database layer
├── package.json
└── .env.example  ← copy to .env for local dev
```

## IMPORTANT — database is required, no fallback

`db.js` requires `DATABASE_URL` to be set. There is **no in-memory
fallback**. If the database isn't reachable, the server refuses to
start — this guarantees that "registration successful" always means
the row is actually in PostgreSQL.

## Local dev

```bash
npm install
cp .env.example .env
```

To run locally you need a real Postgres connection string in `.env`:
- Easiest: use Render's free Postgres and copy the **External Database
  URL** from its dashboard into `DATABASE_URL` in `.env`
- Or run a local Postgres / Docker container and use its connection string

```bash
npm run dev
# → http://localhost:3000
```

If `DATABASE_URL` is missing or wrong, the server will print a clear
error and exit — it will NOT silently run without a database.

## Deploy backend to Render

1. Push to GitHub
2. render.com → New → Web Service → connect repo
3. Build command : npm install
4. Start command : node server.js
5. Create the database FIRST:
   render.com → New → PostgreSQL → Free tier → Create
6. Go to your Web Service → Environment:
   - Click "Add from database" → select your Postgres instance
     → this adds `DATABASE_URL` automatically
   - Add `ADMIN_SECRET` → any password you choose
   - Add `FRONTEND_URL` → your Vercel URL (or `*` for now)
7. Save → Render redeploys

## Deploy frontend to Vercel

Just drag and drop index.html into vercel.com
Or connect GitHub and point to the frontend folder.

## Verify it's actually working

**1. Check /health — this is the source of truth:**
```
https://YOUR_RENDER_URL/health
```
Should return:
```json
{ "status": "ok", "database": "connected", "dbTime": "...", "entries": 0, "uptime": ... }
```
If `database` is NOT `"connected"`, registrations cannot succeed —
the server would have refused to start. If you see this, check that
`DATABASE_URL` is set in Render's Environment tab.

**2. Submit a test registration on your landing page**

**3. Confirm it's in the database:**
```
https://YOUR_RENDER_URL/api/admin/entries?secret=YOUR_ADMIN_SECRET
```
Your test entry should appear here. If the count increased and your
entry is listed, it is genuinely stored in PostgreSQL.

**4. Download as CSV anytime:**
```
https://YOUR_RENDER_URL/api/admin/export.csv?secret=YOUR_ADMIN_SECRET
```

## Troubleshooting: "registration succeeds but I don't see it in the DB"

This should no longer be possible with the current code, because:
- The server won't start without a verified DB connection (no silent fallback)
- Every registration does an INSERT ... RETURNING, then a separate
  SELECT to confirm the row exists, before returning success

If you still see this:
- Check Render logs for `[db]` and `[waitlist]` lines — every
  registration logs `[waitlist] Confirmed signup #N: email - id=...`
- Make sure you're checking the SAME database — if you created a
  second Postgres instance, `DATABASE_URL` may point to a different
  one than the one you're viewing in Render's dashboard
- Hit `/health` and confirm `entries` count matches what you expect

## Troubleshooting: "could not reach server" on the frontend

This means Render's deploy crashed or never started. Common causes:

1. **Syntax errors from unresolved git merge conflicts.** Open
   `db.js` and `server.js` and search for `<<<<<<<`, `=======`, or
   `>>>>>>>`. If found, the file is invalid JavaScript and Node will
   crash immediately on `require('./db')`. Resolve all conflicts
   before pushing.
2. **`DATABASE_URL` missing on Render** — server exits on startup
   (see above). Check the Render deploy logs for the FATAL message.
3. **`BACKEND_URL` in `index.html` still set to the placeholder**
   `https://YOUR_APP.onrender.com`. Update it to your real Render URL.

Always check the Render **Logs** tab first — a crashed deploy shows
the exact error (including SyntaxError with a line number) within
seconds of deploy.
