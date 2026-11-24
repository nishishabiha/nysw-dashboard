'use strict';
/* NYSW Partner School Success Dashboard — hosted server.
   Zero npm dependencies (Node 20+). Storage: JSON files in DATA_DIR (mount a Railway volume there). */
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const zlib = require('zlib');
const Engine = require('./engine.js');

const PORT = +process.env.PORT || 3000;
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'storage');
const PUBLIC = path.join(__dirname, 'public');
const SESSION_DAYS = 7;
fs.mkdirSync(DATA_DIR, { recursive: true });

/* ---------- storage ---------- */
const STORE_FILE = path.join(DATA_DIR, 'store.json');
const DATA_FILE = path.join(DATA_DIR, 'data.json');
function atomicWrite(file, text) {
  const tmp = file + '.' + process.pid + '.tmp';
  fs.writeFileSync(tmp, text);
  fs.renameSync(tmp, file);
}
let dataJson = null; // parsed school data
function loadData() {
  if (!fs.existsSync(DATA_FILE)) {
    const seed = path.join(__dirname, 'seed', 'data.json');
    if (!fs.existsSync(seed)) { console.error('No data.json found (storage/ or seed/).'); process.exit(1); }
    fs.copyFileSync(seed, DATA_FILE);
  }
  dataJson = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  dataGz = null;
}
let dataGz = null;

let store;
function hashPw(pw) {
  const salt = crypto.randomBytes(16);
  const h = crypto.scryptSync(pw, salt, 64);
  return salt.toString('hex') + ':' + h.toString('hex');
}
function checkPw(pw, stored) {
  if (!stored) return false;
  const [s, h] = stored.split(':');
  const x = crypto.scryptSync(pw, Buffer.from(s, 'hex'), 64);
  return crypto.timingSafeEqual(x, Buffer.from(h, 'hex'));
}
const persist = () => atomicWrite(STORE_FILE, JSON.stringify(store));
const uid = () => crypto.randomBytes(8).toString('hex');

function initStore() {
  if (fs.existsSync(STORE_FILE)) { store = JSON.parse(fs.readFileSync(STORE_FILE, 'utf8')); }
  else store = { secret: crypto.randomBytes(32).toString('hex'), users: [], notes: {}, ov: {}, alerts: {}, rubrics: [], audit: [], mail: {} };
  if (!store.rubrics.length) {
    const eng = Engine.create(dataJson, () => ({ rubrics: [] }));
    store.rubrics.push({ v: 1, ts: new Date().toISOString(), by: 'System default', note: 'Starting rubric (redesigned from Area Manager feedback, Nov 2026)', cfg: eng.DEFAULT_CFG });
  }
  if (!store.users.length) {
    const email = (process.env.ADMIN_EMAIL || '').trim().toLowerCase();
    let pw = process.env.ADMIN_PASSWORD, generated = false;
    if (!email) { console.error('Set ADMIN_EMAIL (and ADMIN_PASSWORD) to create the first admin.'); process.exit(1); }
    if (!pw) { pw = crypto.randomBytes(9).toString('base64url'); generated = true; }
    store.users.push({ id: uid(), email, name: process.env.ADMIN_NAME || 'Admin', role: 'admin', am: null, active: true, hash: hashPw(pw), mustChange: true, sessVer: 1, created: new Date().toISOString() });
    console.log(`\n=== First admin created: ${email} ===`);
    if (generated) console.log(`Temporary password (shown once): ${pw}`);
    console.log('You will be asked to choose a new password at first sign-in.\n');
  }
  persist();
}
function audit(by, action, target, detail) {
  store.audit.push({ ts: new Date().toISOString(), by: by ? by.name : 'system', action, target: target || '', detail: detail || '' });
  if (store.audit.length > 5000) store.audit.splice(0, store.audit.length - 5000);
}

