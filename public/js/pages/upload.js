import { el, esc, toast, renderTable, fmtInt } from '../util.js';
import { api } from '../api.js';
import { go } from '../app.js';

const MAX_MB = 15;

export function renderUpload({ layoutApp }) {
  const node = el(`<div>
    <h2 style="font-size:22px;margin-bottom:4px">Upload a dataset</h2>
    <p class="muted small" style="margin-bottom:18px">Supported formats: <b>.csv, .xlsx, .xls</b> · Max size: <b>${MAX_MB} MB</b> · Processing cap: 50,000 rows (larger files are truncated with a warning).</p>

    <div class="grid grid-2" style="align-items:start">
      <div>
        <div class="dropzone" id="dz" tabindex="0" role="button" aria-label="Upload file">
          <div class="dz-icon">📥</div>
          <h3>Drag &amp; drop your file here</h3>
          <p>or click to browse your computer</p>
          <p class="small" style="margin-top:10px">Excel (.xlsx / .xls) and CSV files, up to ${MAX_MB} MB</p>
          <input type="file" id="fileInput" accept=".csv,.xlsx,.xls" hidden/>
        </div>
        <div class="field" style="margin-top:16px">
          <label>Project name (optional)</label>
          <input class="input" id="pname" placeholder="e.g. Q3 Sales Analysis — defaults to the file name"/>
        </div>
        <div class="card" style="margin-top:4px">
          <div class="card-title">No file handy?</div>
          <p class="small muted" style="margin-bottom:12px">Use our sample sales dataset (427 demo records with realistic quality issues to clean), or explore the read-only demo.</p>
          <div style="display:flex;gap:8px;flex-wrap:wrap">
            <a class="btn btn-outline btn-sm" href="/sample-data/sample_sales_data.csv" download>⬇ Download sample CSV</a>
            <button class="btn btn-outline btn-sm" id="useSample">Import sample as a project</button>
            <a class="btn btn-ghost btn-sm" href="#/w/demo/dashboard">▶ Open demo</a>
          </div>
        </div>
      </div>
      <div id="result">
        <div class="card">
          <div class="card-title">What happens after upload?</div>
          <ol style="margin-left:18px;line-height:2;font-size:14px" class="muted">
            <li>The file is parsed on the server (first sheet for Excel files).</li>
            <li>Columns and data types are detected automatically.</li>
            <li>You get a preview plus row/column counts.</li>
            <li>The project opens with KPIs, profiling, charts and insights.</li>
          </ol>
          <p class="small muted" style="margin-top:10px">🔒 Your file is stored privately against your account. The original is never modified by cleaning operations.</p>
        </div>
      </div>
    </div>
  </div>`);

  const dz = node.querySelector('#dz');
  const input = node.querySelector('#fileInput');
  dz.onclick = () => input.click();
  dz.onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') input.click(); };
  ['dragenter', 'dragover'].forEach(ev => dz.addEventListener(ev, e => { e.preventDefault(); dz.classList.add('drag'); }));
  ['dragleave', 'drop'].forEach(ev => dz.addEventListener(ev, e => { e.preventDefault(); dz.classList.remove('drag'); }));
  dz.addEventListener('drop', e => { if (e.dataTransfer.files[0]) handleFile(node, e.dataTransfer.files[0]); });
  input.onchange = () => { if (input.files[0]) handleFile(node, input.files[0]); };

  node.querySelector('#useSample').onclick = async (e) => {
    const btn = e.target;
    btn.disabled = true; btn.innerHTML = '<span class="spinner sm"></span> Importing…';
    try {
      const blob = await (await fetch('/sample-data/sample_sales_data.csv')).blob();
      await handleFile(node, new File([blob], 'sample_sales_data.csv', { type: 'text/csv' }), 'Sample Sales Analysis');
    } catch (err) { toast(err.message, 'error'); }
    btn.disabled = false; btn.textContent = 'Import sample as a project';
  };

  layoutApp(node, { active: 'upload', title: 'Upload Data' });
}

async function handleFile(node, file, forcedName = null) {
  const result = node.querySelector('#result');
  // client-side validation (server validates again)
  if (!/\.(csv|xlsx|xls)$/i.test(file.name)) {
    result.innerHTML = errCard('Unsupported file type', `"${esc(file.name)}" is not a .csv, .xlsx or .xls file. Please convert it and try again.`);
    return;
  }
  if (file.size > MAX_MB * 1024 * 1024) {
    result.innerHTML = errCard('File too large', `This file is ${(file.size / 1048576).toFixed(1)} MB — the limit is ${MAX_MB} MB. Try splitting the data or removing unused columns.`);
    return;
  }
  result.innerHTML = `<div class="card"><div class="loading-block"><div class="spinner"></div>
    <p>Uploading and parsing <b>${esc(file.name)}</b> (${(file.size / 1024).toFixed(1)} KB)…</p></div></div>`;

  const fd = new FormData();
  fd.append('file', file);
  fd.append('name', forcedName || node.querySelector('#pname').value.trim());
  try {
    const res = await api.upload('/api/projects/upload', fd);
    const p = res.project;
    result.innerHTML = `<div class="card fade-up">
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:10px">
        <span style="font-size:24px">✅</span><div>
        <div class="card-title" style="margin:0">Upload successful</div>
        <p class="small muted">${esc(p.source_filename)} → project “${esc(p.name)}”</p></div>
      </div>
      ${res.truncated ? `<div class="demo-banner">⚠️ This file exceeded the ${fmtInt(res.maxRows)}-row processing cap. The first ${fmtInt(res.maxRows)} rows were kept.</div>` : ''}
      <div class="kpi-grid" style="grid-template-columns:repeat(3,1fr);margin-bottom:14px">
        <div class="kpi-card"><div class="k-label">Rows</div><div class="k-value">${fmtInt(p.row_count)}</div></div>
        <div class="kpi-card"><div class="k-label">Columns</div><div class="k-value">${p.col_count}</div></div>
        <div class="kpi-card"><div class="k-label">File</div><div class="k-value" style="font-size:15px;word-break:break-all">${esc(p.source_filename)}</div></div>
      </div>
      <div class="card-title" style="font-size:14px">Detected columns</div>
      <div class="chip-row">${res.columns.map(c => `<span class="badge ${c.type === 'number' ? 'blue' : c.type === 'date' ? 'teal' : c.type === 'empty' ? 'red' : ''}">${esc(c.name)} · ${c.type}</span>`).join('')}</div>
      <div class="card-title" style="font-size:14px;margin-top:12px">Data preview (first ${Math.min(20, p.row_count)} rows)</div>
      ${renderTable(res.preview, res.columns.map(c => c.name), { max: 20 })}
      <div style="display:flex;gap:10px;margin-top:16px">
        <a class="btn btn-primary" href="#/w/${p.id}/dashboard">Open dashboard →</a>
        <a class="btn btn-outline" href="#/w/${p.id}/data">Profile &amp; clean data</a>
      </div>
    </div>`;
    toast('File uploaded and parsed successfully.', 'success');
  } catch (e) {
    result.innerHTML = errCard('Upload failed', e.message);
  }
}

function errCard(title, msg) {
  return `<div class="card fade-up" style="border-color:rgba(248,113,113,.4)">
    <div style="display:flex;gap:10px;align-items:flex-start">
      <span style="font-size:22px">❌</span>
      <div><div class="card-title">${title}</div><p class="small muted">${msg}</p></div>
    </div></div>`;
}
