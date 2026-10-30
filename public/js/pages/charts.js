import { el, esc, toast, spinnerHTML, emptyStateHTML, makeChart, PALETTE, fmtNum } from '../util.js';
import { dataService } from '../api.js';
import { wbFrame, fillCtx } from './wb.js';

const AGG = { sum: 'Sum', avg: 'Average', count: 'Count' };

export async function renderCharts({ layoutApp }, pid) {
  const node = wbFrame(pid, `<div id="body">${spinnerHTML('Loading dataset for charting…')}</div>`);
  layoutApp(node, { active: 'charts', pid, title: 'Visualizations' });
  const svc = dataService(pid);
  fillCtx(node, pid).catch(() => {});

  let d;
  try { d = await svc.data('?limit=20000'); }
  catch (e) { node.querySelector('#body').innerHTML = emptyStateHTML('⚠️', 'Could not load data', e.message); return; }

  const cols = d.columns;
  const numCols = cols.filter(c => c.type === 'number').map(c => c.name);
  const dateCols = cols.filter(c => c.type === 'date').map(c => c.name);
  const catCols = cols.filter(c => c.type === 'text').map(c => c.name)
    .filter(name => { const s = new Set(d.rows.slice(0, 4000).map(r => r[name]).filter(v => v != null && v !== '')); return s.size >= 1 && s.size <= 60; });

  if (!cols.length || !d.rows.length) {
    node.querySelector('#body').innerHTML = emptyStateHTML('📭', 'No data', 'This dataset has no rows to chart.');
    return;
  }

  const filterCats = catCols.slice(0, 2);
  node.querySelector('#body').innerHTML = `
    <div class="grid" style="grid-template-columns:300px 1fr;align-items:start">
      <div class="card">
        <div class="card-title">Chart builder</div>
        <div class="field"><label>Chart type</label><select class="input" id="cType">
          <option value="bar">Bar chart</option><option value="line">Line chart</option><option value="area">Area chart</option>
          <option value="pie">Pie chart</option><option value="doughnut">Doughnut chart</option>
          <option value="histogram">Histogram</option><option value="scatter">Scatter plot</option>
        </select></div>
        <div id="builderFields"></div>
        <div class="nav-label" style="padding-left:0">Filters</div>
        ${dateCols.length ? `<div class="field"><label>Date range (${esc(dateCols[0])})</label>
          <div style="display:flex;gap:6px"><input type="date" class="input" id="fFrom"/><input type="date" class="input" id="fTo"/></div></div>` : ''}
        ${filterCats.map((c, i) => `<div class="field"><label>${esc(c)}</label><select class="input fCat" data-col="${esc(c)}"><option value="">All</option></select></div>`).join('')}
        <button class="btn btn-ghost btn-sm" id="clearF">✕ Clear filters</button>
        <p class="small muted" style="margin-top:12px" id="rowNote"></p>
      </div>
      <div class="chart-card">
        <h3 id="chartTitle">Chart</h3><div class="cc-sub" id="chartSub"></div>
        <div class="chart-box tall"><canvas id="mainChart"></canvas></div>
        <div id="chartMsg"></div>
      </div>
    </div>`;

  const body = node.querySelector('#body');
  // populate category filter options
  for (const sel of body.querySelectorAll('.fCat')) {
    const vals = [...new Set(d.rows.map(r => r[sel.dataset.col]).filter(v => v != null && String(v).trim() !== '').map(v => String(v).trim()))].sort();
    for (const v of vals) sel.appendChild(el(`<option value="${esc(v)}">${esc(v)}</option>`));
  }

  const ui = {
    type: () => body.querySelector('#cType').value,
    renderFields() {
      const t = ui.type();
      const f = body.querySelector('#builderFields');
      const catOpts = [...catCols, ...dateCols].map(c => `<option>${esc(c)}</option>`).join('');
      const numOpts = numCols.map(c => `<option>${esc(c)}</option>`).join('');
      if (t === 'histogram') {
        f.innerHTML = numCols.length
          ? `<div class="field"><label>Numeric column</label><select class="input" id="bX">${numOpts}</select></div>
             <div class="field"><label>Bins</label><select class="input" id="bBins"><option>10</option><option selected>15</option><option>20</option><option>30</option></select></div>`
          : '';
      } else if (t === 'scatter') {
        f.innerHTML = numCols.length >= 2
          ? `<div class="field"><label>X axis (numeric)</label><select class="input" id="bX">${numOpts}</select></div>
             <div class="field"><label>Y axis (numeric)</label><select class="input" id="bY">${numCols.map((c, i) => `<option ${i === 1 ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select></div>`
          : '';
      } else {
        f.innerHTML = (catCols.length || dateCols.length)
          ? `<div class="field"><label>Group by (X axis)</label><select class="input" id="bX">${catOpts}</select></div>
             <div class="field"><label>Value (Y axis)</label><select class="input" id="bY"><option value="__count__">Row count</option>${numOpts}</select></div>
             <div class="field"><label>Aggregation</label><select class="input" id="bAgg">${Object.entries(AGG).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select></div>`
          : '';
      }
      // sensible defaults
      const bY = f.querySelector('#bY');
      if (bY && numCols.length && t !== 'scatter') bY.value = numCols.find(c => /revenue|sales|amount|profit/i.test(c)) || numCols[0] || '__count__';
      f.querySelectorAll('select').forEach(s => s.onchange = draw);
    },
  };

  function filteredRows() {
    let rows = d.rows;
    const from = body.querySelector('#fFrom')?.value, to = body.querySelector('#fTo')?.value;
    if ((from || to) && dateCols.length) {
      const dc = dateCols[0];
      rows = rows.filter(r => {
        const v = parseDate(r[dc]);
        if (!v) return false;
        const iso = v.toISOString().slice(0, 10);
        return (!from || iso >= from) && (!to || iso <= to);
      });
    }
    for (const sel of body.querySelectorAll('.fCat')) {
      if (sel.value) rows = rows.filter(r => String(r[sel.dataset.col] ?? '').trim() === sel.value);
    }
    return rows;
  }

  function draw() {
    const t = ui.type();
    const rows = filteredRows();
    const msg = body.querySelector('#chartMsg');
    const canvas = body.querySelector('#mainChart');
    msg.innerHTML = '';
    body.querySelector('#rowNote').textContent = `${rows.length.toLocaleString()} of ${d.rows.length.toLocaleString()} rows match the current filters.${d.capped ? ' (large dataset: charting first 20,000 rows)' : ''}`;

    const fail = (title, text) => {
      canvas.style.display = 'none';
      msg.innerHTML = emptyStateHTML('🚫', title, text);
      body.querySelector('#chartTitle').textContent = 'Chart unavailable';
      body.querySelector('#chartSub').textContent = '';
    };
    if (!rows.length) return fail('No rows match the filters', 'Clear or widen the filters to see data.');
    canvas.style.display = '';

    if (t === 'histogram') {
      if (!numCols.length) return fail('No numeric columns', 'A histogram needs a numeric column, but this dataset has none.');
      const col = body.querySelector('#bX').value, bins = +body.querySelector('#bBins').value;
      const nums = rows.map(r => toNum(r[col])).filter(v => v !== null);
      if (nums.length < 2) return fail('Not enough numeric values', `"${col}" has fewer than 2 numeric values after filtering.`);
      const min = Math.min(...nums), max = Math.max(...nums);
      const w = (max - min) / bins || 1;
      const counts = Array(bins).fill(0);
      for (const v of nums) counts[Math.min(bins - 1, Math.floor((v - min) / w))]++;
      const labels = counts.map((_, i) => `${fmtNum(min + i * w)}–${fmtNum(min + (i + 1) * w)}`);
      setTitle(`Distribution of ${col}`, `${nums.length.toLocaleString()} values · ${bins} bins`);
      return makeChart(canvas, { type: 'bar', data: { labels, datasets: [{ label: 'Frequency', data: counts, backgroundColor: 'rgba(59,130,246,.72)', borderRadius: 4 }] },
        options: baseOpts({ x: 'Range of ' + col, y: 'Frequency', legend: false }) });
    }
    if (t === 'scatter') {
      if (numCols.length < 2) return fail('Need two numeric columns', 'A scatter plot requires at least two numeric columns.');
      const xc = body.querySelector('#bX').value, yc = body.querySelector('#bY').value;
      const pts = rows.map(r => ({ x: toNum(r[xc]), y: toNum(r[yc]) })).filter(p => p.x !== null && p.y !== null).slice(0, 3000);
      if (pts.length < 3) return fail('Not enough paired values', `Fewer than 3 rows have numeric values for both "${xc}" and "${yc}".`);
      setTitle(`${yc} vs ${xc}`, `${pts.length.toLocaleString()} points${rows.length > 3000 ? ' (first 3,000 shown)' : ''}`);
      return makeChart(canvas, { type: 'scatter', data: { datasets: [{ label: `${yc} vs ${xc}`, data: pts, backgroundColor: 'rgba(20,184,166,.6)' }] },
        options: baseOpts({ x: xc, y: yc, legend: false }) });
    }

    // grouped charts
    if (!catCols.length && !dateCols.length) return fail('No category or date columns', 'Bar/line/pie charts need a text or date column to group by. Try a histogram or scatter plot instead.');
    const xc = body.querySelector('#bX').value;
    const yv = body.querySelector('#bY').value;
    const agg = body.querySelector('#bAgg').value;
    const isDate = dateCols.includes(xc);
    const groups = new Map();
    for (const r of rows) {
      let k;
      if (isDate) { const dd = parseDate(r[xc]); if (!dd) continue; k = `${dd.getFullYear()}-${String(dd.getMonth() + 1).padStart(2, '0')}`; }
      else { k = String(r[xc] ?? '').trim() || '(blank)'; }
      if (!groups.has(k)) groups.set(k, { sum: 0, n: 0, cnt: 0 });
      const g = groups.get(k);
      g.cnt++;
      if (yv !== '__count__') { const v = toNum(r[yv]); if (v !== null) { g.sum += v; g.n++; } }
    }
    let entries = [...groups.entries()].map(([k, g]) => [k, yv === '__count__' || agg === 'count' ? g.cnt : agg === 'avg' ? (g.n ? g.sum / g.n : 0) : g.sum]);
    if (isDate) entries.sort((a, b) => a[0].localeCompare(b[0]));
    else entries.sort((a, b) => b[1] - a[1]);
    if (!isDate && entries.length > 15 && (t === 'bar')) entries = entries.slice(0, 15);
    if ((t === 'pie' || t === 'doughnut') && entries.length > 10) {
      const rest = entries.slice(9).reduce((s, e) => s + e[1], 0);
      entries = entries.slice(0, 9).concat([['Other', rest]]);
    }
    if (entries.length < 2 && (t === 'pie' || t === 'doughnut')) return fail('Only one group', `"${xc}" has a single value after filtering — a ${t} chart would be meaningless.`);
    const yLabel = yv === '__count__' ? 'Row count' : `${AGG[agg]} of ${yv}`;
    setTitle(`${yLabel} by ${xc}`, `${entries.length} groups · ${rows.length.toLocaleString()} rows`);
    const labels = entries.map(e => e[0]), values = entries.map(e => +(+e[1]).toFixed(2));
    const kind = t === 'area' ? 'line' : t;
    return makeChart(canvas, {
      type: kind,
      data: { labels, datasets: [{ label: yLabel, data: values,
        backgroundColor: (t === 'pie' || t === 'doughnut') ? PALETTE : t === 'area' ? 'rgba(59,130,246,.18)' : 'rgba(59,130,246,.72)',
        borderColor: (t === 'line' || t === 'area') ? '#3b82f6' : undefined,
        fill: t === 'area', tension: .3, borderRadius: t === 'bar' ? 5 : 0, borderWidth: (t === 'pie' || t === 'doughnut') ? 0 : undefined }] },
      options: (t === 'pie' || t === 'doughnut')
        ? { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'right' }, tooltip: { callbacks: { label: c => ` ${c.label}: ${fmtNum(c.parsed)}` } } } }
        : baseOpts({ x: xc, y: yLabel, legend: false }),
    });
  }

  function setTitle(t, s) { body.querySelector('#chartTitle').textContent = t; body.querySelector('#chartSub').textContent = s; }
  function baseOpts({ x, y, legend }) {
    return { responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: !!legend }, tooltip: { callbacks: { label: c => ` ${c.dataset.label}: ${fmtNum(c.parsed.y ?? c.parsed)}` } } },
      scales: { x: { title: { display: true, text: x } }, y: { title: { display: true, text: y } } } };
  }

  body.querySelector('#cType').onchange = () => { ui.renderFields(); draw(); };
  body.querySelectorAll('.fCat').forEach(s => s.onchange = draw);
  const ff = body.querySelector('#fFrom'), ft = body.querySelector('#fTo');
  if (ff) ff.onchange = draw; if (ft) ft.onchange = draw;
  body.querySelector('#clearF').onclick = () => {
    if (ff) ff.value = ''; if (ft) ft.value = '';
    body.querySelectorAll('.fCat').forEach(s => s.value = '');
    draw();
  };
  ui.renderFields();
  draw();
}

function toNum(v) {
  if (typeof v === 'number') return isFinite(v) ? v : null;
  if (typeof v !== 'string') return null;
  const s = v.trim().replace(/[,₹$€£%]/g, '');
  return s !== '' && !isNaN(Number(s)) ? Number(s) : null;
}
function parseDate(v) {
  if (!v) return null;
  const s = String(v).trim();
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return new Date(+m[1], +m[2] - 1, +m[3]);
  m = s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})$/);
  if (m) {
    let a = +m[1], b = +m[2], y = +m[3]; if (y < 100) y += 2000;
    let day = a, mon = b;
    if (a <= 12 && b > 12) { mon = a; day = b; }
    if (mon > 12 || day > 31) return null;
    return new Date(y, mon - 1, day);
  }
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}
