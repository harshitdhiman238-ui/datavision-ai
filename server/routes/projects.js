// ---------------------------------------------------------------
// Projects: upload, inspect, profile, clean, analyse, ask, export.
// Every route checks ownership: users only ever see their own data.
// ---------------------------------------------------------------
const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const XLSX = require('xlsx');
const { db, saveDataset, loadDataset, deleteDatasets, logActivity } = require('../db');
const { authRequired } = require('./auth');
const { parseUpload, inferType, MAX_ROWS } = require('../lib/parse');
const { profileDataset } = require('../lib/profile');
const { applyCleaning } = require('../lib/clean');
const { computeKPIs, fullAnalysis } = require('../lib/stats');
const { generateInsights, answerQuestion } = require('../lib/insights');

const router = express.Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 }, // 15 MB
  fileFilter: (req, file, cb) => {
    const ok = /\.(csv|xlsx|xls)$/i.test(file.originalname);
    cb(ok ? null : Object.assign(new Error('Only .csv, .xlsx and .xls files are allowed.'), { status: 400 }), ok);
  },
});

// ---- helpers ----
function getOwnedProject(req, res) {
  const p = db.prepare('SELECT * FROM projects WHERE id = ?').get(req.params.id);
  if (!p) { res.status(404).json({ error: 'Project not found.' }); return null; }
  if (p.user_id !== req.user.id && req.user.role !== 'admin') {
    res.status(403).json({ error: 'You do not have access to this project.' });
    return null;
  }
  return p;
}
function activeRows(project) {
  // cleaned version if it exists, otherwise original
  if (project.has_cleaned) {
    const r = loadDataset(project.id, 'cleaned');
    if (r) return { rows: r, variant: 'cleaned' };
  }
  return { rows: loadDataset(project.id, 'original') || [], variant: 'original' };
}
function columnsOf(project, rows) {
  const stored = JSON.parse(project.columns_json);
  if (!rows.length) return stored;
  const present = Object.keys(rows[0]);
  const known = stored.filter(c => present.includes(c.name));
  // infer any new columns (shouldn't happen, but safe)
  for (const name of present) if (!known.some(c => c.name === name)) known.push({ name, type: inferType(rows.map(r => r[name])) });
  return known;
}
const touch = id => db.prepare("UPDATE projects SET updated_at = datetime('now') WHERE id = ?").run(id);

// ---- upload & create project ----
router.post('/upload', authRequired, (req, res, next) => {
  upload.single('file')(req, res, (err) => {
    if (err) {
      if (err.code === 'LIMIT_FILE_SIZE') return res.status(400).json({ error: 'File is too large. The upload limit is 15 MB.' });
      return res.status(err.status || 400).json({ error: err.message });
    }
    try {
      if (!req.file) return res.status(400).json({ error: 'No file received. Please choose a .csv, .xlsx or .xls file.' });
      const { rows, columns, truncated } = parseUpload(req.file.buffer, req.file.originalname);
      const name = (req.body.name || '').trim() || req.file.originalname.replace(/\.[^.]+$/, '');
      const info = db.prepare(`INSERT INTO projects (user_id, name, source_filename, row_count, col_count, columns_json)
        VALUES (?,?,?,?,?,?)`).run(req.user.id, name, req.file.originalname, rows.length, columns.length, JSON.stringify(columns));
      saveDataset(info.lastInsertRowid, 'original', rows);
      logActivity(req.user.id, 'upload', `${req.file.originalname} (${rows.length} rows)`);
      res.json({
        project: db.prepare('SELECT * FROM projects WHERE id = ?').get(info.lastInsertRowid),
        truncated, maxRows: MAX_ROWS,
        preview: rows.slice(0, 20), columns,
      });
    } catch (e) { next(e); }
  });
});

