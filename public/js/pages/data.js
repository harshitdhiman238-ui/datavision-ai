import { el, esc, toast, spinnerHTML, emptyStateHTML, renderTable, fmtInt, confirmModal } from '../util.js';
import { api, dataService } from '../api.js';
import { wbFrame, fillCtx } from './wb.js';
import { route } from '../app.js';

export async function renderData({ layoutApp }, pid) {
  const node = wbFrame(pid, `
    <div class="tabs">
      <button class="tab active" data-t="profile">🔎 Profile &amp; Issues</button>
      <button class="tab" data-t="clean">🧹 Cleaning</button>
      <button class="tab" data-t="browse">📋 Browse Data</button>
    </div>
    <div data-p="profile">${spinnerHTML('Profiling your dataset…')}</div>
    <div data-p="clean" style="display:none"></div>
    <div data-p="browse" style="display:none"></div>
  `);
  layoutApp(node, { active: 'data', pid, title: 'Data & Cleaning' });

  node.querySelectorAll('.tab').forEach(t => t.onclick = () => {
    node.querySelectorAll('.tab').forEach(x => x.classList.toggle('active', x === t));
    node.querySelectorAll('[data-p]').forEach(p => p.style.display = p.dataset.p === t.dataset.t ? '' : 'none');
  });

  const svc = dataService(pid);
  const project = await fillCtx(node, pid).catch(() => null);

  try {
    const prof = await svc.profile();
    renderProfile(node.querySelector('[data-p="profile"]'), prof.profile, prof.variant);
    renderCleaning(node.querySelector('[data-p="clean"]'), pid, prof.profile, project);
  } catch (e) {
    node.querySelector('[data-p="profile"]').innerHTML = emptyStateHTML('⚠️', 'Profiling failed', e.message);
  }
  loadBrowse(node.querySelector('[data-p="browse"]'), svc);
}

/* ---------------- profile tab ---------------- */
function qualityColor(s) { return s >= 85 ? '#34d399' : s >= 60 ? '#fbbf24' : '#f87171'; }

function renderProfile(box, p, variant) {
  const issues = [];
  if (p.duplicateRows > 0) issues.push(['🔁', `${fmtInt(p.duplicateRows)} duplicate row(s)`, 'Exact full-row duplicates that can inflate totals. Fix in the Cleaning tab.']);
  if (p.totalMissing > 0) issues.push(['🕳️', `${fmtInt(p.totalMissing)} missing cell(s)`, `Across ${p.columns.filter(c => c.missing > 0).length} column(s). Choose a fill/drop strategy in Cleaning.`]);
  if (p.emptyColumns.length) issues.push(['🗑️', `${p.emptyColumns.length} completely empty column(s)`, p.emptyColumns.join(', ')]);
  for (const w of p.whitespaceColumns) issues.push(['✂️', `Whitespace in "${w.column}"`, `${w.count} value(s) have leading/trailing spaces — this splits categories like "North" and " North".`]);
  for (const m of p.mixedDateColumns) issues.push(['📅', `Inconsistent date formats in "${m.column}"`, `Formats found: ${m.formats.join(', ')}. Standardize to YYYY-MM-DD in Cleaning.`]);
  for (const t of p.typeIssueColumns) issues.push(['🔣', `Type problem in "${t.column}"`, t.issue]);
  for (const s of p.suspiciousValues) issues.push(['🚩', `Suspicious values in "${s.column}"`, `${s.count} value(s) flagged by rule: ${s.rule}.`]);

  box.innerHTML = `
    <div class="grid" style="grid-template-columns:260px 1fr;align-items:start">
      <div class="card" style="text-align:center">
        <div class="card-title">Data Quality Score</div>
        <div class="quality-ring" style="background:conic-gradient(${qualityColor(p.qualityScore)} ${p.qualityScore * 3.6}deg, var(--surface-3) 0deg)">
          <div style="width:92px;height:92px;border-radius:50%;background:var(--surface);display:flex;align-items:center;justify-content:center">${p.qualityScore}</div>
        </div>
        <p class="small muted" style="margin-top:12px">Based on missing cells, duplicates, whitespace and date consistency in the <b>${variant}</b> data.</p>
        <div class="grid grid-2" style="margin-top:12px;gap:8px">
          <div class="kpi-card" style="padding:10px"><div class="k-label">Rows</div><div class="k-value" style="font-size:18px">${fmtInt(p.rowCount)}</div></div>
          <div class="kpi-card" style="padding:10px"><div class="k-label">Columns</div><div class="k-value" style="font-size:18px">${p.colCount}</div></div>
        </div>
      </div>
      <div class="card">
        <div class="card-title">Detected issues (${issues.length})</div>
        ${issues.length ? issues.map(([ic, t, d]) => `<div class="issue-row"><div class="ic">${ic}</div><div class="it"><b>${esc(t)}</b><span>${esc(d)}</span></div></div>`).join('')
          : `<div class="empty-state" style="padding:30px"><div class="icon">✅</div><h3>No issues detected</h3><p>This dataset looks clean — no duplicates, missing values, whitespace or mixed date formats found.</p></div>`}
      </div>
    </div>
    <div class="card" style="margin-top:18px">
      <div class="card-title">Column profile</div>
      <div class="card-sub">Type inference, completeness and basic statistics per column.</div>
      ${renderTable(p.columns.map(c => ({
        Column: c.name, Type: c.type,
        'Missing': `${c.missing} (${c.missingPct}%)`,
        'Distinct': c.distinct,
        'Whitespace': c.whitespace || 0,
        'Stats': c.stats ? (c.stats.mean !== undefined
          ? `sum ${fmtInt(c.stats.sum)} · avg ${Number(c.stats.mean).toFixed(1)} · min ${c.stats.min} · max ${c.stats.max}`
          : `${c.stats.min} → ${c.stats.max}`) : '—',
        'Sample values': c.sample.join(' · '),
      })), null, { max: 100 })}
    </div>`;
}

