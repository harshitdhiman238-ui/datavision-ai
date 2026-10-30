// ---------------------------------------------------------------
// Public demo endpoints — serve the bundled SAMPLE dataset so
// visitors can explore the workbench without an account.
// All responses are clearly flagged as sample data. Read-only.
// ---------------------------------------------------------------
const express = require('express');
const fs = require('fs');
const path = require('path');
const { parseUpload } = require('../lib/parse');
const { profileDataset } = require('../lib/profile');
const { computeKPIs, fullAnalysis } = require('../lib/stats');
const { ruleBasedInsights, answerQuestion } = require('../lib/insights');

const router = express.Router();
const SAMPLE = path.join(__dirname, '..', '..', 'sample-data', 'sample_sales_data.csv');

let cache = null;
function getSample() {
  if (!cache) {
    const buf = fs.readFileSync(SAMPLE);
    cache = parseUpload(buf, 'sample_sales_data.csv');
  }
  return cache;
}

router.get('/data', (req, res) => {
  const { rows, columns } = getSample();
  res.json({ demo: true, variant: 'original', total: rows.length, columns, rows, capped: false });
});
router.get('/kpis', (req, res) => {
  const { rows, columns } = getSample();
  res.json({ demo: true, variant: 'original', ...computeKPIs(rows, columns) });
});
router.get('/profile', (req, res) => {
  const { rows, columns } = getSample();
  res.json({ demo: true, variant: 'original', profile: profileDataset(rows, columns) });
});
router.get('/analysis', (req, res) => {
  const { rows, columns } = getSample();
  res.json({ demo: true, variant: 'original', analysis: fullAnalysis(rows, columns) });
});
router.get('/insights', (req, res) => {
  const { rows, columns } = getSample();
  res.json({ demo: true, variant: 'original', ...ruleBasedInsights(rows, columns) });
});
router.post('/ask', (req, res) => {
  const { rows, columns } = getSample();
  res.json({ demo: true, ...answerQuestion(String(req.body.question || '').slice(0, 300), rows, columns) });
});

module.exports = { router };
