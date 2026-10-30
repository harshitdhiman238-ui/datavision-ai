// ---------------------------------------------------------------
// Auto Analysis — one page: upload a file (or pick a project)
// and get the COMPLETE analysis instantly: KPIs, data quality,
// charts, statistics, top/bottom performers and insights.
// ---------------------------------------------------------------
import { el, esc, toast, spinnerHTML, emptyStateHTML, renderTable, fmtNum, fmtInt, kpiValue, makeChart, PALETTE } from '../util.js';
import { api, dataService } from '../api.js';
import { go } from '../app.js';

const MAX_MB = 15;

export async function renderAnalyze({ layoutApp }) {
  const node = el(`<div>
    <h2 style="font-size:22px;margin-bottom:4px">⚡ Auto Analysis</h2>
    <p class="muted small" style="margin-bottom:18px">Upload an Excel/CSV file and get the complete analysis on one page — KPIs, data quality, charts, statistics and insights. Everything is calculated from your actual file.</p>

    <div class="grid grid-2" style="align-items:stretch;margin-bottom:20px">
      <div class="dropzone" id="dz" tabindex="0" role="button" aria-label="Upload file" style="padding:30px 20px">
        <div class="dz-icon">📥</div>
        <h3>Drop your file here or click to browse</h3>
        <p class="small">.csv / .xlsx / .xls · up to ${MAX_MB} MB · analysis starts automatically</p>
        <input type="file" id="fileInput" accept=".csv,.xlsx,.xls" hidden/>
      </div>
      <div class="card">
        <div class="card-title">…or analyse an existing project</div>
        <div class="card-sub">Re-run the full analysis on a dataset you already uploaded.</div>
        <div class="field"><select class="input" id="projSel"><option value="">Loading projects…</option></select></div>
        <button class="btn btn-primary" id="runBtn" disabled>▶ Run full analysis</button>
        <p class="small muted" style="margin-top:10px">Tip: no file handy? <button class="chip" id="useSample" style="display:inline">Analyse the sample sales dataset</button></p>
      </div>
    </div>
    <div id="report"></div>
  </div>`);
  layoutApp(node, { active: 'analyze', title: 'Auto Analysis' });

  // ---- existing projects dropdown ----
  const sel = node.querySelector('#projSel'), runBtn = node.querySelector('#runBtn');
  try {
    const { projects } = await api.get('/api/projects');
    sel.innerHTML = projects.length
      ? `<option value="">— Select a project —</option>` + projects.map(p => `<option value="${p.id}">${esc(p.name)} (${fmtInt(p.row_count)} rows)</option>`).join('')
      : `<option value="">No projects yet — upload a file</option>`;
    sel.onchange = () => { runBtn.disabled = !sel.value; };
    runBtn.onclick = () => { if (sel.value) runAnalysis(node, sel.value); };
  } catch { sel.innerHTML = '<option value="">Could not load projects</option>'; }

  // ---- upload handlers ----
  const dz = node.querySelector('#dz'), input = node.querySelector('#fileInput');
  dz.onclick = () => input.click();
  dz.onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') input.click(); };
  ['dragenter', 'dragover'].forEach(ev => dz.addEventListener(ev, e => { e.preventDefault(); dz.classList.add('drag'); }));
  ['dragleave', 'drop'].forEach(ev => dz.addEventListener(ev, e => { e.preventDefault(); dz.classList.remove('drag'); }));
  dz.addEventListener('drop', e => { if (e.dataTransfer.files[0]) uploadAndAnalyse(node, e.dataTransfer.files[0]); });
  input.onchange = () => { if (input.files[0]) uploadAndAnalyse(node, input.files[0]); };

  node.querySelector('#useSample').onclick = async () => {
    try {
      const blob = await (await fetch('/sample-data/sample_sales_data.csv')).blob();
      uploadAndAnalyse(node, new File([blob], 'sample_sales_data.csv', { type: 'text/csv' }), 'Sample Sales (Auto Analysis)');
    } catch (e) { toast(e.message, 'error'); }
  };
}

async function uploadAndAnalyse(node, file, forcedName = null) {
  const report = node.querySelector('#report');
  if (!/\.(csv|xlsx|xls)$/i.test(file.name)) {
    report.innerHTML = `<div class="card">${emptyStateHTML('❌', 'Unsupported file type', `"${file.name}" is not a .csv, .xlsx or .xls file.`)}</div>`;
    return;
  }
  if (file.size > MAX_MB * 1024 * 1024) {
    report.innerHTML = `<div class="card">${emptyStateHTML('❌', 'File too large', `This file is ${(file.size / 1048576).toFixed(1)} MB — the limit is ${MAX_MB} MB.`)}</div>`;
    return;
  }
  report.innerHTML = `<div class="card">${spinnerHTML(`Uploading and parsing ${file.name}…`)}</div>`;
  const fd = new FormData();
  fd.append('file', file);
  fd.append('name', forcedName || file.name.replace(/\.[^.]+$/, '') + ' (Auto Analysis)');
  try {
    const res = await api.upload('/api/projects/upload', fd);
    toast(`Parsed ${fmtInt(res.project.row_count)} rows · ${res.project.col_count} columns. Analysing…`, 'success');
    runAnalysis(node, res.project.id, res.truncated);
  } catch (e) {
    report.innerHTML = `<div class="card">${emptyStateHTML('❌', 'Upload failed', e.message)}</div>`;
  }
}