/* ---------------- cleaning tab ---------------- */
function renderCleaning(box, pid, p, project) {
  if (pid === 'demo') {
    box.innerHTML = emptyStateHTML('🔒', 'Cleaning is disabled in demo mode',
      'The shared sample dataset is read-only. Create a free account and import the sample as your own project to try every cleaning feature.',
      `<a class="btn btn-primary" href="#/register">Sign up free</a> <a class="btn btn-outline" href="#/upload" style="margin-left:8px">Upload data</a>`);
    return;
  }
  const missingCols = p.columns.filter(c => c.missing > 0 && c.missing < p.rowCount);
  const dateCols = p.columns.filter(c => c.type === 'date' || p.mixedDateColumns.some(m => m.column === c.name));

  box.innerHTML = `
    ${project?.has_cleaned ? `<div class="demo-banner" style="margin-bottom:16px">ℹ️ A cleaned version is active (${fmtInt(project.cleaned_row_count)} rows). Cleaning always starts from the <b>original</b> upload, so re-applying replaces the previous cleaned version. <button class="btn btn-sm btn-outline" id="revertBtn" style="margin-left:8px">↩ Undo cleaning (back to original)</button></div>` : ''}
    <div class="grid" style="grid-template-columns:340px 1fr;align-items:start">
      <div class="card">
        <div class="card-title">Cleaning operations</div>
        <div class="card-sub">Select operations, preview, then apply. The original upload is never overwritten.</div>
        <label class="checkbox-row"><input type="checkbox" id="opDup" ${p.duplicateRows ? 'checked' : ''}/> Remove ${fmtInt(p.duplicateRows)} duplicate row(s)</label>
        <label class="checkbox-row"><input type="checkbox" id="opTrim" ${p.whitespaceColumns.length ? 'checked' : ''}/> Trim leading/trailing whitespace</label>
        ${dateCols.length ? `<div class="nav-label" style="padding-left:0">Standardize dates → YYYY-MM-DD</div>
          ${dateCols.map(c => `<label class="checkbox-row"><input type="checkbox" class="opDate" value="${esc(c.name)}" ${p.mixedDateColumns.some(m => m.column === c.name) ? 'checked' : ''}/> ${esc(c.name)}</label>`).join('')}` : ''}
        ${missingCols.length ? `<div class="nav-label" style="padding-left:0">Missing values</div>
          ${missingCols.map(c => `<div class="field" style="margin-bottom:10px"><label>${esc(c.name)} — ${c.missing} missing</label>
            <select class="input opMiss" data-col="${esc(c.name)}">
              <option value="">Leave as is</option>
              <option value="drop_row">Drop rows with missing value</option>
              ${c.type === 'number' ? `<option value="fill_mean">Fill with mean</option><option value="fill_median">Fill with median</option><option value="fill_zero">Fill with 0</option>` : ''}
              <option value="fill_mode">Fill with most frequent value</option>
              <option value="fill_value">Fill with custom value…</option>
            </select>
            <input class="input opMissVal" data-col="${esc(c.name)}" placeholder="Custom value" style="display:none;margin-top:6px"/></div>`).join('')}` : ''}
        <div class="nav-label" style="padding-left:0">Columns to remove</div>
        <div style="max-height:170px;overflow:auto">
          ${p.columns.map(c => `<label class="checkbox-row"><input type="checkbox" class="opDrop" value="${esc(c.name)}" ${p.emptyColumns.includes(c.name) ? 'checked' : ''}/> ${esc(c.name)} ${p.emptyColumns.includes(c.name) ? '<span class="badge red">empty</span>' : ''}</label>`).join('')}
        </div>
        <div style="display:flex;gap:8px;margin-top:16px;flex-wrap:wrap">
          <button class="btn btn-outline" id="previewBtn">👁 Preview changes</button>
          <button class="btn btn-primary" id="applyBtn" disabled>✔ Apply cleaning</button>
        </div>
        <p class="small muted" style="margin-top:8px">Apply is enabled after you preview, so you always see the effect first.</p>
      </div>
      <div id="cleanResult"><div class="card">${emptyStateHTML('🧪', 'Preview your cleaning plan', 'Select operations on the left and click "Preview changes" to see a before vs after comparison computed on the server — nothing is saved until you apply.')}</div></div>
    </div>`;

  box.querySelectorAll('.opMiss').forEach(sel => sel.onchange = () => {
    const inp = box.querySelector(`.opMissVal[data-col="${CSS.escape(sel.dataset.col)}"]`);
    inp.style.display = sel.value === 'fill_value' ? '' : 'none';
  });

  const collectOps = () => {
    const missing = {};
    box.querySelectorAll('.opMiss').forEach(sel => {
      if (sel.value) missing[sel.dataset.col] = {
        strategy: sel.value,
        value: box.querySelector(`.opMissVal[data-col="${CSS.escape(sel.dataset.col)}"]`)?.value,
      };
    });
    return {
      removeDuplicates: box.querySelector('#opDup')?.checked || false,
      trimWhitespace: box.querySelector('#opTrim')?.checked || false,
      standardizeDates: [...box.querySelectorAll('.opDate:checked')].map(x => x.value),
      dropColumns: [...box.querySelectorAll('.opDrop:checked')].map(x => x.value),
      missing,
    };
  };

  box.querySelector('#previewBtn').onclick = async e => {
    const btn = e.target, out = box.querySelector('#cleanResult');
    btn.disabled = true; btn.innerHTML = '<span class="spinner sm"></span> Computing…';
    out.innerHTML = `<div class="card">${spinnerHTML('Running cleaning preview on the server…')}</div>`;
    try {
      const r = await api.post(`/api/projects/${pid}/clean/preview`, { ops: collectOps() });
      const cmp = (label, b, a, invert = false) => {
        const good = invert ? a > b : a < b;
        const same = a === b;
        return `<tr><td>${label}</td><td class="num">${fmtInt(b)}</td><td class="num">${fmtInt(a)}</td>
          <td>${same ? '<span class="badge">unchanged</span>' : `<span class="badge ${good ? 'green' : 'amber'}">${a > b ? '+' : ''}${fmtInt(a - b)}</span>`}</td></tr>`;
      };
      out.innerHTML = `<div class="card fade-up">
        <div class="card-title">Before → After comparison</div>
        <div class="table-wrap" style="max-height:none"><table class="dv">
          <thead><tr><th>Metric</th><th>Before</th><th>After</th><th>Change</th></tr></thead><tbody>
          ${cmp('Rows', r.before.rows, r.after.rows)}
          ${cmp('Columns', r.before.cols, r.after.cols)}
          ${cmp('Duplicate rows', r.before.profile.duplicateRows, r.after.profile.duplicateRows)}
          ${cmp('Missing cells', r.before.profile.totalMissing, r.after.profile.totalMissing)}
          ${cmp('Whitespace issues', r.before.profile.whitespaceColumns.reduce((s, w) => s + w.count, 0), r.after.profile.whitespaceColumns.reduce((s, w) => s + w.count, 0))}
          ${cmp('Quality score', r.before.profile.qualityScore, r.after.profile.qualityScore, true)}
        </tbody></table></div>
        <div class="card-title" style="margin-top:16px;font-size:14px">Operations log</div>
        <ul style="margin-left:18px" class="small muted">${r.log.length ? r.log.map(l => `<li>${esc(l)}</li>`).join('') : '<li>No operations selected.</li>'}</ul>
        <div class="card-title" style="margin-top:16px;font-size:14px">Preview of cleaned data (first 15 rows)</div>
        ${renderTable(r.preview, r.columns.map(c => c.name), { max: 15 })}
      </div>`;
      box.querySelector('#applyBtn').disabled = false;
      toast('Preview ready — review the comparison, then apply.', 'success');
    } catch (err) {
      out.innerHTML = `<div class="card">${emptyStateHTML('⚠️', 'Preview failed', err.message)}</div>`;
    }
    btn.disabled = false; btn.textContent = '👁 Preview changes';
  };

  box.querySelector('#applyBtn').onclick = async e => {
    const btn = e.target;
    btn.disabled = true; btn.innerHTML = '<span class="spinner sm"></span> Applying…';
    try {
      const r = await api.post(`/api/projects/${pid}/clean/apply`, { ops: collectOps() });
      toast(`Cleaning applied — ${fmtInt(r.rowCount)} rows in the cleaned dataset. Dashboards now use it.`, 'success');
      route(); // re-render page with fresh profile
    } catch (err) {
      toast(err.message, 'error');
      btn.disabled = false; btn.textContent = '✔ Apply cleaning';
    }
  };

  const revert = box.querySelector('#revertBtn');
  if (revert) revert.onclick = async () => {
    const ok = await confirmModal('Undo cleaning?', 'The cleaned version will be discarded and all analyses will use the original upload again. You can re-clean at any time.', 'Undo cleaning');
    if (!ok) return;
    try {
      await api.post(`/api/projects/${pid}/clean/revert`, {});
      toast('Reverted to the original dataset.', 'success');
      route();
    } catch (e) { toast(e.message, 'error'); }
  };
}

