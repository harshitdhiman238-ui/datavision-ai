import { el, esc, spinnerHTML, emptyStateHTML, renderTable, makeChart, fmtNum } from '../util.js';
import { dataService } from '../api.js';
import { wbFrame, fillCtx } from './wb.js';

const SUGGESTIONS = [
  'Which product has the highest revenue?',
  'Show monthly sales',
  'Find duplicate rows',
  'Compare the top 5 categories',
  'Which region performs worst?',
  'Are there missing values?',
];

export async function renderInsights({ layoutApp }, pid) {
  const node = wbFrame(pid, `
    <div class="tabs">
      <button class="tab active" data-t="ins">💡 Insights</button>
      <button class="tab" data-t="ask">💬 Ask your data</button>
      <button class="tab" data-t="stats">🧮 Statistics</button>
    </div>
    <div data-p="ins">${spinnerHTML('Analysing your dataset and generating insights…')}</div>
    <div data-p="ask" style="display:none">
      <div class="card">
        <div class="card-title">Ask a question in plain English</div>
        <div class="card-sub">Questions are translated into safe, predefined calculations on your dataset — the math behind every answer is shown. No SQL or code is ever executed from your text.</div>
        <div class="ask-box"><input class="input" id="q" placeholder='e.g. "Which product has the highest revenue?"' maxlength="300"/><button class="btn btn-primary" id="askBtn">Ask</button></div>
        <div class="chip-row">${SUGGESTIONS.map(s => `<button class="chip">${esc(s)}</button>`).join('')}</div>
      </div>
      <div id="qaLog" style="margin-top:16px"></div>
    </div>
    <div data-p="stats" style="display:none">${spinnerHTML('Computing statistics…')}</div>
  `);
  layoutApp(node, { active: 'insights', pid, title: 'Insights & Ask' });

  node.querySelectorAll('.tab').forEach(t => t.onclick = () => {
    node.querySelectorAll('.tab').forEach(x => x.classList.toggle('active', x === t));
    node.querySelectorAll('[data-p]').forEach(p => p.style.display = p.dataset.p === t.dataset.t ? '' : 'none');
  });

  const svc = dataService(pid);
  fillCtx(node, pid).catch(() => {});
  loadInsights(node, svc);
  loadStats(node, svc);
  setupAsk(node, svc);
}

async function loadInsights(node, svc) {
  const box = node.querySelector('[data-p="ins"]');
  try {
    const r = await svc.insights();
    const engineBadge = r.engine === 'ai'
      ? '<span class="badge blue">🤖 AI-generated (from verified statistics)</span>'
      : '<span class="badge teal">⚙️ Rule-based engine (no AI API configured)</span>';
    box.innerHTML = `
      <div class="toolbar"><p class="small muted">Findings below are derived from statistics calculated on the <b>${esc(r.variant || 'current')}</b> dataset. ${engineBadge}</p></div>
      <div class="grid grid-2">
        ${r.insights.map((i, idx) => `
          <div class="card insight-card ${esc(i.severity || 'info')}" style="animation-delay:${idx * 70}ms">
            <h3>${sevIcon(i.severity)} ${esc(i.title)}</h3>
            <p>${esc(i.text)}</p>
            ${i.evidence && Object.keys(i.evidence).length ? `<details><summary>Show supporting numbers</summary><pre>${esc(JSON.stringify(i.evidence, null, 2))}</pre></details>` : ''}
          </div>`).join('')}
      </div>`;
  } catch (e) {
    box.innerHTML = emptyStateHTML('⚠️', 'Insights unavailable', e.message);
  }
}
const sevIcon = s => s === 'positive' ? '📈' : s === 'warning' ? '⚠️' : '💡';

