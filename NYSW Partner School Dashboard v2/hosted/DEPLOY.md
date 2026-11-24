# Deploying the hosted dashboard (Railway)

Zero npm dependencies; needs Node 20+. Data lives in JSON files under `DATA_DIR`, so **attach a Railway Volume**.

1. Push the `hosted/` folder as its own repo (or set it as the service root directory).
2. In Railway: New Project → Deploy from repo. It auto-detects Node (`npm start`).
3. Add a **Volume** mounted at `/data`.
4. Variables:
   | Name | Value |
   |---|---|
   | `DATA_DIR` | `/data` |
   | `ADMIN_EMAIL` | your email (first admin) |
   | `ADMIN_PASSWORD` | a temporary password (10+ chars); you are forced to change it at first sign-in. If omitted, one is printed once in the deploy logs. |
   | `PUBLIC_URL` | e.g. `https://your-app.up.railway.app` (used in email links) |
   | `RESEND_API_KEY`, `MAIL_FROM` | optional; enables Monday 7am ET digests to users who have a "Digest for AM" |
5. Open the URL, sign in, then Admin tab → add staff/viewers.
6. **Remove `ADMIN_PASSWORD`** from the variables after first sign-in.

## Refreshing data
Run the pipeline on new Accelo exports (`pipeline/`), which writes `data.json`. Upload it in **Admin → Data**. Notes, alerts and rubric versions are kept. The previous file is saved as `data.json.prev`.

## Roles
- admin: everything (rubric, users, data, audit, backup)
- staff: notes, alert actions, AM reassignment, hide/restore schools
- viewer: read-only

## Security notes
Passwords are scrypt-hashed; sessions are signed HttpOnly cookies (7 days); 8 failed sign-ins per 15 min per IP+email are throttled; all writes are in the audit trail. Back up via Admin → Backup (or snapshot the volume).