async function runAnalysis(node, pid, truncated = false) {
  const report = node.querySelector('#report');
  report.innerHTML = `<div class="card">${spinnerHTML('Running the full analysis — KPIs, profiling, statistics and insights…')}</div>`;
  const svc = dataService(pid);
  let proj, k, a, p, ins;
  try {
    [proj, k, a, p, ins] = await Promise.all([svc.project(), svc.kpis(), svc.analysis(), svc.profile(), svc.insights()]);
  } catch (e) {
    report.innerHTML = `<div class="card">${emptyStateHTML('⚠️', 'Analysis failed', e.message)}</div>`;
    return;
  }
  const project = proj.project, analysis = a.analysis, profile = p.profile;
  const cats = analysis.categoryBreakdowns || [];
  const hasTrend = k.trend && k.trend.series.length >= 2;

  report.innerHTML = `
    <div class="ctx-strip">🗂️ <b>${esc(project.name)}</b>
      <span class="badge">${esc(project.source_filename)}</span>
      <span class="badge ${k.variant === 'cleaned' ? 'teal' : ''}">${k.variant} data · ${fmtInt(profile.rowCount)} rows · ${profile.colCount} columns</span>
      ${truncated ? '<span class="badge amber">truncated to 50,000 rows</span>' : ''}
      <span class="grow" style="flex:1"></span>
      <a class="btn btn-sm btn-primary" href="#/w/${pid}/dashboard">Open full workspace →</a>
    </div>

    <h3 style="margin:18px 0 10px">1 · Key metrics</h3>
    ${k.kpis.length ? `<div class="kpi-grid">${k.kpis.map((x, i) => `
      <div class="kpi-card" style="animation-delay:${i * 50}ms">
        <div class="k-label">${esc(x.label)}</div>
        <div class="k-value ${x.kind === 'pct' ? (x.value >= 0 ? 'pos' : 'neg') : ''}">${kpiValue(x)}</div>
        ${x.sub ? `<div class="k-sub">${esc(x.sub)}</div>` : ''}
      </div>`).join('')}</div>`
      : `<div class="card">${emptyStateHTML('🔢', 'No numeric columns', 'No KPIs could be computed — this dataset has no numeric columns.')}</div>`}

    <h3 style="margin:18px 0 10px">2 · Data quality</h3>
    <div class="grid grid-4">
      <div class="kpi-card"><div class="k-label">Quality score</div><div class="k-value" style="color:${profile.qualityScore >= 85 ? 'var(--green)' : profile.qualityScore >= 60 ? 'var(--amber)' : 'var(--red)'}">${profile.qualityScore}/100</div></div>
      <div class="kpi-card"><div class="k-label">Duplicate rows</div><div class="k-value">${fmtInt(profile.duplicateRows)}</div></div>
      <div class="kpi-card"><div class="k-label">Missing cells</div><div class="k-value">${fmtInt(profile.totalMissing)}</div></div>
      <div class="kpi-card"><div class="k-label">Date / whitespace issues</div><div class="k-value">${profile.mixedDateColumns.length + profile.whitespaceColumns.length}</div></div>
    </div>
    ${(profile.duplicateRows || profile.totalMissing || profile.whitespaceColumns.length || profile.mixedDateColumns.length)
      ? `<p class="small muted" style="margin-top:8px">⚠️ Issues detected — <a href="#/w/${pid}/data">open Data &amp; Cleaning</a> to fix them with preview-before-apply.</p>` : `<p class="small muted" style="margin-top:8px">✅ No major quality issues detected.</p>`}

    <h3 style="margin:22px 0 10px">3 · Charts</h3>
    ${(hasTrend || cats.length) ? `<div class="grid grid-2">
      ${hasTrend ? `<div class="chart-card" style="grid-column:1/-1"><h3>${esc(k.trend.valueCol ? `Monthly ${k.trend.valueCol} trend` : 'Monthly record count')}</h3><div class="cc-sub">Grouped by month of "${esc(k.trend.dateCol)}"</div><div class="chart-box"><canvas id="azTrend"></canvas></div></div>` : ''}
      ${cats[0] ? `<div class="chart-card"><h3>${esc(cats[0].valueCol ? `Total ${cats[0].valueCol}` : 'Records')} by ${esc(cats[0].column)}</h3><div class="chart-box"><canvas id="azCat1"></canvas></div></div>` : ''}
      ${cats[1] ? `<div class="chart-card"><h3>${esc(cats[1].valueCol ? `Total ${cats[1].valueCol}` : 'Records')} by ${esc(cats[1].column)}</h3><div class="chart-box"><canvas id="azCat2"></canvas></div></div>` : ''}
    </div>` : `<div class="card">${emptyStateHTML('📈', 'No automatic charts possible', 'No date or category columns were detected. Use the Visualizations tab to build custom charts.')}</div>`}

    <h3 style="margin:22px 0 10px">4 · Statistics</h3>
    <div class="grid grid-2" style="align-items:start">
      <div class="card"><div class="card-title">Numeric columns</div>
        ${Object.keys(analysis.numericStats).length ? renderTable(Object.entries(analysis.numericStats).map(([c, s]) => ({ Column: c, Sum: s.sum, Mean: s.mean, Median: s.median, Min: s.min, Max: s.max }))) : '<p class="small muted">No numeric columns.</p>'}</div>
      <div class="card"><div class="card-title">Top &amp; bottom performers</div>
        ${cats[0] ? `<p class="small muted" style="margin-bottom:8px">By ${cats[0].valueCol ? `total ${esc(cats[0].valueCol)}` : 'record count'} per ${esc(cats[0].column)}:</p>
          ${renderTable([
            ...cats[0].top.slice(0, 5).map(t => ({ Rank: '▲ Top', [cats[0].column]: t.key, Value: t[cats[0].metric] })),
            ...cats[0].bottom.slice(0, 2).filter(t => !cats[0].top.slice(0, 5).some(x => x.key === t.key)).map(t => ({ Rank: '▼ Bottom', [cats[0].column]: t.key, Value: t[cats[0].metric] })),
          ])}` : '<p class="small muted">No category column detected.</p>'}
        ${analysis.outliers.length ? `<div class="card-title" style="margin-top:14px;font-size:14px">Outliers (1.5×IQR)</div>
          ${renderTable(analysis.outliers.slice(0, 4).map(o => ({ Column: o.column, Count: o.count, 'Normal range': `${fmtNum(o.low)} – ${fmtNum(o.high)}` })))}` : ''}
      </div>
    </div>

    <h3 style="margin:22px 0 10px">5 · Insights <span class="badge ${ins.engine === 'ai' ? 'blue' : 'teal'}" style="vertical-align:middle">${ins.engine === 'ai' ? '🤖 AI-generated (verified stats)' : '⚙️ rule-based engine'}</span></h3>
    <div class="grid grid-2">
      ${ins.insights.slice(0, 6).map((i, idx) => `<div class="card insight-card ${esc(i.severity || 'info')}" style="animation-delay:${idx * 60}ms">
        <h3>${i.severity === 'positive' ? '📈' : i.severity === 'warning' ? '⚠️' : '💡'} ${esc(i.title)}</h3><p>${esc(i.text)}</p></div>`).join('')}
    </div>

    <h3 style="margin:22px 0 10px">6 · Next steps</h3>
    <div class="card" style="display:flex;gap:10px;flex-wrap:wrap">
      <a class="btn btn-primary" href="#/w/${pid}/dashboard">📊 Dashboard</a>
      <a class="btn btn-outline" href="#/w/${pid}/data">🧹 Clean data</a>
      <a class="btn btn-outline" href="#/w/${pid}/charts">📈 Build charts</a>
      <a class="btn btn-outline" href="#/w/${pid}/insights">💬 Ask questions</a>
      <a class="btn btn-outline" href="#/w/${pid}/reports">📄 PDF / Excel / CSV reports</a>
    </div>`;

  // charts
  if (hasTrend) {
    const metric = k.trend.metric;
    makeChart(report.querySelector('#azTrend'), {
      type: 'line',
      data: { labels: k.trend.series.map(s => s.key), datasets: [{ label: k.trend.valueCol || 'Records', data: k.trend.series.map(s => s[metric]), borderColor: '#3b82f6', backgroundColor: 'rgba(59,130,246,.14)', fill: true, tension: .35, pointRadius: 3 }] },
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false }, tooltip: { callbacks: { label: c => ` ${fmtNum(c.parsed.y)}` } } } },
    });
  }
  if (cats[0]) {
    const top = cats[0].top.slice(0, 8);
    makeChart(report.querySelector('#azCat1'), {
      type: 'bar',
      data: { labels: top.map(t => t.key), datasets: [{ label: '', data: top.map(t => t[cats[0].metric]), backgroundColor: 'rgba(20,184,166,.75)', borderRadius: 6 }] },
      options: { indexAxis: 'y', responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false }, tooltip: { callbacks: { label: c => ` ${fmtNum(c.parsed.x)}` } } } },
    });
  }
  if (cats[1]) {
    const top = cats[1].top.slice(0, 8);
    makeChart(report.querySelector('#azCat2'), {
      type: 'doughnut',
      data: { labels: top.map(t => t.key), datasets: [{ data: top.map(t => t[cats[1].metric]), backgroundColor: PALETTE, borderWidth: 0 }] },
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'right', labels: { boxWidth: 12 } }, tooltip: { callbacks: { label: c => ` ${c.label}: ${fmtNum(c.parsed)}` } } } },
    });
  }
  report.scrollIntoView({ behavior: 'smooth', block: 'start' });
}
