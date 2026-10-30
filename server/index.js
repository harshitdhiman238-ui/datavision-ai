// ---------------------------------------------------------------
// DataVision AI — Express server entry point
// Serves the API under /api and the SPA from /public.
// ---------------------------------------------------------------
require('dotenv').config();
const express = require('express');
const path = require('path');
const cookieParser = require('cookie-parser');

const { router: authRouter } = require('./routes/auth');
const { router: projectsRouter } = require('./routes/projects');
const { router: adminRouter } = require('./routes/admin');
const { router: demoRouter } = require('./routes/demo');

const app = express();
const PORT = process.env.PORT || 3000;

app.disable('x-powered-by');
app.use(express.json({ limit: '2mb' }));
app.use(cookieParser());

// Basic security headers
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'same-origin');
  next();
});

// ---- API ----
app.use('/api/auth', authRouter);
app.use('/api/projects', projectsRouter);
app.use('/api/admin', adminRouter);
app.use('/api/demo', demoRouter);
app.get('/api/health', (req, res) => res.json({ ok: true, aiConfigured: !!process.env.OPENAI_API_KEY }));

// ---- Static frontend + vendor libraries served from node_modules ----
app.use('/vendor/chart.umd.js', express.static(path.join(__dirname, '..', 'node_modules', 'chart.js', 'dist', 'chart.umd.js')));
app.use('/vendor/jspdf.umd.min.js', express.static(path.join(__dirname, '..', 'node_modules', 'jspdf', 'dist', 'jspdf.umd.min.js')));
app.use('/vendor/xlsx.full.min.js', express.static(path.join(__dirname, '..', 'node_modules', 'xlsx', 'dist', 'xlsx.full.min.js')));
app.use('/sample-data', express.static(path.join(__dirname, '..', 'sample-data')));
app.use(express.static(path.join(__dirname, '..', 'public')));

// SPA fallback (hash routing is used, so this mostly covers deep refreshes)
app.use((req, res, next) => {
  if (req.method === 'GET' && !req.path.startsWith('/api/')) {
    return res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
  }
  next();
});

// ---- Error handler: friendly messages, no stack traces to clients ----
app.use((err, req, res, next) => {
  console.error('[error]', err.message);
  res.status(err.status || 500).json({ error: err.status ? err.message : 'Something went wrong on the server. Please try again.' });
});

// ---- Auto-open the browser on local machines (handy for demos) ----
// Tries Google Chrome first, then Edge, then the default browser.
// Skipped on cloud hosts (e.g. Render) or when NO_BROWSER=1 is set.
function openBrowser(url) {
  if (process.env.RENDER || process.env.NO_BROWSER === '1' || process.env.NODE_ENV === 'production') return;
  const { exec } = require('child_process');
  const plat = process.platform;
  const cmds = plat === 'win32'
    ? [`start chrome "${url}"`, `start msedge "${url}"`, `start "" "${url}"`]
    : plat === 'darwin'
      ? [`open -a "Google Chrome" "${url}"`, `open "${url}"`]
      : [`xdg-open "${url}"`];
  const tryNext = (i) => {
    if (i >= cmds.length) return;
    exec(cmds[i], { windowsHide: true }, (err) => { if (err) tryNext(i + 1); });
  };
  tryNext(0);
}

app.listen(PORT, '0.0.0.0', () => {
  console.log(`DataVision AI running at http://localhost:${PORT}`);
  console.log(`AI insights: ${process.env.OPENAI_API_KEY ? 'AI API configured' : 'rule-based engine (no OPENAI_API_KEY set)'}`);
  const url = `http://localhost:${PORT}`;
  console.log('Opening your browser… (set NO_BROWSER=1 to disable)');
  setTimeout(() => openBrowser(url), 400);
});
