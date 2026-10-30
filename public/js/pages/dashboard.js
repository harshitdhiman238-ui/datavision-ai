import { esc, fmtNum, kpiValue, makeChart, PALETTE, spinnerHTML, emptyStateHTML } from '../util.js';
import { dataService } from '../api.js';
import { wbFrame, fillCtx } from './wb.js';

export async function renderDashboard({ layoutApp }, pid) {
  const node = wbFrame(pid, `
    <div id="kpis">${spinnerHTML('Calculating KPIs from your dataset…')}</div>
    <div class="grid grid-2" id="chartsArea" style="display:none">
      <div class="chart-card" style="grid-column:1/-1"><h3 id="trendTitle">Trend</h3><div class="cc-sub" id="trendSub"></div><div class="chart-box"><canvas id="trendC"></canvas></div></div>
      <div class="chart-card"><h3 id="cat1Title"></h3><div class="cc-sub" id="cat1Sub"></div><div class="chart-box"><canvas id="cat1C"></canvas></div></div>
      <div class="chart-card"><h3 id="cat2Title"></h3><div class="cc-sub" id="cat2Sub"></div><div class="chart-box"><canvas id="cat2C"></canvas></div></div>
    </div>
    <div id="noCharts"></div>
  `);
  layoutApp(node, { active: 'dashboard', pid, title: 'Dashboard' });

  const svc = dataService(pid);
  fillCtx(node, pid).catch(() => {});
  try {
    const [k, a] = await Promise.all([svc.kpis(), svc.analysis()]);
    renderKpis(node, k, pid);
    renderCharts(node, k, a.analysis, pid);
  } catch (e) {
    node.querySelector('#kpis').innerHTML = emptyStateHTML('⚠️', 'Could not compute the dashboard', e.message);
  }
}

function renderKpis(node, k, pid) {
  const box = node.querySelector('#kpis');
  if (!k.kpis.length) {
    box.innerHTML = emptyStateHTML('🔢', 'No numeric columns found',
      'This dataset has no numeric columns to build KPIs from. You can still browse and clean the data, or explore distinct-value charts.',
      `<a class="btn btn-outline" href="#/w/${pid}/data">Open Data &amp; Cleaning</a>`);
    return;
  }
  box.innerHTML = `<div class="kpi-grid">${k.kpis.map((x, i) => `
    <div class="kpi-card" style="animation-delay:${i * 60}ms">
      <div class="k-label">${esc(x.label)}</div>
      <div class="k-value ${x.kind === 'pct' ? (x.value >= 0 ? 'pos' : 'neg') : ''}">${kpiValue(x)}</div>
      ${x.sub ? `<div class="k-sub">${esc(x.sub)}</div>` : ''}
    </div>`).join('')}</div>
    <p class="small muted" style="margin:-8px 0 18px">KPIs are auto-detected from your column names and recalculated from the ${k.variant} data — nothing is hardcoded.</p>`;
}

function renderCharts(node, k, analysis, pid) {
  const area = node.querySelector('#chartsArea');
  const hasTrend = k.trend && k.trend.series.length >= 2;
  const cats = analysis.categoryBreakdowns || [];

  if (!hasTrend && !cats.length) {
    node.querySelector('#noCharts').innerHTML = emptyStateHTML('📈', 'Not enough structure for automatic charts',
      'No date column or low-cardinality category columns were detected. Use the Visualizations tab to build custom charts from any columns.',
      `<a class="btn btn-primary" href="#/w/${pid}/charts">Open Visualizations</a>`);
    return;
  }
  area.style.display = 'grid';

  // Trend chart
  const trendCard = node.querySelector('#trendC').closest('.chart-card');
  if (hasTrend) {
    const metric = k.trend.metric;
    node.querySelector('#trendTitle').textContent = k.trend.valueCol ? `Monthly ${k.trend.valueCol} Trend` : 'Monthly Record Count';
    node.querySelector('#trendSub').textContent = `Grouped by month of "${k.trend.dateCol}" · ${k.trend.series.length} periods`;
    makeChart(node.querySelector('#trendC'), {
      type: 'line',
      data: {
        labels: k.trend.series.map(s => s.key),
        datasets: [{
          label: k.trend.valueCol ? `Total ${k.trend.valueCol}` : 'Records',
          data: k.trend.series.map(s => s[metric]),
          borderColor: '#3b82f6', backgroundColor: 'rgba(59,130,246,.14)',
          fill: true, tension: .35, pointRadius: 3, pointHoverRadius: 6,
        }],
      },
      options: { responsive: true, maintainAspectRatio: false,
        plugins: { legend: { display: false }, tooltip: { callbacks: { label: c => ` ${c.dataset.label}: ${fmtNum(c.parsed.y)}` } } },
        scales: { y: { title: { display: true, text: k.trend.valueCol || 'count' } } } },
    });
  } else trendCard.style.display = 'none';

  // Two category charts
  const c1 = cats[0], c2 = cats[1];
  setupCatChart(node, '#cat1', c1, 'bar');
  setupCatChart(node, '#cat2', c2 || (cats[0] ? { ...cats[0], _alt: true } : null), 'doughnut');
}

function setupCatChart(node, prefix, b, kind) {
  const card = node.querySelector(prefix + 'C')?.closest('.chart-card');
  if (!b) { if (card) card.style.display = 'none'; return; }
  const metricLabel = b.valueCol ? `Total ${b.valueCol}` : 'Record count';
  node.querySelector(prefix + 'Title').textContent = `${metricLabel} by ${b.column}`;
  node.querySelector(prefix + 'Sub').textContent = `Top ${Math.min(8, b.top.length)} of ${b.totalGroups} groups`;
  const top = b.top.slice(0, 8);
  makeChart(node.querySelector(prefix + 'C'), {
    type: kind,
    data: {
      labels: top.map(t => t.key),
      datasets: [{ label: metricLabel, data: top.map(t => t[b.metric]), backgroundColor: kind === 'bar' ? 'rgba(20,184,166,.75)' : PALETTE, borderWidth: 0, borderRadius: kind === 'bar' ? 6 : 0 }],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      indexAxis: kind === 'bar' ? 'y' : undefined,
      plugins: {
        legend: kind === 'bar' ? { display: false } : { position: 'right', labels: { boxWidth: 12 } },
        tooltip: { callbacks: { label: c => ` ${fmtNum(kind === 'bar' ? c.parsed.x : c.parsed)}` } },
      },
    },
  });
}
