// ---------------------------------------------------------------
// Spreadsheet — Excel-like editable grid with formulas, sorting,
// filtering, a pivot/summary panel and CSV/XLSX export.
// Pure client-side: a safe recursive-descent formula parser is used
// (no eval / no arbitrary code execution). Sheet auto-saves to
// this browser's localStorage.
// Formulas: =SUM, =AVERAGE/AVG, =COUNT, =COUNTA, =MAX, =MIN,
//           =IF(cond, then, else)  + arithmetic  + - * / % ^
//           cell refs (A1), ranges (A1:B5), comparisons (= <> < > <= >=)
// ---------------------------------------------------------------
import { el, esc, toast, fmtNum, spinnerHTML } from '../util.js';
import { api } from '../api.js';

const LS_KEY = 'dv_sheet_v1';
const START_ROWS = 25, START_COLS = 10, MAX_ROWS = 500, MAX_COLS = 26;

/* ================= model ================= */
let S = null; // { rows, cols, data: string[][] }

function blankSheet(rows = START_ROWS, cols = START_COLS) {
  return { rows, cols, data: Array.from({ length: rows }, () => Array(cols).fill('')) };
}
function loadSheet() {
  try {
    const s = JSON.parse(localStorage.getItem(LS_KEY));
    if (s && Array.isArray(s.data)) return s;
  } catch { /* ignore */ }
  return blankSheet();
}
const saveSheet = () => { try { localStorage.setItem(LS_KEY, JSON.stringify(S)); } catch { /* full */ } };

export const colName = i => { let n = ''; i++; while (i > 0) { n = String.fromCharCode(65 + ((i - 1) % 26)) + n; i = Math.floor((i - 1) / 26); } return n; };
const refToRC = ref => {
  const m = /^([A-Za-z]+)([0-9]+)$/.exec(ref.trim()); if (!m) return null;
  let c = 0; for (const ch of m[1].toUpperCase()) c = c * 26 + (ch.charCodeAt(0) - 64);
  return { r: +m[2] - 1, c: c - 1 };
};

/* ================= formula engine (safe parser, no eval) ================= */
const TOKEN_RE = /\s*([A-Za-z]+[0-9]+|[A-Za-z]+|[0-9]*\.?[0-9]+|"[^"]*"|<>|<=|>=|[+\-*/%^(),:=<>])/y;

function tokenize(src) {
  const out = []; let i = 0;
  while (i < src.length) {
    TOKEN_RE.lastIndex = i;
    const m = TOKEN_RE.exec(src);
    if (!m) { if (/\s/.test(src[i])) { i++; continue; } throw new Error('#ERROR'); }
    out.push(m[1]); i = TOKEN_RE.lastIndex;
  }
  return out;
}

// Evaluate the raw content of cell (r,c). `cache` memoises per recompute
// pass; `stack` detects circular references.
function evalCell(r, c, cache, stack) {
  const key = r + ',' + c;
  if (cache.has(key)) return cache.get(key);
  if (stack.has(key)) throw new Error('#CYCLE!');
  const raw = (S.data[r] && S.data[r][c]) ?? '';
  let val;
  if (typeof raw === 'string' && raw.startsWith('=')) {
    stack.add(key);
    try { val = evalFormula(raw.slice(1), cache, stack); }
    finally { stack.delete(key); }
  } else if (raw === '' || raw === null) val = '';
  else if (!isNaN(Number(raw)) && String(raw).trim() !== '') val = Number(raw);
  else val = raw;
  cache.set(key, val);
  return val;
}

