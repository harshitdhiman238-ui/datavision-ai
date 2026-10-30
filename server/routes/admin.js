// ---------------------------------------------------------------
// Admin-only area: usage statistics + user management.
// Never returns password hashes or other users' dataset contents.
// ---------------------------------------------------------------
const express = require('express');
const { db, deleteDatasets, logActivity } = require('../db');
const { adminRequired } = require('./auth');

const router = express.Router();
router.use(adminRequired);

router.get('/stats', (req, res) => {
  const users = db.prepare('SELECT COUNT(*) c FROM users').get().c;
  const admins = db.prepare("SELECT COUNT(*) c FROM users WHERE role='admin'").get().c;
  const projects = db.prepare('SELECT COUNT(*) c FROM projects').get().c;
  const rowsStored = db.prepare('SELECT COALESCE(SUM(row_count),0) s FROM projects').get().s;
  const uploads7d = db.prepare("SELECT COUNT(*) c FROM activity_log WHERE action='upload' AND created_at >= datetime('now','-7 days')").get().c;
  const logins7d = db.prepare("SELECT COUNT(*) c FROM activity_log WHERE action='login' AND created_at >= datetime('now','-7 days')").get().c;
  const signupsByDay = db.prepare("SELECT date(created_at) d, COUNT(*) c FROM users GROUP BY date(created_at) ORDER BY d DESC LIMIT 14").all().reverse();
  const recent = db.prepare(`SELECT a.action, a.detail, a.created_at, u.email FROM activity_log a LEFT JOIN users u ON u.id=a.user_id ORDER BY a.id DESC LIMIT 25`).all();
  res.json({ users, admins, projects, rowsStored, uploads7d, logins7d, signupsByDay, recent });
});

router.get('/users', (req, res) => {
  const users = db.prepare(`
    SELECT u.id, u.name, u.email, u.role, u.created_at,
           (SELECT COUNT(*) FROM projects p WHERE p.user_id = u.id) AS project_count
    FROM users u ORDER BY u.id`).all();
  res.json({ users });
});

router.put('/users/:id/role', (req, res) => {
  const target = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
  if (!target) return res.status(404).json({ error: 'User not found.' });
  const role = req.body.role === 'admin' ? 'admin' : 'user';
  if (target.id === req.user.id && role !== 'admin') return res.status(400).json({ error: 'You cannot remove your own admin role.' });
  db.prepare('UPDATE users SET role = ? WHERE id = ?').run(role, target.id);
  logActivity(req.user.id, 'role_change', `${target.email} → ${role}`);
  res.json({ ok: true });
});

router.delete('/users/:id', (req, res) => {
  const target = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
  if (!target) return res.status(404).json({ error: 'User not found.' });
  if (target.id === req.user.id) return res.status(400).json({ error: 'You cannot delete your own account from the admin panel.' });
  const projects = db.prepare('SELECT id FROM projects WHERE user_id = ?').all(target.id);
  for (const p of projects) deleteDatasets(p.id);
  db.prepare('DELETE FROM projects WHERE user_id = ?').run(target.id);
  db.prepare('DELETE FROM users WHERE id = ?').run(target.id);
  logActivity(req.user.id, 'delete_user', target.email);
  res.json({ ok: true });
});

module.exports = { router };