// ---- list / rename / delete ----
router.get('/', authRequired, (req, res) => {
  const list = db.prepare('SELECT id, name, source_filename, row_count, col_count, has_cleaned, cleaned_row_count, created_at, updated_at FROM projects WHERE user_id = ? ORDER BY updated_at DESC').all(req.user.id);
  res.json({ projects: list });
});
router.get('/:id', authRequired, (req, res) => {
  const p = getOwnedProject(req, res); if (!p) return;
  res.json({ project: p });
});
router.put('/:id', authRequired, (req, res) => {
  const p = getOwnedProject(req, res); if (!p) return;
  const { name, config } = req.body || {};
  if (name !== undefined) {
    if (!String(name).trim()) return res.status(400).json({ error: 'Project name cannot be empty.' });
    db.prepare('UPDATE projects SET name = ? WHERE id = ?').run(String(name).trim().slice(0, 80), p.id);
  }
  if (config !== undefined) {
    db.prepare('UPDATE projects SET config_json = ? WHERE id = ?').run(JSON.stringify(config).slice(0, 20000), p.id);
  }
  touch(p.id);
  res.json({ project: db.prepare('SELECT * FROM projects WHERE id = ?').get(p.id) });
});
router.delete('/:id', authRequired, (req, res) => {
  const p = getOwnedProject(req, res); if (!p) return;
  deleteDatasets(p.id);
  db.prepare('DELETE FROM projects WHERE id = ?').run(p.id);
  logActivity(req.user.id, 'delete_project', p.name);
  res.json({ ok: true });
});

// ---- data access ----
router.get('/:id/data', authRequired, (req, res) => {
  const p = getOwnedProject(req, res); if (!p) return;
  const variant = req.query.variant === 'original' ? 'original' : null;
  const { rows, variant: used } = variant ? { rows: loadDataset(p.id, 'original') || [], variant: 'original' } : activeRows(p);
  const limit = Math.min(+req.query.limit || 20000, MAX_ROWS);
  const offset = Math.max(0, +req.query.offset || 0);
  res.json({
    variant: used, total: rows.length,
    columns: columnsOf(p, rows),
    rows: rows.slice(offset, offset + limit),
    capped: rows.length > offset + limit,
  });
});

// ---- profiling ----
router.get('/:id/profile', authRequired, (req, res) => {
  const p = getOwnedProject(req, res); if (!p) return;
  const { rows, variant } = activeRows(p);
  res.json({ variant, profile: profileDataset(rows, columnsOf(p, rows)) });
});

// ---- cleaning: preview (no save) and apply (saves 'cleaned' variant) ----
router.post('/:id/clean/preview', authRequired, (req, res) => {
  const p = getOwnedProject(req, res); if (!p) return;
  const original = loadDataset(p.id, 'original') || [];
  const cols = columnsOf(p, original);
  const result = applyCleaning(original, cols, req.body.ops || {});
  res.json({
    log: result.log,
    before: { rows: original.length, cols: cols.length, profile: profileDataset(original, cols) },
    after: { rows: result.rows.length, cols: result.columns.length, profile: profileDataset(result.rows, result.columns) },
    preview: result.rows.slice(0, 15),
    columns: result.columns,
  });
});
router.post('/:id/clean/apply', authRequired, (req, res) => {
  const p = getOwnedProject(req, res); if (!p) return;
  const original = loadDataset(p.id, 'original') || [];
  const cols = columnsOf(p, original);
  const result = applyCleaning(original, cols, req.body.ops || {});
  saveDataset(p.id, 'cleaned', result.rows);
  db.prepare('UPDATE projects SET has_cleaned = 1, cleaned_row_count = ?, columns_json = ? WHERE id = ?')
    .run(result.rows.length, JSON.stringify(result.columns), p.id);
  touch(p.id);
  logActivity(req.user.id, 'clean_apply', `project ${p.id}: ${result.log.join(' ')}`);
  res.json({ ok: true, log: result.log, rowCount: result.rows.length, colCount: result.columns.length });
});
// Undo: discard the cleaned variant and return to the original
router.post('/:id/clean/revert', authRequired, (req, res) => {
  const p = getOwnedProject(req, res); if (!p) return;
  const original = loadDataset(p.id, 'original') || [];
  // restore schema from original rows
  const cols = original.length ? Object.keys(original[0]).map(name => ({ name, type: inferType(original.map(r => r[name])) })) : [];
  db.prepare('UPDATE projects SET has_cleaned = 0, cleaned_row_count = NULL, columns_json = ? WHERE id = ?')
    .run(JSON.stringify(cols), p.id);
  deleteCleaned(p.id);
  touch(p.id);
  res.json({ ok: true });
});
function deleteCleaned(projectId) {
  const f = path.join(__dirname, '..', '..', 'data', 'datasets', `project_${projectId}_cleaned.json`);
  if (fs.existsSync(f)) fs.unlinkSync(f);
}

