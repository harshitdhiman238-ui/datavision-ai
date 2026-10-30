import { el, esc, fmtNum, fmtInt, makeChart, PALETTE } from '../util.js';
import { api } from '../api.js';

const FEATURES = [
  ['📥', 'Excel & CSV Upload', 'Drag-and-drop .xlsx, .xls or .csv files. Instant parsing, schema detection and preview — your actual data, not a mock-up.'],
  ['🧹', 'Data Profiling & Cleaning', 'Detect missing values, duplicates, whitespace and mixed date formats. Fix them with preview-before-apply cleaning tools.'],
  ['📊', 'Interactive Dashboards', 'KPIs and charts computed live from your dataset — bar, line, pie, area, histogram and scatter with filters.'],
  ['🧮', 'Automatic Analysis', 'Sums, averages, category comparisons, time trends, correlations and outlier detection on real numbers.'],
  ['💡', 'Smart Insights', 'Plain-English findings backed by verified statistics, plus natural-language questions like "show monthly sales".'],
  ['📄', 'Reports & Exports', 'Download cleaned CSV, Excel workbooks with summary sheets, and PDF reports with your KPIs and charts.'],
];

export function renderLanding({ layoutPublic }) {
  const node = el(`<main>
    <section class="hero">
      <div class="eyebrow">✨ Smart Data Analytics Platform · BCA Portfolio Project</div>
      <h1>Turn Your Data Into <span class="grad">Actionable Insights.</span></h1>
      <p class="lead">Upload an Excel or CSV file and DataVision AI profiles it, cleans it, builds interactive dashboards and answers your questions — all computed from your real data.</p>
      <div class="cta-row">
        <a class="btn btn-primary btn-lg" href="#/register">Get Started — It's Free</a>
        <a class="btn btn-outline btn-lg" href="#/w/demo/dashboard">▶ Try Demo Dashboard</a>
      </div>
      <p class="small muted" style="margin-top:14px">No upload needed for the demo — it uses a clearly-labelled sample sales dataset.</p>
    </section>

    <section class="section">
      <h2>Everything you need, from upload to report</h2>
      <p class="section-sub">A complete upload → clean → analyse → report workflow in one place.</p>
      <div class="grid grid-3">
        ${FEATURES.map(([i, t, d]) => `<div class="card feature-card"><div class="fi">${i}</div><h3>${t}</h3><p>${d}</p></div>`).join('')}
      </div>
    </section>

    <section class="section">
      <h2>How it works</h2>
      <p class="section-sub">Four simple steps from raw file to shareable report.</p>
      <div class="workflow">
        ${[['01', 'Upload', 'Drop in a .csv, .xlsx or .xls file (up to 15 MB). We detect columns and data types automatically.'],
           ['02', 'Clean', 'Review quality issues and apply cleaning operations — the original file is always preserved.'],
           ['03', 'Analyse', 'Explore adaptive KPIs, interactive charts with filters, statistics and insights.'],
           ['04', 'Report', 'Export cleaned data, Excel summaries and a PDF report with your findings.']]
          .map(([n, t, d]) => `<div class="card wf-step"><div class="num">STEP ${n}</div><h3>${t}</h3><p>${d}</p></div>`).join('')}
      </div>
    </section>

    <section class="section">
      <h2>Live dashboard preview</h2>
      <p class="section-sub">These numbers are computed right now from the bundled <b>sample sales dataset</b> — the same engine runs on your files.</p>
      <div class="preview-frame">
        <div class="pf-bar"><span></span><span></span><span></span></div>
        <div class="preview-body">
          <div class="chart-card"><h3>Monthly Revenue — Sample Data</h3><div class="cc-sub">Sum of Revenue per month</div><div class="chart-box"><canvas id="lpTrend"></canvas></div></div>
          <div>
            <div class="kpi-grid" id="lpKpis" style="grid-template-columns:repeat(2,1fr)"></div>
            <div class="chart-card"><h3>Revenue by Category — Sample Data</h3><div class="chart-box" style="height:200px"><canvas id="lpCat"></canvas></div></div>
          </div>
        </div>
      </div>
      <div style="text-align:center;margin-top:26px">
        <a class="btn btn-primary btn-lg" href="#/w/demo/dashboard">Explore the Full Demo →</a>
        <a class="btn btn-ghost btn-lg" href="/sample-data/sample_sales_data.csv" download>⬇ Download sample dataset</a>
      </div>
    </section>
  </main>`);

  layoutPublic(node);
  fillPreview(node).catch(() => {
    node.querySelector('#lpKpis').innerHTML = '<p class="muted small">Preview unavailable — start the server to compute sample metrics.</p>';
  });
}