function evalFormula(src, cache, stack) {
  const t = tokenize(src); let p = 0;
  const peek = () => t[p], next = () => t[p++];
  const num = v => { if (v === '' || v === null || v === undefined || v === false) return 0; if (v === true) return 1; const n = Number(v); if (isNaN(n)) throw new Error('#VALUE!'); return n; };
  const truthy = v => v === true || (typeof v === 'number' && v !== 0) || (typeof v === 'string' && v !== '' && v.toUpperCase() !== 'FALSE');

  // Flatten an argument (value or range) into an array of cell values
  const flatten = arg => Array.isArray(arg) ? arg : [arg];

  function parseArgs() {
    const args = [];
    if (peek() === ')') return args;
    for (;;) {
      args.push(parseArg());
      if (peek() === ',') { next(); continue; }
      break;
    }
    return args;
  }
  function parseArg() {
    // range: REF : REF
    if (/^[A-Za-z]+[0-9]+$/.test(peek() || '') && t[p + 1] === ':') {
      const a = refToRC(next()); next(); const b = refToRC(next());
      if (!a || !b) throw new Error('#REF!');
      const vals = [];
      for (let r = Math.min(a.r, b.r); r <= Math.max(a.r, b.r); r++)
        for (let c = Math.min(a.c, b.c); c <= Math.max(a.c, b.c); c++)
          if (r < S.rows && c < S.cols) vals.push(evalCell(r, c, cache, stack));
      return vals;
    }
    return parseExpr();
  }

  const FUNCS = {
    SUM: a => a.reduce((s, v) => s + (typeof v === 'number' ? v : (v !== '' && !isNaN(Number(v)) ? Number(v) : 0)), 0),
    AVERAGE: a => { const n = a.filter(v => v !== '' && !isNaN(Number(v)) && v !== null); return n.length ? n.reduce((s, v) => s + Number(v), 0) / n.length : 0; },
    COUNT: a => a.filter(v => v !== '' && v !== null && !isNaN(Number(v))).length,
    COUNTA: a => a.filter(v => v !== '' && v !== null && v !== undefined).length,
    MAX: a => { const n = a.filter(v => v !== '' && !isNaN(Number(v))).map(Number); return n.length ? Math.max(...n) : 0; },
    MIN: a => { const n = a.filter(v => v !== '' && !isNaN(Number(v))).map(Number); return n.length ? Math.min(...n) : 0; },
  };
  FUNCS.AVG = FUNCS.AVERAGE;

  function parsePrimary() {
    const tok = next();
    if (tok === undefined) throw new Error('#ERROR');
    if (tok === '(') { const v = parseExpr(); if (next() !== ')') throw new Error('#ERROR'); return v; }
    if (tok === '-') return -num(parsePrimary());
    if (tok === '+') return num(parsePrimary());
    if (/^[0-9]*\.?[0-9]+$/.test(tok)) return Number(tok);
    if (/^"[^"]*"$/.test(tok)) return tok.slice(1, -1);
    if (/^[A-Za-z]+[0-9]+$/.test(tok)) {
      const rc = refToRC(tok);
      if (!rc || rc.r >= MAX_ROWS || rc.c >= MAX_COLS) throw new Error('#REF!');
      return (rc.r < S.rows && rc.c < S.cols) ? evalCell(rc.r, rc.c, cache, stack) : '';
    }
    if (/^[A-Za-z]+$/.test(tok)) {
      const fn = tok.toUpperCase();
      if (next() !== '(') throw new Error('#NAME?');
      const args = parseArgs();
      if (next() !== ')') throw new Error('#ERROR');
      if (fn === 'IF') {
        if (args.length < 2) throw new Error('#ERROR');
        return truthy(args[0]) ? args[1] : (args.length > 2 ? args[2] : '');
      }
      if (FUNCS[fn]) return FUNCS[fn](args.flatMap(flatten));
      throw new Error('#NAME?');
    }
    throw new Error('#ERROR');
  }
  function parsePow() { let v = parsePrimary(); while (peek() === '^') { next(); v = Math.pow(num(v), num(parsePrimary())); } return v; }
  function parseMul() {
    let v = parsePow();
    while (peek() === '*' || peek() === '/' || peek() === '%') {
      const op = next(), r = parsePow();
      v = op === '*' ? num(v) * num(r) : op === '/' ? num(v) / num(r) : num(v) % num(r);
    }
    return v;
  }
  function parseAdd() {
    let v = parseMul();
    while (peek() === '+' || peek() === '-') {
      const op = next(), r = parseMul();
      v = op === '+' ? num(v) + num(r) : num(v) - num(r);
    }
    return v;
  }
  function parseExpr() {
    let v = parseAdd();
    while (['=', '<>', '<', '>', '<=', '>='].includes(peek())) {
      const op = next(), r = parseAdd();
      const bothNum = !isNaN(Number(v)) && !isNaN(Number(r)) && v !== '' && r !== '';
      const a = bothNum ? Number(v) : String(v).toLowerCase(), b = bothNum ? Number(r) : String(r).toLowerCase();
      v = op === '=' ? a === b : op === '<>' ? a !== b : op === '<' ? a < b : op === '>' ? a > b : op === '<=' ? a <= b : a >= b;
    }
    return v;
  }

  const result = parseExpr();
  if (p !== t.length) throw new Error('#ERROR');
  return result;
}

