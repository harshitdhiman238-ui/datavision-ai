// ---------- shared frontend utilities ----------
export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export function el(html) {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
}
export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function toast(msg, type = 'info', ms = 3800) {
  const root = document.getElementById('toast-root');
  const t = el(`<div class="toast ${type}">${esc(msg)}</div>`);
  root.appendChild(t);
  setTimeout(() => { t.style.opacity = '0'; t.style.transition = 'opacity .3s'; setTimeout(() => t.remove(), 320); }, ms);
}

export const fmtNum = (n, digits = 2) => {
  if (n === null || n === undefined || isNaN(n)) return '—';
  const abs = Math.abs(n);
  if (abs >= 1e7) return (n / 1e7).toFixed(2) + ' Cr';
  if (abs >= 1e5) return (n / 1e5).toFixed(2) + ' L';
  if (abs >= 1e3) return n.toLocaleString('en-IN', { maximumFractionDigits: 0 });
  return n.toLocaleString('en-IN', { maximumFractionDigits: Number.isInteger(n) ? 0 : digits });
};
export const fmtInt = n => (n === null || n === undefined || isNaN(n)) ? '—' : Math.round(n).toLocaleString('en-IN');

export function kpiValue(k) {
  if (k.kind === 'pct') return (k.value >= 0 ? '+' : '') + k.value.toFixed(1) + '%';
  if (k.kind === 'int') return fmtInt(k.value);
  return fmtNum(k.value);
}

// ---------- chart helpers ----------
export const PALETTE = ['#3b82f6', '#14b8a6', '#8b5cf6', '#f59e0b', '#ef4444', '#06b6d4', '#84cc16', '#ec4899', '#f97316', '#6366f1'];

export function chartDefaults() {
  const s = getComputedStyle(document.documentElement);
  const text = s.getPropertyValue('--text-2').trim();
  const grid = s.getPropertyValue('--chart-grid').trim();
  Chart.defaults.color = text;
  Chart.defaults.borderColor = grid;
  Chart.defaults.font.family = "'Inter', sans-serif";
  Chart.defaults.font.size = 12;
}

const liveCharts = new Set();
export function makeChart(canvas, config) {
  chartDefaults();
  if (canvas._chart) { canvas._chart.destroy(); liveCharts.delete(canvas._chart); }
  const c = new Chart(canvas.getContext('2d'), config);
  canvas._chart = c;
  liveCharts.add(c);
  return c;
}
export function destroyCharts() {
  for (const c of liveCharts) { try { c.destroy(); } catch {} }
  liveCharts.clear();
}

export const spinnerHTML = (label = 'Loading…') =>
  `<div class="loading-block"><div class="spinner"></div><p>${esc(label)}</p></div>`;

export function emptyStateHTML(icon, title, text, actionHTML = '') {
  return `<div class="empty-state"><div class="icon">${icon}</div><h3>${esc(title)}</h3><p>${esc(text)}</p>${actionHTML}</div>`;
}

export function renderTable(rows, columns = null, opts = {}) {
  if (!rows || !rows.length) return emptyStateHTML('📭', 'No rows', 'There is no data to display.');
  const cols = columns || Object.keys(rows[0]);
  const max = opts.max || 100;
  const body = rows.slice(0, max).map(r =>
    `<tr>${cols.map(c => {
      const v = typeof r === 'object' && !Array.isArray(r) ? r[c] : r;
      const isNum = typeof v === 'number';
      return `<td class="${isNum ? 'num' : ''}">${v === null || v === undefined || v === '' ? '<span class="muted">—</span>' : esc(isNum ? v.toLocaleString('en-IN') : v)}</td>`;
    }).join('')}</tr>`).join('');
  return `<div class="table-wrap"><table class="dv"><thead><tr>${cols.map(c => `<th>${esc(c)}</th>`).join('')}</tr></thead><tbody>${body}</tbody></table></div>` +
    (rows.length > max ? `<p class="small muted" style="margin-top:8px">Showing first ${max} of ${rows.length.toLocaleString()} rows.</p>` : '');
}

export function confirmModal(title, text, confirmLabel = 'Confirm') {
  return new Promise(resolve => {
    const m = el(`<div class="modal-backdrop"><div class="modal">
      <h3 style="margin-bottom:8px">${esc(title)}</h3>
      <p class="muted small" style="margin-bottom:20px">${esc(text)}</p>
      <div style="display:flex;gap:10px;justify-content:flex-end">
        <button class="btn btn-ghost" data-x="no">Cancel</button>
        <button class="btn btn-danger" data-x="yes">${esc(confirmLabel)}</button>
      </div></div></div>`);
    m.addEventListener('click', e => {
      const x = e.target.dataset?.x;
      if (x || e.target === m) { m.remove(); resolve(x === 'yes'); }
    });
    document.body.appendChild(m);
  });
}

export function debounce(fn, ms = 250) {
  let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}
