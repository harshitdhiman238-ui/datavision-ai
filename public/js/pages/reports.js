import { el, esc, toast, spinnerHTML, emptyStateHTML, fmtNum, fmtInt, kpiValue, PALETTE } from '../util.js';
import { dataService } from '../api.js';
import { wbFrame, fillCtx } from './wb.js';

export async function renderReports({ layoutApp }, pid) {
  const demo = pid === 'demo';
  const node = wbFrame(pid, `
    <div class="grid grid-3" style="align-items:stretch">
      <div class="card feature-card"><div class="fi">📄</div><h3>PDF Report</h3>
        <p>A multi-page report with your KPIs, charts, statistics, data-quality summary and key findings — all computed from the ${demo ? 'sample' : 'current'} dataset.</p>
        <button class="btn btn-primary" id="pdfBtn" style="margin-top:14px">⬇ Generate PDF report</button></div>
      <div class="card feature-card"><div class="fi">🧾</div><h3>Data (CSV)</h3>
        <p>Download the ${demo ? 'sample dataset' : 'active dataset (cleaned version if you applied cleaning, otherwise the original)'} as a CSV file.</p>
        ${demo ? `<a class="btn btn-outline" href="/sample-data/sample_sales_data.csv" download style="margin-top:14px">⬇ Download sample CSV</a>`
               : `<a class="btn btn-outline" href="/api/projects/${pid}/export/csv" style="margin-top:14px">⬇ Download CSV</a>`}</div>
      <div class="card feature-card"><div class="fi">📊</div><h3>Excel Workbook</h3>
        <p>An .xlsx file with a Data sheet plus a Summary sheet containing the calculated statistics.</p>
        ${demo ? `<button class="btn btn-outline" disabled style="margin-top:14px">Available for your own projects</button><p class="small muted" style="margin-top:8px">Sign up and import the sample to try Excel export.</p>`
               : `<a class="btn btn-outline" href="/api/projects/${pid}/export/xlsx" style="margin-top:14px">⬇ Download Excel</a>`}</div>
    </div>
    <div class="card" style="margin-top:18px"><div class="fi" style="width:44px;height:44px;border-radius:12px;display:flex;align-items:center;justify-content:center;font-size:21px;background:var(--accent-grad);margin-bottom:12px">📝</div>
      <h3 style="margin-bottom:6px">Analysis summary (text)</h3>
      <p class="small muted">A plain-text summary of KPIs, statistics and findings — handy for pasting into project documentation.</p>
      <button class="btn btn-outline" id="txtBtn" style="margin-top:12px">⬇ Download summary (.txt)</button></div>
    <div id="pdfStatus"></div>
  `);
  layoutApp(node, { active: 'reports', pid, title: 'Reports & Export' });
  const svc = dataService(pid);
  fillCtx(node, pid).catch(() => {});

  node.querySelector('#pdfBtn').onclick = () => buildPDF(node, svc, pid);
  node.querySelector('#txtBtn').onclick = () => buildSummary(node, svc);
}

async function gatherReportData(svc, pid) {
  if (pid !== 'demo') return (await import('../api.js')).api.get(`/api/projects/${pid}/report-data`);
  const [k, a, p, i, proj] = await Promise.all([svc.kpis(), svc.analysis(), svc.profile(), svc.insights(), svc.project()]);
  return { project: { name: proj.project.name, source: proj.project.source_filename, variant: 'original (sample data)' }, kpis: k, analysis: a.analysis, profile: p.profile, insights: i };
}

/* ---------- offscreen chart rendering for the PDF ---------- */
function offscreenChart(config, w = 900, h = 420) {
  return new Promise(resolve => {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    c.style.cssText = 'position:fixed;left:-9999px;top:0';
    document.body.appendChild(c);
    const chart = new Chart(c.getContext('2d'), {
      ...config,
      options: { ...config.options, responsive: false, animation: false,
        plugins: { ...(config.options?.plugins || {}), legend: { ...(config.options?.plugins?.legend || {}), labels: { color: '#334155', ...(config.options?.plugins?.legend?.labels || {}) } } } },
    });
    setTimeout(() => {
      // white background for PDF
      const out = document.createElement('canvas');
      out.width = w; out.height = h;
      const ctx = out.getContext('2d');
      ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, w, h);
      ctx.drawImage(c, 0, 0);
      const url = out.toDataURL('image/png');
      chart.destroy(); c.remove();
      resolve(url);
    }, 120);
  });
}

