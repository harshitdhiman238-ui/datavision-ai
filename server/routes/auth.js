// ---------------------------------------------------------------
// Authentication: register / login / logout / profile
// Passwords hashed with bcrypt; sessions via signed JWT in an
// httpOnly cookie (never readable by frontend JS).
// ---------------------------------------------------------------
const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { db, logActivity } = require('../db');

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET || 'dev-only-secret-change-me';
const COOKIE = 'dv_token';

function setToken(res, user) {
  const token = jwt.sign({ id: user.id, role: user.role }, JWT_SECRET, { expiresIn: '7d' });
  res.cookie(COOKIE, token, { httpOnly: true, sameSite: 'lax', maxAge: 7 * 24 * 3600 * 1000 });
}

// --- middleware ---
function authRequired(req, res, next) {
  const token = req.cookies[COOKIE];
  if (!token) return res.status(401).json({ error: 'Please log in to continue.' });
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    const user = db.prepare('SELECT id, name, email, role, created_at FROM users WHERE id = ?').get(payload.id);
    if (!user) return res.status(401).json({ error: 'Account no longer exists.' });
    req.user = user;
    next();
  } catch {
    return res.status(401).json({ error: 'Your session has expired. Please log in again.' });
  }
}
function adminRequired(req, res, next) {
  authRequired(req, res, () => {
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin access required.' });
    next();
  });
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

router.post('/register', (req, res) => {
  const { name, email, password } = req.body || {};
  if (!name || String(name).trim().length < 2) return res.status(400).json({ error: 'Please enter your full name (at least 2 characters).' });
  if (!email || !EMAIL_RE.test(String(email))) return res.status(400).json({ error: 'Please enter a valid email address.' });
  if (!password || String(password).length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters long.' });
  if (!/[0-9]/.test(password) || !/[A-Za-z]/.test(password)) return res.status(400).json({ error: 'Password must contain both letters and numbers.' });

  const emailLC = String(email).trim().toLowerCase();
  const exists = db.prepare('SELECT id FROM users WHERE email = ?').get(emailLC);
  if (exists) return res.status(409).json({ error: 'An account with this email already exists. Try logging in instead.' });

  const hash = bcrypt.hashSync(String(password), 10);
  const info = db.prepare('INSERT INTO users (name, email, password_hash) VALUES (?,?,?)').run(String(name).trim(), emailLC, hash);
  const user = db.prepare('SELECT id, name, email, role, created_at FROM users WHERE id = ?').get(info.lastInsertRowid);
  setToken(res, user);
  logActivity(user.id, 'register', emailLC);
  res.json({ user });
});

router.post('/login', (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: 'Email and password are required.' });
  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(String(email).trim().toLowerCase());
  if (!user || !bcrypt.compareSync(String(password), user.password_hash)) {
    return res.status(401).json({ error: 'Incorrect email or password.' });
  }
  setToken(res, user);
  logActivity(user.id, 'login', user.email);
  const { password_hash, ...safe } = user;
  res.json({ user: safe });
});

router.post('/logout', (req, res) => {
  res.clearCookie(COOKIE);
  res.json({ ok: true });
});

router.get('/me', authRequired, (req, res) => {
  const projects = db.prepare('SELECT COUNT(*) AS c FROM projects WHERE user_id = ?').get(req.user.id).c;
  res.json({ user: req.user, projectCount: projects });
});

router.put('/me', authRequired, (req, res) => {
  const { name, password, currentPassword } = req.body || {};
  if (name) {
    if (String(name).trim().length < 2) return res.status(400).json({ error: 'Name must be at least 2 characters.' });
    db.prepare('UPDATE users SET name = ? WHERE id = ?').run(String(name).trim(), req.user.id);
  }
  if (password) {
    if (String(password).length < 8 || !/[0-9]/.test(password) || !/[A-Za-z]/.test(password)) {
      return res.status(400).json({ error: 'New password must be 8+ characters with letters and numbers.' });
    }
    const row = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(req.user.id);
    if (!currentPassword || !bcrypt.compareSync(String(currentPassword), row.password_hash)) {
      return res.status(401).json({ error: 'Current password is incorrect.' });
    }
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(bcrypt.hashSync(String(password), 10), req.user.id);
  }
  const user = db.prepare('SELECT id, name, email, role, created_at FROM users WHERE id = ?').get(req.user.id);
  res.json({ user });
});

module.exports = { router, authRequired, adminRequired };