/* ---------- auth ---------- */
const b64 = b => Buffer.from(b).toString('base64url');
function sign(payload) {
  const p = b64(JSON.stringify(payload));
  return p + '.' + crypto.createHmac('sha256', store.secret).update(p).digest('base64url');
}
function verify(tok) {
  if (!tok || !tok.includes('.')) return null;
  const [p, s] = tok.split('.');
  const exp = crypto.createHmac('sha256', store.secret).update(p).digest('base64url');
  const a = Buffer.from(s), b = Buffer.from(exp);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try { const o = JSON.parse(Buffer.from(p, 'base64url').toString()); return o.exp > Date.now() ? o : null; } catch { return null; }
}
function parseCookies(req) {
  const o = {};
  (req.headers.cookie || '').split(';').forEach(c => { const i = c.indexOf('='); if (i > 0) o[c.slice(0, i).trim()] = decodeURIComponent(c.slice(i + 1).trim()); });
  return o;
}
function currentUser(req) {
  const t = verify(parseCookies(req).sid);
  if (!t) return null;
  const u = store.users.find(x => x.id === t.u);
  if (!u || !u.active || u.sessVer !== t.v) return null;
  return u;
}
const isHttps = req => req.headers['x-forwarded-proto'] === 'https' || !!req.socket.encrypted;
function setSession(req, res, u) {
  const tok = sign({ u: u.id, v: u.sessVer, exp: Date.now() + SESSION_DAYS * 864e5 });
  res.setHeader('Set-Cookie', `sid=${encodeURIComponent(tok)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${SESSION_DAYS * 86400}${isHttps(req) ? '; Secure' : ''}`);
}
const pubUser = u => ({ id: u.id, email: u.email, name: u.name, role: u.role, am: u.am, mustChange: !!u.mustChange });
const attempts = new Map();
function throttled(key) {
  const now = Date.now(), a = (attempts.get(key) || []).filter(t => now - t < 15 * 60e3);
  attempts.set(key, a);
  return a.length >= 8;
}
const noteFail = key => { const a = attempts.get(key) || []; a.push(Date.now()); attempts.set(key, a); };