async function buildPDF(node, svc, pid) {
  const btn = node.querySelector('#pdfBtn');
  const status = node.querySelector('#pdfStatus');
  btn.disabled = true; btn.innerHTML = '<span class="spinner sm"></span> Building report…';
  status.innerHTML = `<div class="card" style="margin-top:16px">${spinnerHTML('Computing statistics and rendering charts for the PDF…')}</div>`;
  try {
    const d = await gatherReportData(svc, pid);
    const prevColor = Chart.defaults.color, prevBorder = Chart.defaults.borderColor;
    Chart.defaults.color = '#475569'; Chart.defaults.borderColor = 'rgba(100,116,139,.2)';

    const images = [];
    const trend = d.kpis.trend;
    if (trend?.series?.length >= 2) {
      const metric = trend.metric;
      images.push(['Monthly trend' + (trend.valueCol ? ` — total ${trend.valueCol}` : ' — record count'), await offscreenChart({
        type: 'line',
        data: { labels: trend.series.map(s => s.key), datasets: [{ label: trend.valueCol || 'Records', data: trend.series.map(s => s[metric]), borderColor: '#2563eb', backgroundColor: 'rgba(37,99,235,.15)', fill: true, tension: .3 }] },
        options: { plugins: { legend: { display: false } } },
      })]);
    }
    const cat = d.analysis.categoryBreakdowns?.[0];
    if (cat?.top?.length) {
      images.push([`${cat.valueCol ? 'Total ' + cat.valueCol : 'Records'} by ${cat.column} (top ${Math.min(8, cat.top.length)})`, await offscreenChart({
        type: 'bar',
        data: { labels: cat.top.slice(0, 8).map(t => t.key), datasets: [{ label: '', data: cat.top.slice(0, 8).map(t => t[cat.metric]), backgroundColor: PALETTE, borderRadius: 5 }] },
        options: { plugins: { legend: { display: false } } },
      })]);
    }
    Chart.defaults.color = prevColor; Chart.defaults.borderColor = prevBorder;

    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ unit: 'mm', format: 'a4' });
    const W = 210, M = 16; let y = 0;
    const line = (txt, size = 10, style = 'normal', color = [30, 41, 59], lh = null) => {
      doc.setFontSize(size); doc.setFont('helvetica', style); doc.setTextColor(...color);
      const lines = doc.splitTextToSize(txt, W - 2 * M);
      for (const l of lines) {
        if (y > 280) { doc.addPage(); y = 20; }
        doc.text(l, M, y); y += lh || size * 0.5;
      }
    };
    // header band
    doc.setFillColor(13, 27, 52); doc.rect(0, 0, W, 34, 'F');
    doc.setTextColor(255, 255, 255); doc.setFontSize(18); doc.setFont('helvetica', 'bold');
    doc.text('DataVision AI — Analysis Report', M, 15);
    doc.setFontSize(10); doc.setFont('helvetica', 'normal'); doc.setTextColor(167, 193, 255);
    doc.text(`Project: ${d.project.name}   ·   Source: ${d.project.source}   ·   Data: ${d.project.variant}`, M, 23);
    doc.text(`Generated: ${new Date().toLocaleString()}${pid === 'demo' ? '   ·   SAMPLE DATA (demo)' : ''}`, M, 29);
    y = 44;

    line('Key Performance Indicators', 14, 'bold', [13, 27, 52], 8);
    for (const k of d.kpis.kpis) line(`•  ${k.label}: ${kpiValue(k)}${k.sub ? `   (${k.sub})` : ''}`, 10.5, 'normal', [30, 41, 59], 6);
    y += 4;

    line('Data Quality', 14, 'bold', [13, 27, 52], 8);
    const p = d.profile;
    line(`Rows: ${fmtInt(p.rowCount)}   ·   Columns: ${p.colCount}   ·   Quality score: ${p.qualityScore}/100`, 10.5, 'normal', [30, 41, 59], 6);
    line(`Duplicate rows: ${p.duplicateRows}   ·   Missing cells: ${p.totalMissing}   ·   Columns with whitespace issues: ${p.whitespaceColumns.length}   ·   Mixed date formats: ${p.mixedDateColumns.length}`, 10.5, 'normal', [30, 41, 59], 6);
    y += 4;

    for (const [title, img] of images) {
      if (y > 180) { doc.addPage(); y = 20; }
      line(title, 12.5, 'bold', [13, 27, 52], 7);
      doc.addImage(img, 'PNG', M, y, W - 2 * M, (W - 2 * M) * 420 / 900);
      y += (W - 2 * M) * 420 / 900 + 8;
    }

    if (Object.keys(d.analysis.numericStats).length) {
      if (y > 230) { doc.addPage(); y = 20; }
      line('Numeric Statistics', 14, 'bold', [13, 27, 52], 8);
      for (const [c, s] of Object.entries(d.analysis.numericStats).slice(0, 10)) {
        line(`•  ${c}: sum ${fmtNum(s.sum)}, mean ${fmtNum(s.mean)}, median ${fmtNum(s.median)}, min ${fmtNum(s.min)}, max ${fmtNum(s.max)}, std ${fmtNum(s.std)}`, 10, 'normal', [30, 41, 59], 6);
      }
      y += 4;
    }

    if (y > 220) { doc.addPage(); y = 20; }
    line(`Key Findings (${d.insights.engine === 'ai' ? 'AI-generated from verified statistics' : 'rule-based engine'})`, 14, 'bold', [13, 27, 52], 8);
    for (const i of d.insights.insights.slice(0, 8)) {
      line(`•  ${i.title}`, 11, 'bold', [30, 41, 59], 6);
      line(`   ${i.text}`, 9.5, 'normal', [71, 85, 105], 5.5);
      y += 1.5;
    }

    const pages = doc.getNumberOfPages();
    for (let i = 1; i <= pages; i++) {
      doc.setPage(i); doc.setFontSize(8.5); doc.setTextColor(120, 134, 160);
      doc.text(`DataVision AI · ${d.project.name} · page ${i}/${pages}`, M, 292);
    }
    doc.save(`${d.project.name.replace(/[^a-z0-9_-]+/gi, '_')}_report.pdf`);
    status.innerHTML = '';
    toast('PDF report downloaded.', 'success');
  } catch (e) {
    status.innerHTML = `<div class="card" style="margin-top:16px">${emptyStateHTML('⚠️', 'PDF generation failed', e.message)}</div>`;
  }
  btn.disabled = false; btn.innerHTML = '⬇ Generate PDF report';
}

