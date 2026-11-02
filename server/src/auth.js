// Accounts. No default user and no baked-in password: the FIRST visitor creates
// the admin account (/api/auth/setup), which only works while the users table is
// empty. After that, the admin adds people from Settings → Users.
const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const rateLimit = require('express-rate-limit');
const db = require('./db');
const { SESSION_SECRET, COOKIE_NAME, DEMO_LOGIN_EMAIL, DEMO_LOGIN_PASSWORD } = require('./config');

const router = express.Router();
const TTL_S = 7 * 24 * 3600;

const userCount = () => db.prepare('SELECT COUNT(*) AS n FROM users').get().n;
const publicUser = (u) => u && ({ id: u.id, email: u.email, name: u.name, role: u.role });

function issue(res, req, user) {
  const token = jwt.sign({ id: user.id }, SESSION_SECRET, { expiresIn: TTL_S });
  // Secure on HTTPS (incl. behind a TLS proxy — trust proxy is on); plain-HTTP localhost installs still work.
  const secure = req.secure;
  res.cookie(COOKIE_NAME, token, { httpOnly: true, sameSite: 'lax', secure, maxAge: TTL_S * 1000, path: '/' });
}

function userFromToken(token) {
  if (!token) return null;
  try {
    const { id } = jwt.verify(token, SESSION_SECRET);
    return db.prepare('SELECT * FROM users WHERE id = ?').get(id) || null;
  } catch { return null; }
}

function requireAuth(req, res, next) {
  const u = userFromToken(req.cookies?.[COOKIE_NAME]);
  if (!u) return res.status(401).json({ error: 'Sign in first.' });
  req.user = u;
  next();
}
const requireAdmin = (req, res, next) => (req.user?.role === 'admin' ? next() : res.status(403).json({ error: 'Admins only.' }));

function validate({ email, name, password }) {
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email))) return 'Enter a valid email address.';
  if (!name || !String(name).trim()) return 'Enter your name.';
  if (!password || String(password).length < 8) return 'Use a password of at least 8 characters.';
  return null;
}

const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 30, standardHeaders: true, legacyHeaders: false, validate: { xForwardedForHeader: false } });

// Demo login (opt-in via env). The account is created — or its password reset to
// the configured one — at boot, and becomes admin if it is the first account.
const demo = DEMO_LOGIN_EMAIL && DEMO_LOGIN_PASSWORD ? { email: DEMO_LOGIN_EMAIL, password: DEMO_LOGIN_PASSWORD } : null;
if (demo) {
  const hash = bcrypt.hashSync(demo.password, 12);
  const u = db.prepare('SELECT * FROM users WHERE email = ?').get(demo.email);
  if (u) db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hash, u.id);
  else db.prepare('INSERT INTO users (email, name, password_hash, role) VALUES (?,?,?,?)').run(demo.email, 'Demo', hash, userCount() === 0 ? 'admin' : 'user');
  console.log(`[openforge-ai] demo login enabled for ${demo.email}`);
}

router.get('/status', (req, res) => {
  res.json({ needsSetup: userCount() === 0, user: publicUser(userFromToken(req.cookies?.[COOKIE_NAME])), demoLogin: demo });
});

router.post('/setup', authLimiter, (req, res) => {
  if (userCount() > 0) return res.status(409).json({ error: 'OpenForge AI is already set up. Sign in instead.' });
  const err = validate(req.body || {});
  if (err) return res.status(400).json({ error: err });
  const { email, name, password } = req.body;
  const hash = bcrypt.hashSync(String(password), 12);
  // Re-check inside the write so two simultaneous first visitors cannot both become admin.
  const create = db.transaction(() => {
    if (userCount() > 0) return null;
    const r = db.prepare(`INSERT INTO users (email, name, password_hash, role) VALUES (?,?,?,'admin')`).run(String(email).trim(), String(name).trim(), hash);
    return db.prepare('SELECT * FROM users WHERE id = ?').get(r.lastInsertRowid);
  });
  const user = create();
  if (!user) return res.status(409).json({ error: 'OpenForge AI is already set up. Sign in instead.' });
  issue(res, req, user);
  res.status(201).json({ user: publicUser(user) });
});

router.post('/login', authLimiter, (req, res) => {
  const { email, password } = req.body || {};
  const u = email && db.prepare('SELECT * FROM users WHERE email = ?').get(String(email).trim());
  if (!u || !bcrypt.compareSync(String(password || ''), u.password_hash)) return res.status(401).json({ error: 'Wrong email or password.' });
  issue(res, req, u);
  res.json({ user: publicUser(u) });
});

router.post('/logout', (req, res) => { res.clearCookie(COOKIE_NAME, { path: '/' }); res.json({ ok: true }); });

router.get('/me', requireAuth, (req, res) => res.json({ user: publicUser(req.user) }));

router.put('/me', requireAuth, (req, res) => {
  const { name, currentPassword, newPassword } = req.body || {};
  if (name && String(name).trim()) db.prepare('UPDATE users SET name = ? WHERE id = ?').run(String(name).trim(), req.user.id);
  if (newPassword) {
    if (!bcrypt.compareSync(String(currentPassword || ''), req.user.password_hash)) return res.status(400).json({ error: 'Your current password is not right.' });
    if (String(newPassword).length < 8) return res.status(400).json({ error: 'Use a password of at least 8 characters.' });
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(bcrypt.hashSync(String(newPassword), 12), req.user.id);
  }
  res.json({ user: publicUser(db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id)) });
});

// ── admin: people ──
router.get('/users', requireAuth, requireAdmin, (req, res) => {
  res.json({ users: db.prepare('SELECT id, email, name, role, created_at FROM users ORDER BY id').all() });
});
router.post('/users', requireAuth, requireAdmin, (req, res) => {
  const err = validate(req.body || {});
  if (err) return res.status(400).json({ error: err });
  const role = req.body.role === 'admin' ? 'admin' : 'user';
  try {
    const r = db.prepare('INSERT INTO users (email, name, password_hash, role) VALUES (?,?,?,?)')
      .run(String(req.body.email).trim(), String(req.body.name).trim(), bcrypt.hashSync(String(req.body.password), 12), role);
    res.status(201).json({ user: publicUser(db.prepare('SELECT * FROM users WHERE id = ?').get(r.lastInsertRowid)) });
  } catch (e) {
    if (/UNIQUE/.test(e.message)) return res.status(409).json({ error: 'Someone already uses that email.' });
    throw e;
  }
});
router.delete('/users/:id', requireAuth, requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  if (id === req.user.id) return res.status(400).json({ error: 'You cannot remove your own account.' });
  db.prepare('DELETE FROM users WHERE id = ?').run(id);
  res.json({ ok: true });
});

module.exports = { router, requireAuth, requireAdmin, userFromToken };