/* ---------- http helpers ---------- */
function send(res, code, obj, headers) {
  const body = JSON.stringify(obj);
  res.writeHead(code, Object.assign({ 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }, headers || {}));
  res.end(body);
}
function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    let n = 0; const chunks = [];
    req.on('data', c => { n += c.length; if (n > limit) { reject(Object.assign(new Error('Payload too large'), { status: 413 })); req.destroy(); } else chunks.push(c); });
    req.on('end', () => { try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : {}); } catch { reject(Object.assign(new Error('Invalid JSON'), { status: 400 })); } });
    req.on('error', reject);
  });
}
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css', '.png': 'image/png', '.ico': 'image/x-icon', '.svg': 'image/svg+xml' };
const SEC = {
  'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'same-origin',
  'Content-Security-Policy': "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'"
};
function serveStatic(req, res) {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (p === '/') p = '/index.html';
  const file = path.normalize(path.join(PUBLIC, p));
  if (!file.startsWith(PUBLIC) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404, SEC); return res.end('Not found'); }
  res.writeHead(200, Object.assign({ 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' }, SEC));
  fs.createReadStream(file).pipe(res);
}

/* ---------- validation ---------- */
const str = (v, max, name) => { if (typeof v !== 'string') throw Object.assign(new Error(name + ' is required'), { status: 400 }); v = v.trim(); if (!v || v.length > max) throw Object.assign(new Error(name + ' must be 1–' + max + ' characters'), { status: 400 }); return v; };
const fail = (status, msg) => { throw Object.assign(new Error(msg), { status }); };
const needSchool = code => { if (typeof code !== 'string' || !dataJson.schools[code]) fail(400, 'Unknown school'); return code; };
const ROLES = ['admin', 'staff', 'viewer'];
const NOTE_TYPES = ['General', 'Principal', 'Teacher change', 'Principal change', 'Follow-up', 'Harvest', 'Maintenance'];
const ALERT_STATUS = ['ack', 'snoozed', 'resolved', 'reopen'];
function validateCfg(cfg) {
  if (!cfg || !Array.isArray(cfg.kpis) || !cfg.settings) fail(400, 'Invalid rubric');
  let tot = 0;
  for (const k of cfg.kpis) {
    if (typeof k.id !== 'string' || !isFinite(+k.w) || +k.w < 0 || !isFinite(+k.floor) || !isFinite(+k.target)) fail(400, 'Invalid value in ' + k.id);
    if (k.on) tot += +k.w;
  }
  if (Math.abs(tot - 100) > 1e-6) fail(400, `Points must total 100 (got ${tot})`);
  const b = cfg.settings.bands || {};
  if (!(b.A > b.B && b.B > b.C && b.C > b.D)) fail(400, 'Grade bands must descend A > B > C > D');
}

/* ---------- mail ---------- */
const mailOn = () => !!(process.env.RESEND_API_KEY && process.env.MAIL_FROM);
async function sendMail(to, subject, text) {
  const r = await fetch('https://api.resend.com/emails', { method: 'POST', headers: { Authorization: 'Bearer ' + process.env.RESEND_API_KEY, 'Content-Type': 'application/json' }, body: JSON.stringify({ from: process.env.MAIL_FROM, to: [to], subject, text }) });
  if (!r.ok) throw new Error('Mail provider error ' + r.status);
}
async function sendDigests(onlyUser) {
  const eng = Engine.create(dataJson, () => store);
  const R = eng.computeAll();
  const base = process.env.PUBLIC_URL || '';
  let sent = 0;
  for (const u of store.users.filter(x => x.active && x.am && (!onlyUser || x.id === onlyUser.id))) {
    const d = eng.digestTextFor(R, onlyUser ? onlyUser.am || u.am : u.am, base);
    if (!d.n) continue;
    await sendMail(u.email, d.subject, d.body); sent++;
  }
  return sent;
}
function nyNow() {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', weekday: 'short', hour: 'numeric', hour12: false, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date()).map(x => [x.type, x.value]));
  return p;
}
function scheduler() {
  setInterval(async () => {
    if (!mailOn()) return;
    const n = nyNow(), day = `${n.year}-${n.month}-${n.day}`;
    if (n.weekday === 'Mon' && +n.hour === 7 && store.mail.lastDay !== day) {
      store.mail.lastDay = day;
      try { const c = await sendDigests(); store.mail.last = `${day} (${c} sent)`; audit(null, 'digest.auto', '', c + ' emails'); }
      catch (e) { store.mail.last = day + ' failed: ' + e.message; }
      persist();
    }
  }, 10 * 60e3);
}

/* ---------- routes ---------- */
async function handle(req, res) {
  const url = new URL(req.url, 'http://x');
  const p = url.pathname;
  if (!p.startsWith('/api/')) return serveStatic(req, res);
  const m = req.method;
  if (m !== 'GET' && req.headers['x-requested-with'] !== 'nysw') return send(res, 403, { error: 'Bad request' });

  if (p === '/api/login' && m === 'POST') {
    const b = await readBody(req, 4e3);
    const email = String(b.email || '').trim().toLowerCase(), key = (req.socket.remoteAddress || '') + '|' + email;
    if (throttled(key)) return send(res, 429, { error: 'Too many attempts. Try again in 15 minutes.' });
    const u = store.users.find(x => x.email === email);
    const ok = u && u.active && checkPw(String(b.password || ''), u.hash);
    if (!ok) { noteFail(key); if (!u) crypto.scryptSync('x', 'y', 64); return send(res, 401, { error: 'Incorrect email or password.' }); }
    u.lastLogin = new Date().toISOString(); audit(u, 'login'); persist();
    setSession(req, res, u);
    return send(res, 200, pubUser(u));
  }
  if (p === '/api/logout' && m === 'POST') {
    res.setHeader('Set-Cookie', 'sid=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0');
    return send(res, 200, { ok: true });
  }
  const me = currentUser(req);
  if (!me) return send(res, 401, { error: 'Not signed in' });
  if (p === '/api/me' && m === 'GET') return send(res, 200, pubUser(me));
  if (p === '/api/password' && m === 'POST') {
    const b = await readBody(req, 4e3);
    if (!checkPw(String(b.current || ''), me.hash)) return send(res, 400, { error: 'Current password is incorrect.' });
    const n = String(b.next || '');
    if (n.length < 10) return send(res, 400, { error: 'New password must be at least 10 characters.' });
    if (n === b.current) return send(res, 400, { error: 'Choose a different password.' });
    me.hash = hashPw(n); me.mustChange = false; me.sessVer++; audit(me, 'password.change'); persist();
    setSession(req, res, me);
    return send(res, 200, { ok: true });
  }
  if (me.mustChange) return send(res, 403, { error: 'Change your password first', mustChange: true });

  const edit = () => { if (me.role === 'viewer') fail(403, 'Your role is read-only.'); };
  const admin = () => { if (me.role !== 'admin') fail(403, 'Admins only.'); };
  const state = () => ({ notes: store.notes, ov: store.ov, alerts: store.alerts, rubrics: store.rubrics });

  if (p === '/api/data' && m === 'GET') {
    if (!dataGz) dataGz = zlib.gzipSync(JSON.stringify(dataJson));
    res.writeHead(200, { 'Content-Type': 'application/json', 'Content-Encoding': 'gzip', 'Cache-Control': 'no-store' });
    return res.end(dataGz);
  }
  if (p === '/api/state' && m === 'GET') return send(res, 200, state());

  if (m === 'POST') {
    const b = await readBody(req, p === '/api/admin/data' ? 40e6 : 64e3);
    if (p === '/api/note') {
      edit(); const code = needSchool(b.code);
      const text = str(b.text, 4000, 'Note');
      const type = NOTE_TYPES.includes(b.type) ? b.type : 'General';
      const due = /^\d{4}-\d{2}-\d{2}$/.test(b.due || '') ? b.due : null;
      (store.notes[code] = store.notes[code] || []).push({ id: 'n' + uid(), ts: new Date().toISOString(), by: me.name, byId: me.id, type, text, due, pin: !!b.pin });
      audit(me, 'note.add', code, type); persist(); return send(res, 200, { state: state() });
    }
    if (p === '/api/note/pin') {
      edit(); const n = (store.notes[needSchool(b.code)] || []).find(x => x.id === b.id); if (!n) fail(404, 'Note not found');
      n.pin = !n.pin; audit(me, 'note.pin', b.code); persist(); return send(res, 200, { state: state() });
    }
    if (p === '/api/note/delete') {
      edit(); const code = needSchool(b.code), list = store.notes[code] || [], n = list.find(x => x.id === b.id);
      if (!n) fail(404, 'Note not found');
      if (me.role !== 'admin' && n.byId !== me.id) fail(403, 'You can only delete your own notes.');
      store.notes[code] = list.filter(x => x.id !== b.id); audit(me, 'note.delete', code, n.text.slice(0, 80)); persist(); return send(res, 200, { state: state() });
    }
    if (p === '/api/override') {
      edit(); const code = needSchool(b.code), o = (store.ov[code] = store.ov[code] || {});
      if ('am' in b) { if (b.am === null) delete o.am; else o.am = str(b.am, 40, 'AM'); audit(me, 'assign.am', code, b.am || '(cleared)'); }
      if ('excl' in b) { if (b.excl) o.excl = true; else delete o.excl; audit(me, b.excl ? 'school.hide' : 'school.restore', code); }
      if (!Object.keys(o).length) delete store.ov[code];
      persist(); return send(res, 200, { state: state() });
    }
    if (p === '/api/alert') {
      edit(); const code = needSchool(b.code), rule = str(b.rule, 30, 'rule'), k = code + '|' + rule;
      if (!ALERT_STATUS.includes(b.status)) fail(400, 'Bad status');
      if (b.status === 'reopen') delete store.alerts[k];
      else store.alerts[k] = { status: b.status === 'ack' ? 'ack' : b.status, sig: str(String(b.sig), 200, 'sig'), by: me.name, at: new Date().toISOString(), until: /^\d{4}-\d{2}-\d{2}$/.test(b.until || '') ? b.until : null };
      audit(me, 'alert.' + b.status, code, rule); persist(); return send(res, 200, { state: state() });
    }
    if (p === '/api/rubric') {
      admin(); validateCfg(b.cfg); const note = str(b.note, 500, 'Reason');
      store.rubrics.push({ v: store.rubrics.length + 1, ts: new Date().toISOString(), by: me.name, note, cfg: b.cfg });
      audit(me, 'rubric.save', 'v' + store.rubrics.length, note); persist(); return send(res, 200, { state: state() });
    }
    if (p === '/api/admin/users') {
      admin(); const email = str(b.email, 120, 'Email').toLowerCase(), name = str(b.name, 80, 'Name');
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) fail(400, 'Invalid email');
      if (!ROLES.includes(b.role)) fail(400, 'Invalid role');
      if (String(b.password || '').length < 10) fail(400, 'Temporary password must be 10+ characters');
      if (store.users.some(x => x.email === email)) fail(409, 'That email already has an account');
      store.users.push({ id: uid(), email, name, role: b.role, am: b.am || null, active: true, hash: hashPw(b.password), mustChange: true, sessVer: 1, created: new Date().toISOString() });
      audit(me, 'user.add', email, b.role); persist(); return send(res, 200, { ok: true });
    }
    if (p === '/api/admin/users/update') {
      admin(); const u = store.users.find(x => x.id === b.id); if (!u) fail(404, 'User not found');
      const next = Object.assign({}, u);
      if ('role' in b) { if (!ROLES.includes(b.role)) fail(400, 'Invalid role'); next.role = b.role; }
      if ('am' in b) next.am = b.am || null;
      if ('active' in b) next.active = !!b.active;
      if (!store.users.some(x => (x.id === u.id ? next : x).role === 'admin' && (x.id === u.id ? next : x).active)) fail(400, 'There must be at least one active admin.');
      if (b.password) { if (String(b.password).length < 10) fail(400, 'Password must be 10+ characters'); next.hash = hashPw(b.password); next.mustChange = true; }
      Object.assign(u, next);
      u.sessVer++; // force re-login after any change
      if (u.id === me.id) setSession(req, res, u);
      audit(me, 'user.update', u.email, Object.keys(b).filter(k => k !== 'id' && k !== 'password').join(',') + (b.password ? ' +password' : ''));
      persist(); return send(res, 200, { ok: true });
    }
    if (p === '/api/admin/data') {
      admin();
      if (!b.schools || typeof b.schools !== 'object' || !b.meta || !b.meta.asOf || !b.meta.evalThrough) fail(400, 'That does not look like a data.json from the pipeline.');
      const n = Object.keys(b.schools).length; if (n < 50) fail(400, 'Only ' + n + ' schools in file — refusing to upload.');
      fs.copyFileSync(DATA_FILE, DATA_FILE + '.prev');
      atomicWrite(DATA_FILE, JSON.stringify(b)); loadData();
      audit(me, 'data.upload', '', `${n} schools, as of ${b.meta.asOf}`); persist(); return send(res, 200, { ok: true, schools: n });
    }
    if (p === '/api/admin/digest') {
      admin(); if (!mailOn()) fail(400, 'Email is not configured on the server.');
      if (!me.am && !b.all) fail(400, 'Set a “Digest for AM” on your own user first, or send to all.');
      const c = await sendDigests(b.all ? null : me); audit(me, 'digest.send', b.all ? 'all' : 'self', c + ' emails'); persist();
      return send(res, 200, { sent: c });
    }
  }
  if (m === 'GET') {
    if (p === '/api/admin/users') { admin(); return send(res, 200, store.users.map(u => ({ id: u.id, email: u.email, name: u.name, role: u.role, am: u.am, active: u.active, lastLogin: u.lastLogin || null }))); }
    if (p === '/api/admin/audit') { admin(); const lim = Math.min(500, +url.searchParams.get('limit') || 100); return send(res, 200, store.audit.slice(-lim).reverse()); }
    if (p === '/api/admin/mail') { admin(); return send(res, 200, { configured: mailOn(), last: store.mail.last || null }); }
    if (p === '/api/admin/backup') {
      admin();
      const copy = Object.assign({}, store, { secret: undefined, users: store.users.map(u => ({ ...u, hash: undefined, sessVer: undefined })) });
      res.writeHead(200, { 'Content-Type': 'application/json', 'Content-Disposition': `attachment; filename="nysw-backup-${new Date().toISOString().slice(0, 10)}.json"` });
      return res.end(JSON.stringify(copy, null, 1));
    }
  }
  send(res, 404, { error: 'Not found' });
}

loadData();
initStore();
const server = http.createServer((req, res) => {
  handle(req, res).catch(e => {
    if (!res.headersSent) send(res, e.status || 500, { error: e.status ? e.message : 'Server error' });
    if (!e.status) console.error(e);
  });
});
server.listen(PORT, () => console.log('Dashboard listening on :' + PORT + ' (data: ' + DATA_DIR + ')'));
scheduler();