async function buildSummary(node, svc) {
  const btn = node.querySelector('#txtBtn');
  btn.disabled = true; btn.innerHTML = '<span class="spinner sm"></span> Preparing…';
  try {
    const [k, a, p, i] = await Promise.all([svc.kpis(), svc.analysis(), svc.profile(), svc.insights()]);
    const L = [];
    L.push('DATAVISION AI — ANALYSIS SUMMARY');
    L.push('Generated: ' + new Date().toLocaleString());
    L.push('='.repeat(60), '');
    L.push('KPIs:');
    for (const x of k.kpis) L.push(`  - ${x.label}: ${kpiValue(x)}${x.sub ? ` (${x.sub})` : ''}`);
    L.push('', `Data quality: score ${p.profile.qualityScore}/100 · ${fmtInt(p.profile.rowCount)} rows · ${p.profile.colCount} cols · ${p.profile.duplicateRows} duplicates · ${p.profile.totalMissing} missing cells`, '');
    L.push('Numeric statistics:');
    for (const [c, s] of Object.entries(a.analysis.numericStats)) L.push(`  - ${c}: sum=${s.sum} mean=${s.mean} median=${s.median} min=${s.min} max=${s.max} std=${s.std}`);
    L.push('', `Findings (${i.engine}):`);
    for (const x of i.insights) L.push(`  * ${x.title}`, `    ${x.text}`);
    const blob = new Blob([L.join('\n')], { type: 'text/plain' });
    const aEl = document.createElement('a');
    aEl.href = URL.createObjectURL(blob);
    aEl.download = 'datavision_summary.txt';
    aEl.click();
    URL.revokeObjectURL(aEl.href);
    toast('Summary downloaded.', 'success');
  } catch (e) { toast(e.message, 'error'); }
  btn.disabled = false; btn.innerHTML = '⬇ Download summary (.txt)';
}