// Recompute the whole sheet → { values, display } (2D arrays)
function computeAll() {
  const cache = new Map();
  const values = [], display = [];
  for (let r = 0; r < S.rows; r++) {
    values[r] = []; display[r] = [];
    for (let c = 0; c < S.cols; c++) {
      try {
        const v = evalCell(r, c, cache, new Set());
        values[r][c] = v;
        display[r][c] = v === '' ? '' : (typeof v === 'number' ? (Number.isInteger(v) ? v.toLocaleString('en-IN') : fmtNum(v)) : (v === true ? 'TRUE' : v === false ? 'FALSE' : String(v)));
      } catch (e) {
        values[r][c] = null;
        display[r][c] = e.message.startsWith('#') ? e.message : '#ERROR';
      }
    }
  }
  return { values, display };
}

/* ================= page ================= */
export async function renderSheet(ctx) {
  S = loadSheet();
  let sel = { r: 0, c: 0, r2: 0, c2: 0 };    // selection rectangle
  let sortState = { col: -1, dir: 0 };
  let filters = Array(S.cols).fill('');
  let editing = null;
  let computed = computeAll();

  const node = el(`<div>
    <div class="card" style="margin-bottom:14px">
      <div class="sheet-toolbar">
        <label class="btn btn-ghost btn-sm">📥 Import CSV/Excel<input type="file" accept=".csv,.xlsx,.xls" hidden id="shImport"/></label>
        <select class="input btn-sm" id="shProj" style="max-width:210px"><option value="">Load from My Projects…</option></select>
        <span class="sheet-sep"></span>
        <button class="btn btn-ghost btn-sm" id="shAddRow">+ Row</button>
        <button class="btn btn-ghost btn-sm" id="shAddCol">+ Column</button>
        <button class="btn btn-ghost btn-sm" id="shClear">🗑 Clear sheet</button>
        <span class="sheet-sep"></span>
        <button class="btn btn-primary btn-sm" id="shCsv">⬇ Export CSV</button>
        <button class="btn btn-primary btn-sm" id="shXlsx">⬇ Export Excel</button>
      </div>
      <div class="sheet-fbar">
        <span class="sheet-cellname" id="shName">A1</span>
        <input class="input" id="shFx" placeholder='Type a value or formula, e.g. =SUM(A1:A10) or =IF(B2>100,"High","Low")'/>
      </div>
      <p class="small muted" style="margin:8px 0 0">Formulas: <code>=SUM</code> <code>=AVERAGE</code> <code>=COUNT</code> <code>=COUNTA</code> <code>=MAX</code> <code>=MIN</code> <code>=IF</code> · cell refs <code>A1</code>, ranges <code>A1:B5</code>, maths <code>+ - * / % ^</code>, compare <code>= &lt;&gt; &lt; &gt; &lt;= &gt;=</code>. Double-click a cell (or press Enter) to edit · click a column letter to sort · use the filter row to search. Auto-saved in this browser.</p>
    </div>

    <div class="card" style="padding:0;overflow:hidden">
      <div class="sheet-wrap" id="shWrap" tabindex="0"></div>
      <div class="sheet-status" id="shStatus"></div>
    </div>

    <div class="card" style="margin-top:14px">
      <div class="card-title">📊 Pivot / Data Summary</div>
      <div class="card-sub">Group one column by another and aggregate — like a mini pivot table. Uses the rows currently visible (filters applied).</div>
      <div class="sheet-toolbar" style="margin-top:10px">
        <label class="small muted" style="display:flex;align-items:center;gap:6px"><input type="checkbox" id="pvHeader" checked/> First row is header</label>
        <select class="input btn-sm" id="pvGroup" style="max-width:180px"></select>
        <select class="input btn-sm" id="pvAgg" style="max-width:130px">
          <option value="sum">Sum</option><option value="avg">Average</option><option value="count">Count</option>
        </select>
        <select class="input btn-sm" id="pvVal" style="max-width:180px"></select>
        <button class="btn btn-primary btn-sm" id="pvRun">Generate summary</button>
      </div>
      <div id="pvOut" style="margin-top:12px"></div>
    </div>
  </div>`);

  ctx.layoutApp(node, { active: 'sheet', title: 'Spreadsheet' });

  const wrap = node.querySelector('#shWrap');
  const fx = node.querySelector('#shFx');
  const nameBox = node.querySelector('#shName');
  const statusBar = node.querySelector('#shStatus');

  /* ---------- helpers ---------- */
  const usedRange = () => {
    let mr = 0, mc = 0;
    for (let r = 0; r < S.rows; r++) for (let c = 0; c < S.cols; c++)
      if (String(S.data[r][c] ?? '') !== '') { mr = Math.max(mr, r + 1); mc = Math.max(mc, c + 1); }
    return { rows: mr, cols: mc };
  };
  const rowVisible = r => filters.every((f, c) => !f || String(computed.display[r]?.[c] ?? '').toLowerCase().includes(f.toLowerCase()));
  // The "data block" ends at the first fully-empty row — so summary
  // formulas kept below a blank row are never sorted/aggregated as data.
  const dataBlockEnd = (header, used) => {
    for (let r = header; r < used.rows; r++)
      if (S.data[r].slice(0, used.cols).every(v => String(v ?? '') === '')) return r;
    return used.rows;
  };
  const recompute = () => { computed = computeAll(); };

  const commit = (r, c, raw) => {
    S.data[r][c] = raw;
    recompute(); saveSheet(); renderGrid(); updateStatus(); fillPivotSelects();
  };

  /* ---------- grid render ---------- */
  function renderGrid() {
    const selMinR = Math.min(sel.r, sel.r2), selMaxR = Math.max(sel.r, sel.r2);
    const selMinC = Math.min(sel.c, sel.c2), selMaxC = Math.max(sel.c, sel.c2);
    let html = '<table class="sheet"><thead><tr><th class="sh-corner"></th>';
    for (let c = 0; c < S.cols; c++) {
      const arrow = sortState.col === c ? (sortState.dir === 1 ? ' ▲' : ' ▼') : '';
      html += `<th class="sh-col" data-c="${c}" title="Click to sort">${colName(c)}${arrow}</th>`;
    }
    html += '</tr><tr class="sh-filterrow"><th class="sh-corner">🔍</th>';
    for (let c = 0; c < S.cols; c++)
      html += `<th><input class="sh-filter" data-c="${c}" value="${esc(filters[c] || '')}" placeholder="filter"/></th>`;
    html += '</tr></thead><tbody>';
    for (let r = 0; r < S.rows; r++) {
      html += `<tr data-r="${r}" ${rowVisible(r) ? '' : 'style="display:none"'}><th class="sh-row">${r + 1}</th>`;
      for (let c = 0; c < S.cols; c++) {
        const inSel = r >= selMinR && r <= selMaxR && c >= selMinC && c <= selMaxC;
        const isAnchor = r === sel.r && c === sel.c;
        const d = computed.display[r][c];
        const isNum = typeof computed.values[r][c] === 'number';
        const isErr = typeof d === 'string' && d.startsWith('#');
        html += `<td class="sh-cell ${inSel ? 'sel' : ''} ${isAnchor ? 'anchor' : ''} ${isNum ? 'num' : ''} ${isErr ? 'err' : ''}" data-r="${r}" data-c="${c}">${esc(d)}</td>`;
      }
      html += '</tr>';
    }
    html += '</tbody></table>';
    wrap.innerHTML = html;
    bindGrid();
    syncFx();
  }

  function syncFx() {
    nameBox.textContent = colName(sel.c) + (sel.r + 1);
    fx.value = String(S.data[sel.r]?.[sel.c] ?? '');
  }

  // Lightweight selection repaint — no DOM rebuild, so double-click
  // and drag selection work smoothly.
  function paintSel() {
    const minR = Math.min(sel.r, sel.r2), maxR = Math.max(sel.r, sel.r2);
    const minC = Math.min(sel.c, sel.c2), maxC = Math.max(sel.c, sel.c2);
    wrap.querySelectorAll('td.sh-cell').forEach(td => {
      const r = +td.dataset.r, c = +td.dataset.c;
      td.classList.toggle('sel', r >= minR && r <= maxR && c >= minC && c <= maxC);
      td.classList.toggle('anchor', r === sel.r && c === sel.c);
    });
    syncFx();
  }

  function updateStatus() {
    const minR = Math.min(sel.r, sel.r2), maxR = Math.max(sel.r, sel.r2);
    const minC = Math.min(sel.c, sel.c2), maxC = Math.max(sel.c, sel.c2);
    const nums = [];
    let cells = 0, nonEmpty = 0;
    for (let r = minR; r <= maxR; r++) for (let c = minC; c <= maxC; c++) {
      cells++;
      const v = computed.values[r]?.[c];
      if (v !== '' && v !== null && v !== undefined) nonEmpty++;
      if (typeof v === 'number') nums.push(v);
    }
    if (cells <= 1 && !nums.length) { statusBar.innerHTML = `<span class="muted">Select cells (click &amp; drag) to see Sum · Average · Count here — like Excel's status bar.</span>`; return; }
    const sum = nums.reduce((a, b) => a + b, 0);
    statusBar.innerHTML = `
      <span><b>${cells}</b> cell(s)</span><span>Count: <b>${nonEmpty}</b></span><span>Numbers: <b>${nums.length}</b></span>
      ${nums.length ? `<span>Sum: <b>${fmtNum(sum)}</b></span><span>Average: <b>${fmtNum(sum / nums.length)}</b></span><span>Min: <b>${fmtNum(Math.min(...nums))}</b></span><span>Max: <b>${fmtNum(Math.max(...nums))}</b></span>` : ''}`;
  }

  /* ---------- cell editing ---------- */
  function startEdit(r, c, seed) {
    if (editing) stopEdit(true);
    const td = wrap.querySelector(`td[data-r="${r}"][data-c="${c}"]`);
    if (!td) return;
    const inp = document.createElement('input');
    inp.className = 'sh-edit';
    inp.value = seed !== undefined ? seed : String(S.data[r][c] ?? '');
    td.innerHTML = ''; td.appendChild(inp);
    inp.focus(); if (seed === undefined) inp.select(); else inp.setSelectionRange(inp.value.length, inp.value.length);
    editing = { r, c, inp };
    inp.onkeydown = e => {
      if (e.key === 'Enter') { e.preventDefault(); stopEdit(true); move(1, 0); }
      else if (e.key === 'Tab') { e.preventDefault(); stopEdit(true); move(0, 1); }
      else if (e.key === 'Escape') { stopEdit(false); }
      e.stopPropagation();
    };
    inp.onblur = () => { if (editing) stopEdit(true); };
  }
  function stopEdit(save) {
    if (!editing) return;
    const { r, c, inp } = editing;
    const v = inp.value; editing = null;
    if (save) commit(r, c, v);
    else { renderGrid(); }
  }
  function move(dr, dc) {
    sel = { r: Math.min(Math.max(sel.r + dr, 0), S.rows - 1), c: Math.min(Math.max(sel.c + dc, 0), S.cols - 1), r2: 0, c2: 0 };
    sel.r2 = sel.r; sel.c2 = sel.c;
    paintSel(); updateStatus();
    wrap.querySelector(`td[data-r="${sel.r}"][data-c="${sel.c}"]`)?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }

  /* ---------- grid events ---------- */
  let dragging = false;
  function bindGrid() {
    wrap.querySelectorAll('td.sh-cell').forEach(td => {
      td.onmousedown = e => {
        const r = +td.dataset.r, c = +td.dataset.c;
        if (editing) { if (editing.r === r && editing.c === c) return; stopEdit(true); }
        dragging = true;
        sel = { r, c, r2: r, c2: c };
        paintSel(); updateStatus();
        e.preventDefault(); wrap.focus();
      };
      td.onmouseover = () => {
        if (!dragging) return;
        sel.r2 = +td.dataset.r; sel.c2 = +td.dataset.c;
        paintSel(); updateStatus();
      };
      td.ondblclick = () => startEdit(+td.dataset.r, +td.dataset.c);
    });
    wrap.querySelectorAll('.sh-col').forEach(th => {
      th.onclick = () => sortByColumn(+th.dataset.c);
    });
    wrap.querySelectorAll('.sh-filter').forEach(inp => {
      inp.oninput = () => {
        filters[+inp.dataset.c] = inp.value;
        // only toggle row visibility — no full re-render, keeps focus
        wrap.querySelectorAll('tbody tr').forEach(tr => {
          tr.style.display = rowVisible(+tr.dataset.r) ? '' : 'none';
        });
      };
      inp.onmousedown = e => e.stopPropagation();
    });
  }
  document.addEventListener('mouseup', () => { dragging = false; });

  wrap.addEventListener('keydown', e => {
    // ignore keys typed inside the cell editor or the filter inputs
    if (editing || e.target.tagName === 'INPUT') return;
    if (e.key === 'ArrowDown') { e.preventDefault(); move(1, 0); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); move(-1, 0); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); move(0, -1); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); move(0, 1); }
    else if (e.key === 'Enter' || e.key === 'F2') { e.preventDefault(); startEdit(sel.r, sel.c); }
    else if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault();
      const minR = Math.min(sel.r, sel.r2), maxR = Math.max(sel.r, sel.r2);
      const minC = Math.min(sel.c, sel.c2), maxC = Math.max(sel.c, sel.c2);
      for (let r = minR; r <= maxR; r++) for (let c = minC; c <= maxC; c++) S.data[r][c] = '';
      recompute(); saveSheet(); renderGrid(); updateStatus();
    } else if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
      startEdit(sel.r, sel.c, e.key);
      e.preventDefault();
    }
  });

  /* ---------- formula bar ---------- */
  fx.onkeydown = e => {
    if (e.key === 'Enter') { e.preventDefault(); commit(sel.r, sel.c, fx.value); wrap.focus(); }
    if (e.key === 'Escape') { syncFx(); wrap.focus(); }
  };

  /* ---------- sorting (data rows reorder; formulas recompute) ---------- */
  function sortByColumn(c) {
    sortState = sortState.col === c ? { col: c, dir: sortState.dir === 1 ? -1 : 1 } : { col: c, dir: 1 };
    const used = usedRange();
    const header = node.querySelector('#pvHeader').checked ? 1 : 0;
    const end = dataBlockEnd(header, used);
    const rows = S.data.slice(header, end);
    const val = row => { const raw = row[c] ?? ''; return raw === '' ? null : (isNaN(Number(raw)) ? String(raw).toLowerCase() : Number(raw)); };
    rows.sort((a, b) => {
      const av = val(a), bv = val(b);
      if (av === null && bv === null) return 0;
      if (av === null) return 1; if (bv === null) return -1;
      const cmp = typeof av === 'number' && typeof bv === 'number' ? av - bv : String(av).localeCompare(String(bv), undefined, { numeric: true });
      return cmp * sortState.dir;
    });
    for (let i = 0; i < rows.length; i++) S.data[header + i] = rows[i];
    recompute(); saveSheet(); renderGrid();
    toast(`Sorted column ${colName(c)} ${sortState.dir === 1 ? 'A→Z (ascending)' : 'Z→A (descending)'} — data rows only (formulas below the blank row stay put).`, 'info', 3600);
  }

  /* ---------- toolbar ---------- */
  node.querySelector('#shAddRow').onclick = () => {
    if (S.rows >= MAX_ROWS) return toast(`Row limit is ${MAX_ROWS}.`, 'error');
    S.rows += 1; S.data.push(Array(S.cols).fill(''));
    recompute(); saveSheet(); renderGrid();
  };
  node.querySelector('#shAddCol').onclick = () => {
    if (S.cols >= MAX_COLS) return toast(`Column limit is ${MAX_COLS} (A–Z).`, 'error');
    S.cols += 1; S.data.forEach(row => row.push('')); filters.push('');
    recompute(); saveSheet(); renderGrid(); fillPivotSelects();
  };
  node.querySelector('#shClear').onclick = () => {
    if (!confirm('Clear the whole sheet? This cannot be undone.')) return;
    S = blankSheet(); filters = Array(S.cols).fill(''); sortState = { col: -1, dir: 0 };
    recompute(); saveSheet(); renderGrid(); updateStatus(); fillPivotSelects();
    node.querySelector('#pvOut').innerHTML = '';
  };

  /* ---------- import: file ---------- */
  node.querySelector('#shImport').onchange = async e => {
    const file = e.target.files[0]; if (!file) return;
    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { cellDates: true, raw: false });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', raw: false });
      loadAOA(aoa, file.name);
    } catch { toast('Could not read that file. Is it a valid CSV/Excel file?', 'error'); }
    e.target.value = '';
  };

  /* ---------- import: my projects ---------- */
  const projSel = node.querySelector('#shProj');
  api.get('/api/projects').then(r => {
    (r.projects || []).forEach(p => projSel.appendChild(el(`<option value="${p.id}">${esc(p.name)} (${p.row_count} rows)</option>`)));
  }).catch(() => { /* not logged in or none */ });
  projSel.onchange = async () => {
    const id = projSel.value; if (!id) return;
    projSel.disabled = true;
    try {
      const d = await api.get(`/api/projects/${id}/data?limit=${MAX_ROWS - 1}`);
      const cols = d.columns.map(c => c.name).slice(0, MAX_COLS);
      const aoa = [cols, ...d.rows.map(row => cols.map(c => row[c] ?? ''))];
      loadAOA(aoa, 'project');
      if (d.total > MAX_ROWS - 1) toast(`Loaded the first ${MAX_ROWS - 1} of ${d.total} rows (sheet limit).`, 'info', 4200);
    } catch (err) { toast(err.message, 'error'); }
    projSel.disabled = false; projSel.value = '';
  };

  function loadAOA(aoa, label) {
    const rows = Math.min(aoa.length, MAX_ROWS), cols = Math.min(Math.max(...aoa.map(r => r.length), 1), MAX_COLS);
    S = blankSheet(Math.max(rows + 5, START_ROWS), Math.max(cols, START_COLS));
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) S.data[r][c] = String(aoa[r][c] ?? '');
    filters = Array(S.cols).fill(''); sortState = { col: -1, dir: 0 };
    sel = { r: 0, c: 0, r2: 0, c2: 0 };
    recompute(); saveSheet(); renderGrid(); updateStatus(); fillPivotSelects();
    toast(`Loaded ${rows} row(s) × ${cols} column(s) into the sheet.`, 'success');
  }

  /* ---------- export ---------- */
  const exportAOA = () => {
    const used = usedRange();
    const out = [];
    for (let r = 0; r < used.rows; r++) {
      const row = [];
      for (let c = 0; c < used.cols; c++) {
        const v = computed.values[r][c];
        row.push(v === null ? computed.display[r][c] : v);
      }
      out.push(row);
    }
    return out;
  };
  node.querySelector('#shCsv').onclick = () => {
    const aoa = exportAOA();
    if (!aoa.length) return toast('The sheet is empty — nothing to export.', 'error');
    const csv = aoa.map(row => row.map(v => { const s = String(v ?? ''); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; }).join(',')).join('\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob(['\ufeff' + csv], { type: 'text/csv' }));
    a.download = 'datavision_sheet.csv'; a.click(); URL.revokeObjectURL(a.href);
    toast('CSV exported — computed values (formulas resolved).', 'success');
  };
  node.querySelector('#shXlsx').onclick = () => {
    const aoa = exportAOA();
    if (!aoa.length) return toast('The sheet is empty — nothing to export.', 'error');
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), 'DataVision Sheet');
    XLSX.writeFile(wb, 'datavision_sheet.xlsx');
    toast('Excel file exported — computed values (formulas resolved).', 'success');
  };

  /* ---------- pivot / summary ---------- */
  const pvGroup = node.querySelector('#pvGroup'), pvVal = node.querySelector('#pvVal'), pvAgg = node.querySelector('#pvAgg');
  function fillPivotSelects() {
    const used = usedRange();
    const header = node.querySelector('#pvHeader').checked;
    const label = c => header && String(S.data[0]?.[c] ?? '') !== '' ? `${colName(c)} — ${String(S.data[0][c]).slice(0, 18)}` : colName(c);
    const prevG = pvGroup.value, prevV = pvVal.value;
    const opts = [];
    for (let c = 0; c < Math.max(used.cols, 1); c++) opts.push(`<option value="${c}">${esc(label(c))}</option>`);
    pvGroup.innerHTML = opts.join('');
    pvVal.innerHTML = opts.join('');
    // keep previous selections if still valid
    if ([...pvGroup.options].some(o => o.value === prevG)) pvGroup.value = prevG;
    if ([...pvVal.options].some(o => o.value === prevV)) pvVal.value = prevV;
    else if (opts.length > 1) pvVal.selectedIndex = 1;
  }
  node.querySelector('#pvHeader').onchange = fillPivotSelects;
  node.querySelector('#pvRun').onclick = () => {
    const used = usedRange();
    if (!used.rows) { node.querySelector('#pvOut').innerHTML = '<p class="small muted">The sheet is empty.</p>'; return; }
    const gc = +pvGroup.value, vc = +pvVal.value, agg = pvAgg.value;
    const header = node.querySelector('#pvHeader').checked ? 1 : 0;
    const end = dataBlockEnd(header, used);
    const groups = new Map();
    for (let r = header; r < end; r++) {
      if (!rowVisible(r)) continue;
      const kRaw = computed.display[r][gc];
      const k = kRaw === '' ? '(blank)' : kRaw;
      if (!groups.has(k)) groups.set(k, { sum: 0, count: 0, nums: 0 });
      const g = groups.get(k); g.count++;
      const v = computed.values[r][vc];
      if (typeof v === 'number') { g.sum += v; g.nums++; }
    }
    const metric = g => agg === 'count' ? g.count : agg === 'avg' ? (g.nums ? g.sum / g.nums : 0) : g.sum;
    const entries = [...groups.entries()].map(([k, g]) => [k, metric(g)]).sort((a, b) => b[1] - a[1]);
    const total = entries.reduce((s, [, v]) => s + v, 0);
    const gLabel = pvGroup.options[pvGroup.selectedIndex].text, vLabel = pvVal.options[pvVal.selectedIndex].text;
    const aggLabel = agg === 'sum' ? 'Sum' : agg === 'avg' ? 'Average' : 'Count';
    node.querySelector('#pvOut').innerHTML = `
      <div class="table-wrap"><table class="dv"><thead><tr><th>${esc(gLabel)}</th><th class="num">${aggLabel}${agg !== 'count' ? ` of ${esc(vLabel)}` : ''}</th></tr></thead>
      <tbody>${entries.slice(0, 50).map(([k, v]) => `<tr><td>${esc(k)}</td><td class="num">${fmtNum(v)}</td></tr>`).join('')}
      ${agg !== 'avg' ? `<tr style="font-weight:700;border-top:2px solid var(--border)"><td>TOTAL</td><td class="num">${fmtNum(total)}</td></tr>` : ''}</tbody></table></div>
      <p class="small muted" style="margin-top:8px">${entries.length} group(s) · computed from ${aggLabel.toLowerCase()} of the visible rows — recalculated live from your sheet, nothing hardcoded.</p>`;
  };

  /* ---------- initial paint ---------- */
  renderGrid(); updateStatus(); fillPivotSelects();
}