// ---- analysis ----
router.get('/:id/kpis', authRequired, (req, res) => {
  const p = getOwnedProject(req, res); if (!p) return;
  const { rows, variant } = activeRows(p);
  res.json({ variant, ...computeKPIs(rows, columnsOf(p, rows)) });
});
router.get('/:id/analysis', authRequired, (req, res) => {
  const p = getOwnedProject(req, res); if (!p) return;
  const { rows, variant } = activeRows(p);
  res.json({ variant, analysis: fullAnalysis(rows, columnsOf(p, rows)) });
});
router.get('/:id/insights', authRequired, async (req, res, next) => {
  try {
    const p = getOwnedProject(req, res); if (!p) return;
    const { rows, variant } = activeRows(p);
    const result = await generateInsights(rows, columnsOf(p, rows));
    res.json({ variant, ...result });
  } catch (e) { next(e); }
});
router.post('/:id/ask', authRequired, (req, res) => {
  const p = getOwnedProject(req, res); if (!p) return;
  const { rows } = activeRows(p);
  const question = String(req.body.question || '').slice(0, 300);
  const result = answerQuestion(question, rows, columnsOf(p, rows));
  logActivity(req.user.id, 'ask', question);
  res.json(result);
});

// ---- exports ----
router.get('/:id/export/csv', authRequired, (req, res) => {
  const p = getOwnedProject(req, res); if (!p) return;
  const { rows, variant } = activeRows(p);
  const ws = XLSX.utils.json_to_sheet(rows);
  const csv = XLSX.utils.sheet_to_csv(ws);
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${p.name.replace(/[^a-z0-9_-]+/gi, '_')}_${variant}.csv"`);
  res.send(csv);
});
router.get('/:id/export/xlsx', authRequired, (req, res) => {
  const p = getOwnedProject(req, res); if (!p) return;
  const { rows, variant } = activeRows(p);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), 'Data');
  // summary sheet with real statistics
  const a = fullAnalysis(rows, columnsOf(p, rows));
  const summary = [['DataVision AI — Analysis Summary'], ['Project', p.name], ['Rows', rows.length], ['Variant', variant], []];
  summary.push(['Numeric column', 'Sum', 'Mean', 'Median', 'Min', 'Max', 'Std Dev']);
  for (const [c, s] of Object.entries(a.numericStats)) summary.push([c, s.sum, s.mean, s.median, s.min, s.max, s.std]);
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(summary), 'Summary');
  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${p.name.replace(/[^a-z0-9_-]+/gi, '_')}_${variant}.xlsx"`);
  res.send(buf);
});
// Everything the PDF report needs in one call (rendered client-side with jsPDF)
router.get('/:id/report-data', authRequired, async (req, res, next) => {
  try {
    const p = getOwnedProject(req, res); if (!p) return;
    const { rows, variant } = activeRows(p);
    const cols = columnsOf(p, rows);
    const insights = await generateInsights(rows, cols);
    res.json({
      project: { name: p.name, source: p.source_filename, created: p.created_at, variant },
      kpis: computeKPIs(rows, cols),
      analysis: fullAnalysis(rows, cols),
      profile: profileDataset(rows, cols),
      insights,
    });
  } catch (e) { next(e); }
});

module.exports = { router };