/* ---------------- browse tab ---------------- */
async function loadBrowse(box, svc) {
  box.innerHTML = spinnerHTML('Loading rows…');
  try {
    const d = await svc.data('?limit=500');
    box.innerHTML = `<div class="card">
      <div class="card-title">Data browser — ${fmtInt(d.total)} rows (${d.variant})</div>
      <div class="card-sub">Showing the first ${Math.min(500, d.total)} rows. Column types: ${d.columns.map(c => `<span class="badge ${c.type === 'number' ? 'blue' : c.type === 'date' ? 'teal' : ''}">${esc(c.name)}·${c.type}</span>`).join(' ')}</div>
      <div class="field"><input class="input" id="filterBox" placeholder="🔍 Quick filter visible rows (type to search)…"/></div>
      <div class="card-sub">Tip: click a column header to sort (A→Z, Z→A, then original order).</div>
      <div id="tbl">${renderTable(d.rows, d.columns.map(c => c.name), { max: 500 })}</div>
    </div>`;
    const input = box.querySelector('#filterBox');
    const colNames = d.columns.map(c => c.name);
    const colTypes = Object.fromEntries(d.columns.map(c => [c.name, c.type]));
    let sortCol = null, sortDir = 0; // 0 = original order, 1 = asc, -1 = desc

    const currentRows = () => {
      const q = input.value.toLowerCase();
      let rows = q ? d.rows.filter(r => Object.values(r).some(v => String(v ?? '').toLowerCase().includes(q))) : d.rows.slice();
      if (sortCol && sortDir !== 0) {
        const numeric = colTypes[sortCol] === 'number';
        rows = rows.slice().sort((a, b) => {
          const av = a[sortCol], bv = b[sortCol];
          const aEmpty = av === null || av === undefined || av === '';
          const bEmpty = bv === null || bv === undefined || bv === '';
          if (aEmpty && bEmpty) return 0;
          if (aEmpty) return 1;              // empties always last
          if (bEmpty) return -1;
          let cmp;
          if (numeric) cmp = (Number(String(av).replace(/[,₹$€£%\s]/g, '')) || 0) - (Number(String(bv).replace(/[,₹$€£%\s]/g, '')) || 0);
          else cmp = String(av).localeCompare(String(bv), undefined, { numeric: true, sensitivity: 'base' });
          return cmp * sortDir;
        });
      }
      return rows;
    };

    const redraw = () => {
      box.querySelector('#tbl').innerHTML = renderTable(currentRows(), colNames, { max: 500 });
      // decorate headers: pointer cursor + sort arrow + click-to-sort
      box.querySelectorAll('#tbl th').forEach(th => {
        const name = th.textContent.replace(/ [▲▼]$/, '').trim();
        if (!colNames.includes(name)) return;
        th.style.cursor = 'pointer';
        th.title = 'Click to sort';
        if (name === sortCol && sortDir === 1) th.textContent = `${name} ▲`;
        else if (name === sortCol && sortDir === -1) th.textContent = `${name} ▼`;
        th.onclick = () => {
          if (sortCol !== name) { sortCol = name; sortDir = 1; }
          else if (sortDir === 1) sortDir = -1;
          else { sortCol = null; sortDir = 0; }
          redraw();
        };
      });
    };

    input.oninput = redraw;
    redraw();
  } catch (e) {
    box.innerHTML = emptyStateHTML('⚠️', 'Could not load data', e.message);
  }
}
