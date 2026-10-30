// ---------------------------------------------------------------
// DataVision AI — SQLite database layer (better-sqlite3)
// Stores users and project METADATA. Dataset rows are stored as
// JSON files on disk (data/datasets/) and referenced by id, so
// metadata and source data are clearly separated.
// ---------------------------------------------------------------
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcryptjs');

const DATA_DIR = path.join(__dirname, '..', 'data');
const DATASET_DIR = path.join(DATA_DIR, 'datasets');
fs.mkdirSync(DATASET_DIR, { recursive: true });

// ---- SQLite driver selection ----
// 1) Node 23+/24 ships a built-in SQLite (node:sqlite) — zero native
//    compilation, works on any machine out of the box.
// 2) Older Node (18/20/22) falls back to better-sqlite3 (installed as an
//    optional dependency; it has prebuilt binaries for those versions).
const DB_PATH = path.join(DATA_DIR, 'datavision.db');
let db, driver;
try {
  const { DatabaseSync } = require('node:sqlite');
  db = new DatabaseSync(DB_PATH);
  db.exec('PRAGMA journal_mode = WAL;');
  driver = 'node:sqlite (built-in)';
} catch (e) {
  const Database = require('better-sqlite3');
  db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  driver = 'better-sqlite3';
}
console.log(`[db] SQLite driver: ${driver}`);

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'user',          -- 'user' | 'admin'
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS projects (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  source_filename TEXT NOT NULL,
  row_count INTEGER NOT NULL,
  col_count INTEGER NOT NULL,
  columns_json TEXT NOT NULL,                 -- [{name,type}] inferred schema
  config_json TEXT NOT NULL DEFAULT '{}',     -- saved dashboard config (filters, chart prefs)
  has_cleaned INTEGER NOT NULL DEFAULT 0,     -- 1 if a cleaned version exists
  cleaned_row_count INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS activity_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER,
  action TEXT NOT NULL,
  detail TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`);

// ---- Seed a demo admin account (documented in README; change in production) ----
function seedAdmin() {
  const email = (process.env.ADMIN_EMAIL || 'admin@datavision.local').toLowerCase();
  const exists = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
  if (!exists) {
    const pwd = process.env.ADMIN_PASSWORD || 'Admin@1234';
    db.prepare('INSERT INTO users (name, email, password_hash, role) VALUES (?,?,?,?)')
      .run('Administrator', email, bcrypt.hashSync(pwd, 10), 'admin');
    console.log(`[db] Seeded admin account: ${email}`);
  }
}
seedAdmin();

// ---- Dataset file helpers (JSON rows stored on disk, owned via DB row) ----
function datasetPath(projectId, variant /* 'original' | 'cleaned' */) {
  return path.join(DATASET_DIR, `project_${projectId}_${variant}.json`);
}
function saveDataset(projectId, variant, rows) {
  fs.writeFileSync(datasetPath(projectId, variant), JSON.stringify(rows));
}
function loadDataset(projectId, variant) {
  const p = datasetPath(projectId, variant);
  if (!fs.existsSync(p)) return null;
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}
function deleteDatasets(projectId) {
  for (const v of ['original', 'cleaned']) {
    const p = datasetPath(projectId, v);
    if (fs.existsSync(p)) fs.unlinkSync(p);
  }
}

function logActivity(userId, action, detail) {
  db.prepare('INSERT INTO activity_log (user_id, action, detail) VALUES (?,?,?)')
    .run(userId || null, action, detail || null);
}

module.exports = { db, saveDataset, loadDataset, deleteDatasets, logActivity };