function setupAsk(node, svc) {
  const input = node.querySelector('#q'), btn = node.querySelector('#askBtn'), log = node.querySelector('#qaLog');
  const ask = async q => {
    if (!q.trim()) return;
    const item = el(`<div class="qa-item fade-up"><div class="qa-q">🙋 ${esc(q)}</div><div class="qa-a">${spinnerHTML('Calculating…')}</div></div>`);
    log.prepend(item);
    input.value = '';
    try {
      const r = await svc.ask(q);
      const a = item.querySelector('.qa-a');
      a.innerHTML = `<p>${esc(r.answer)}</p>
        ${r.table ? `<div style="margin-top:10px">${renderTable(r.table, null, { max: 25 })}</div>` : ''}
        ${r.chart ? `<div class="chart-box" style="height:240px;margin-top:10px"><canvas></canvas></div>` : ''}
        ${r.method ? `<div class="method">🧮 How this was computed: ${esc(r.method)}</div>` : ''}`;
      if (r.chart) {
        makeChart(a.querySelector('canvas'), {
          type: r.chart.kind,
          data: { labels: r.chart.labels, datasets: [{ label: r.chart.label, data: r.chart.values, backgroundColor: 'rgba(20,184,166,.7)', borderColor: '#14b8a6', fill: r.chart.kind === 'line' ? false : undefined, tension: .3, borderRadius: 5 }] },
          options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false }, tooltip: { callbacks: { label: c => ` ${fmtNum(c.parsed.y ?? c.parsed)}` } } } },
        });
      }
    } catch (e) {
      item.querySelector('.qa-a').innerHTML = `<p class="muted">⚠️ ${esc(e.message)}</p>`;
    }
  };
  btn.onclick = () => ask(input.value);
  input.onkeydown = e => { if (e.key === 'Enter') ask(input.value); };
  node.querySelectorAll('.chip').forEach(c => c.onclick = () => ask(c.textContent));
}

async function loadStats(node, svc) {
  const box = node.querySelector('[data-p="stats"]');
  try {
    const { analysis: a } = await svc.analysis();
    const numRows = Object.entries(a.numericStats).map(([c, s]) => ({
      Column: c, Count: s.count, Sum: s.sum, Mean: s.mean, Median: s.median, Min: s.min, Max: s.max, 'Std Dev': s.std,
    }));
    box.innerHTML = `
      <div class="card" style="margin-bottom:18px">
        <div class="card-title">Numeric column statistics</div>
        ${numRows.length ? renderTable(numRows) : emptyStateHTML('🔢', 'No numeric columns', 'This dataset has no numeric columns to summarise.')}
      </div>
      <div class="grid grid-2">
        <div class="card">
          <div class="card-title">Distinct values per column</div>
          ${renderTable(Object.entries(a.distinctCounts).map(([c, n]) => ({ Column: c, 'Distinct values': n })))}
        </div>
        <div class="card">
          <div class="card-title">Correlation matrix ${a.correlations ? `(${a.correlations.cols.length} numeric columns)` : ''}</div>
          ${a.correlations ? corrHTML(a.correlations) : emptyStateHTML('🔗', 'Not enough numeric columns', 'Correlations need at least two numeric columns.')}
          <p class="small muted" style="margin-top:8px">Pearson r: +1 strong positive, −1 strong negative, 0 none.</p>
        </div>
      </div>
      ${a.outliers.length ? `<div class="card" style="margin-top:18px">
        <div class="card-title">Outlier indicators (1.5×IQR rule)</div>
        ${renderTable(a.outliers.map(o => ({ Column: o.column, 'Outlier count': o.count, 'Normal range': `${fmtNum(o.low)} to ${fmtNum(o.high)}`, Examples: o.examples.map(fmtNum).join(', ') })))}
      </div>` : ''}`;
  } catch (e) {
    box.innerHTML = emptyStateHTML('⚠️', 'Statistics unavailable', e.message);
  }
}

function corrHTML({ cols, matrix }) {
  const color = r => {
    if (r === null) return 'var(--surface-2)';
    const a = Math.min(1, Math.abs(r));
    return r >= 0 ? `rgba(59,130,246,${0.12 + a * 0.55})` : `rgba(248,113,113,${0.12 + a * 0.55})`;
  };
  return `<div style="overflow:auto"><table style="border-collapse:separate;border-spacing:3px">
    <tr><td></td>${cols.map(c => `<td class="corr-cell muted" title="${esc(c)}" style="font-size:10px">${esc(c.slice(0, 7))}</td>`).join('')}</tr>
    ${matrix.map((row, i) => `<tr><td class="corr-cell muted" title="${esc(cols[i])}" style="font-size:10px">${esc(cols[i].slice(0, 7))}</td>
      ${row.map(r => `<td class="corr-cell" style="background:${color(r)}">${r === null ? '—' : r.toFixed(2)}</td>`).join('')}</tr>`).join('')}
  </table></div>`;
}