async function fillPreview(node) {
  const [k, a] = await Promise.all([api.get('/api/demo/kpis'), api.get('/api/demo/analysis')]);
  const kpis = k.kpis.slice(0, 4);
  node.querySelector('#lpKpis').innerHTML = kpis.map((x, i) => `
    <div class="kpi-card" style="animation-delay:${i * 60}ms">
      <div class="k-label">${esc(x.label)} <span class="badge amber" style="font-size:10px">SAMPLE</span></div>
      <div class="k-value">${x.kind === 'int' ? fmtInt(x.value) : x.kind === 'pct' ? x.value.toFixed(1) + '%' : fmtNum(x.value)}</div>
    </div>`).join('');

  if (k.trend?.series) {
    makeChart(node.querySelector('#lpTrend'), {
      type: 'line',
      data: { labels: k.trend.series.map(s => s.key), datasets: [{ label: 'Revenue', data: k.trend.series.map(s => s.sum), borderColor: '#3b82f6', backgroundColor: 'rgba(59,130,246,.15)', fill: true, tension: .35, pointRadius: 2 }] },
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } } },
    });
  }
  const cat = a.analysis.categoryBreakdowns[0];
  if (cat) {
    makeChart(node.querySelector('#lpCat'), {
      type: 'doughnut',
      data: { labels: cat.top.slice(0, 5).map(t => t.key), datasets: [{ data: cat.top.slice(0, 5).map(t => t.sum), backgroundColor: PALETTE, borderWidth: 0 }] },
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'right', labels: { boxWidth: 12 } } } },
    });
  }
}

const STATIC_PAGES = {
  about: ['About DataVision AI', `
    <p>DataVision AI is a smart data analytics platform built as a BCA college project and data-analyst portfolio piece. It demonstrates a complete, working analytics workflow: file upload and parsing, data profiling, cleaning, statistical analysis, interactive visualization, plain-English insights and report generation.</p>
    <p style="margin-top:12px"><b>Technology:</b> Node.js + Express backend, SQLite database, SheetJS for Excel/CSV parsing, Chart.js for visualization, jsPDF for reports, and JWT-based authentication with bcrypt password hashing.</p>
    <p style="margin-top:12px">All metrics shown in the app are genuinely calculated from the uploaded dataset — nothing is hardcoded or invented.</p>`],
  privacy: ['Privacy Policy', `
    <p>This is an educational project. Please avoid uploading sensitive or personal data.</p>
    <ul style="margin:12px 0 0 20px;line-height:2">
      <li>Your password is stored only as a bcrypt hash — never in plain text.</li>
      <li>Uploaded datasets are stored on the server and are accessible only to your account (and administrators for maintenance).</li>
      <li>You can delete a project at any time; its stored dataset files are removed with it.</li>
      <li>Sessions use httpOnly cookies; no analytics trackers are used.</li>
      <li>If an AI API key is configured by the operator, only computed summary statistics (never your raw file) are sent to the AI provider to phrase insights.</li>
    </ul>`],
  contact: ['Contact', `
    <p>DataVision AI is a student project built for demonstration purposes.</p>
    <ul style="margin:12px 0 0 20px;line-height:2">
      <li>📧 Email: <a href="mailto:hello@datavision.local">hello@datavision.local</a> (placeholder address)</li>
      <li>💻 Source code: included in the project folder — see <b>README.md</b> for setup instructions.</li>
      <li>🎓 Context: BCA final-year project / data-analyst portfolio.</li>
    </ul>`],
};

export function renderStaticPage({ layoutPublic }, page) {
  const [title, html] = STATIC_PAGES[page];
  const node = el(`<main class="section" style="min-height:60vh;max-width:760px">
    <h2 style="text-align:left">${esc(title)}</h2>
    <div class="card" style="margin-top:18px">${html}</div>
  </main>`);
  layoutPublic(node);
}
