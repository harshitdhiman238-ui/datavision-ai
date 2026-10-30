// ---------------------------------------------------------------
// Shared widgets:
//   1. openCleanModal(pid)  — quick "Clean My Data" modal
//      (remove duplicates + fill missing values, with server preview)
//   2. mountChatDock(pid)   — floating ask-your-data chat box
// Both reuse the existing server endpoints — no new backend logic.
// ---------------------------------------------------------------
import { el, esc, toast, fmtInt, spinnerHTML, renderTable } from './util.js';
import { api, dataService } from './api.js';

/* ================= 1. Clean My Data modal ================= */

export async function openCleanModal(pid) {
  // Loading shell first so the user gets instant feedback
  const m = el(`<div class="modal-backdrop"><div class="modal" style="max-width:620px;max-height:88vh;overflow:auto">
    ${spinnerHTML('Checking your data for issues…')}
  </div></div>`);
  m.addEventListener('click', e => { if (e.target === m) m.remove(); });
  document.body.appendChild(m);
  const box = m.querySelector('.modal');

  let prof;
  try {
    const r = await api.get(`/api/projects/${pid}/profile`);
    prof = r.profile;
  } catch (e) {
    box.innerHTML = `<h3>🧹 Clean My Data</h3><p class="muted small" style="margin:12px 0">${esc(e.message)}</p>
      <div style="text-align:right"><button class="btn btn-ghost" data-close>Close</button></div>`;
    box.querySelector('[data-close]').onclick = () => m.remove();
    return;
  }

  const missCols = prof.columns.filter(c => c.missing > 0 && c.missing < prof.rowCount);
  const dupes = prof.duplicateRows || 0;

  const missRow = c => {
    const numeric = c.type === 'number';
    return `<div class="cm-row">
      <div class="cm-col"><b>${esc(c.name)}</b><small class="muted"> · ${esc(c.type)} · ${fmtInt(c.missing)} missing</small></div>
      <select class="input cm-miss" data-col="${esc(c.name)}" style="max-width:190px">
        <option value="">Skip (leave as is)</option>
        ${numeric ? `<option value="fill_mean">Fill with mean</option>
        <option value="fill_median">Fill with median</option>
        <option value="fill_zero">Fill with 0</option>` : `<option value="fill_mode">Fill with most common</option>`}
        <option value="fill_value">Fill with custom value…</option>
        <option value="drop_row">Drop those rows</option>
      </select>
      <input class="input cm-missval" data-col="${esc(c.name)}" placeholder="Custom value" style="display:none;max-width:130px"/>
    </div>`;
  };

  box.innerHTML = `
    <h3 style="margin-bottom:4px">🧹 Clean My Data</h3>
    <p class="muted small" style="margin-bottom:16px">Pick what to fix — preview first, then apply. The original upload is never overwritten, and you can undo from Data &amp; Cleaning.</p>

    <div class="cm-section">
      <label class="cm-check"><input type="checkbox" id="cmDup" ${dupes > 0 ? 'checked' : 'disabled'}/>
        <span><b>Remove duplicate rows</b><br/><small class="muted">${dupes > 0 ? `${fmtInt(dupes)} exact duplicate row(s) detected — they inflate totals.` : 'No duplicate rows detected ✓'}</small></span>
      </label>
    </div>

    <div class="cm-section">
      <div style="font-weight:600;margin-bottom:6px">Fill missing values ${missCols.length ? `<small class="muted">(${fmtInt(prof.totalMissing)} empty cell(s) in ${missCols.length} column(s))</small>` : ''}</div>
      ${missCols.length ? missCols.map(missRow).join('') : '<small class="muted">No missing values detected ✓</small>'}
    </div>

    <div id="cmResult"></div>

    <div style="display:flex;gap:10px;justify-content:flex-end;margin-top:16px;flex-wrap:wrap">
      <button class="btn btn-ghost" data-close>Cancel</button>
      <button class="btn btn-ghost" id="cmPreview">👁 Preview changes</button>
      <button class="btn btn-primary" id="cmApply">✅ Apply cleaning</button>
    </div>`;

  box.querySelector('[data-close]').onclick = () => m.remove();
  box.querySelectorAll('.cm-miss').forEach(sel => {
    sel.onchange = () => {
      const inp = box.querySelector(`.cm-missval[data-col="${CSS.escape(sel.dataset.col)}"]`);
      if (inp) inp.style.display = sel.value === 'fill_value' ? '' : 'none';
    };
  });

  const collectOps = () => {
    const missing = {};
    box.querySelectorAll('.cm-miss').forEach(sel => {
      if (sel.value) missing[sel.dataset.col] = {
        strategy: sel.value,
        value: box.querySelector(`.cm-missval[data-col="${CSS.escape(sel.dataset.col)}"]`)?.value,
      };
    });
    return { removeDuplicates: box.querySelector('#cmDup')?.checked || false, missing };
  };

  const nothingSelected = ops => !ops.removeDuplicates && !Object.keys(ops.missing).length;

  box.querySelector('#cmPreview').onclick = async e => {
    const ops = collectOps();
    if (nothingSelected(ops)) return toast('Select at least one cleaning option first.', 'error');
    const btn = e.target, out = box.querySelector('#cmResult');
    btn.disabled = true; out.innerHTML = spinnerHTML('Previewing on the server…');
    try {
      const r = await api.post(`/api/projects/${pid}/clean/preview`, { ops });
      out.innerHTML = `<div class="cm-preview">
        <b>Preview:</b> ${fmtInt(r.before.rows)} rows → <b>${fmtInt(r.after.rows)}</b> rows · quality ${r.before.profile.qualityScore} → <b>${r.after.profile.qualityScore}</b>/100
        <ul class="small muted" style="margin:8px 0 0 18px">${(r.log || []).map(l => `<li>${esc(l)}</li>`).join('') || '<li>No changes.</li>'}</ul>
      </div>`;
    } catch (err) { out.innerHTML = `<p class="small" style="color:var(--red,#f87171)">${esc(err.message)}</p>`; }
    btn.disabled = false;
  };

  box.querySelector('#cmApply').onclick = async e => {
    const ops = collectOps();
    if (nothingSelected(ops)) return toast('Select at least one cleaning option first.', 'error');
    const btn = e.target;
    btn.disabled = true; btn.innerHTML = '<span class="spinner sm"></span> Applying…';
    try {
      const r = await api.post(`/api/projects/${pid}/clean/apply`, { ops });
      toast(`Cleaning applied — ${fmtInt(r.rowCount)} rows in the cleaned dataset. All analyses now use it (undo anytime in Data & Cleaning).`, 'success', 5200);
      m.remove();
      // Refresh whatever page we're on so KPIs/charts pick up the cleaned variant
      window.dispatchEvent(new HashChangeEvent('hashchange'));
    } catch (err) {
      toast(err.message, 'error');
      btn.disabled = false; btn.textContent = '✅ Apply cleaning';
    }
  };
}

/* ================= 2. Floating ask-your-data chat ================= */

const chatHistory = new Map(); // pid -> [{q, r}] (kept for the session)

export function mountChatDock(pid) {
  // Remove any dock from a previous page render
  document.querySelector('.chat-dock')?.remove();

  const svc = dataService(pid);
  const dock = el(`<div class="chat-dock">
    <div class="chat-panel" hidden>
      <div class="chat-head">
        <div><b>💬 Ask your data</b><br/><small>Rule-based assistant — safe, predefined calculations. No SQL or code is run from your text.</small></div>
        <button class="icon-btn chat-close" title="Close">✕</button>
      </div>
      <div class="chat-log"></div>
      <div class="chat-suggest">
        <button data-q="Which product has the highest revenue?">Top product?</button>
        <button data-q="total revenue by region">Revenue by region</button>
        <button data-q="Are there missing values?">Missing values?</button>
      </div>
      <form class="chat-form">
        <input class="input" placeholder="e.g. average profit per category…" maxlength="300"/>
        <button class="btn btn-primary" type="submit">➤</button>
      </form>
    </div>
    <button class="chat-fab" title="Ask your data">💬</button>
  </div>`);

  const panel = dock.querySelector('.chat-panel');
  const log = dock.querySelector('.chat-log');
  const input = dock.querySelector('.chat-form .input');

  const renderMsg = (q, r) => {
    const tbl = (r.table && r.table.length)
      ? `<div class="chat-tbl">${renderTable(r.table.slice(0, 6), null, { max: 6 })}</div>` : '';
    log.appendChild(el(`<div class="chat-msg user">${esc(q)}</div>`));
    log.appendChild(el(`<div class="chat-msg bot">${esc(r.answer || '…')}${tbl}${r.method ? `<div class="chat-method">🧮 ${esc(r.method)}</div>` : ''}</div>`));
    log.scrollTop = log.scrollHeight;
  };

  // Replay this project's history
  (chatHistory.get(pid) || []).forEach(h => renderMsg(h.q, h.r));

  const ask = async q => {
    q = (q || '').trim();
    if (!q) return;
    input.value = '';
    log.appendChild(el(`<div class="chat-msg user">${esc(q)}</div>`));
    const thinking = el(`<div class="chat-msg bot"><span class="spinner sm"></span> Computing…</div>`);
    log.appendChild(thinking); log.scrollTop = log.scrollHeight;
    try {
      const r = await svc.ask(q);
      thinking.remove();
      // remove the temporary user bubble; renderMsg re-adds the pair
      log.lastElementChild?.classList.contains('user') && log.lastElementChild.remove();
      renderMsg(q, r);
      if (!chatHistory.has(pid)) chatHistory.set(pid, []);
      chatHistory.get(pid).push({ q, r });
    } catch (e) {
      thinking.innerHTML = `⚠️ ${esc(e.message)}`;
    }
  };

  dock.querySelector('.chat-fab').onclick = () => {
    panel.hidden = !panel.hidden;
    if (!panel.hidden) { input.focus(); log.scrollTop = log.scrollHeight; }
  };
  dock.querySelector('.chat-close').onclick = () => { panel.hidden = true; };
  dock.querySelector('.chat-form').onsubmit = e => { e.preventDefault(); ask(input.value); };
  dock.querySelectorAll('.chat-suggest button').forEach(b => b.onclick = () => ask(b.dataset.q));

  document.body.appendChild(dock);
}

/** Remove the chat dock (used when leaving workspace pages). */
export function unmountChatDock() {
  document.querySelector('.chat-dock')?.remove();
}

/* ================= 3. Floating business calculator ================= */
// Safe arithmetic parser (numbers, + - * / % and brackets) — no eval().
function calcEval(src) {
  const t = [];
  const re = /\s*([0-9]*\.?[0-9]+|[+\-*/()%])/y;
  let i = 0;
  while (i < src.length) {
    re.lastIndex = i;
    const m = re.exec(src);
    if (!m) throw new Error('Invalid input');
    t.push(m[1]); i = re.lastIndex;
  }
  let p = 0;
  const peek = () => t[p], next = () => t[p++];
  function prim() {
    const tok = next();
    if (tok === undefined) throw new Error('Incomplete');
    if (tok === '(') { const v = add(); if (next() !== ')') throw new Error('Missing )'); return post(v); }
    if (tok === '-') return -prim();
    if (tok === '+') return prim();
    if (/^[0-9.]/.test(tok)) return post(Number(tok));
    throw new Error('Invalid input');
  }
  function post(v) { while (peek() === '%') { next(); v = v / 100; } return v; }
  function mul() { let v = prim(); while (peek() === '*' || peek() === '/') { const op = next(), r = prim(); v = op === '*' ? v * r : v / r; } return v; }
  function add() { let v = mul(); while (peek() === '+' || peek() === '-') { const op = next(), r = mul(); v = op === '+' ? v + r : v - r; } return v; }
  const out = add();
  if (p !== t.length) throw new Error('Invalid input');
  if (!isFinite(out)) throw new Error('Cannot divide by zero');
  return out;
}

const rupee = n => '₹' + (isNaN(n) ? '0.00' : n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));

export function mountCalcDock() {
  if (document.querySelector('.calc-dock')) return;
  const dock = el(`<div class="calc-dock">
    <div class="calc-panel" hidden>
      <div class="chat-head">
        <div><b>🧮 Quick Calculator</b><br/><small>Basic maths · GST · Margin — sab instant, device par hi.</small></div>
        <button class="icon-btn calc-close" title="Close">✕</button>
      </div>
      <div class="calc-tabs">
        <button class="calc-tab active" data-t="basic">Basic</button>
        <button class="calc-tab" data-t="gst">GST</button>
        <button class="calc-tab" data-t="margin">Margin</button>
      </div>
      <div class="calc-body" data-p="basic">
        <input class="input calc-exp" placeholder="e.g. 1250*3+499  ·  2000*18%"/>
        <div class="calc-res" data-res>&nbsp;</div>
        <div class="calc-grid">
          ${['7','8','9','÷','4','5','6','×','1','2','3','−','0','.','%','+','C','⌫','()','='].map(k => `<button class="calc-key ${k==='='?'eq':''} ${['÷','×','−','+','%'].includes(k)?'op':''}" data-k="${k}">${k}</button>`).join('')}
        </div>
        <div class="small muted" style="margin-top:6px">% means ÷100 → <code>2000*18%</code> = 360</div>
      </div>
      <div class="calc-body" data-p="gst" style="display:none">
        <label class="small muted">Amount (₹)<input class="input" type="number" data-g="amt" placeholder="1000"/></label>
        <div style="display:flex;gap:8px;margin:8px 0">
          <select class="input" data-g="rate" style="flex:1">${[5,12,18,28].map(r=>`<option value="${r}" ${r===18?'selected':''}>GST ${r}%</option>`).join('')}</select>
          <select class="input" data-g="mode" style="flex:1.4">
            <option value="add">Add GST (price + tax)</option>
            <option value="rem">Remove GST (incl. → base)</option>
          </select>
        </div>
        <div class="calc-out" data-g="out">Enter an amount above.</div>
      </div>
      <div class="calc-body" data-p="margin" style="display:none">
        <label class="small muted">Cost price (₹)<input class="input" type="number" data-m="cost" placeholder="600"/></label>
        <label class="small muted" style="display:block;margin-top:8px">Selling price (₹)<input class="input" type="number" data-m="sell" placeholder="1000"/></label>
        <div class="calc-out" data-m="out" style="margin-top:10px">Enter cost &amp; selling price.</div>
      </div>
    </div>
    <button class="calc-fab" title="Quick calculator">🧮</button>
  </div>`);

  const panel = dock.querySelector('.calc-panel');
  dock.querySelector('.calc-fab').onclick = () => { panel.hidden = !panel.hidden; if (!panel.hidden) dock.querySelector('.calc-exp').focus(); };
  dock.querySelector('.calc-close').onclick = () => { panel.hidden = true; };

  // tabs
  dock.querySelectorAll('.calc-tab').forEach(b => b.onclick = () => {
    dock.querySelectorAll('.calc-tab').forEach(x => x.classList.toggle('active', x === b));
    dock.querySelectorAll('.calc-body').forEach(x => x.style.display = x.dataset.p === b.dataset.t ? '' : 'none');
  });

  // basic calculator
  const exp = dock.querySelector('.calc-exp'), res = dock.querySelector('[data-res]');
  const showRes = () => {
    const s = exp.value.trim();
    if (!s) { res.innerHTML = '&nbsp;'; return; }
    try { const v = calcEval(s); res.textContent = '= ' + v.toLocaleString('en-IN', { maximumFractionDigits: 6 }); res.classList.remove('err'); }
    catch (e) { res.textContent = e.message === 'Incomplete' ? '…' : '⚠ ' + e.message; res.classList.add('err'); }
  };
  exp.oninput = showRes;
  exp.onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); finishEq(); } };
  const finishEq = () => { try { exp.value = String(calcEval(exp.value.trim())); showRes(); } catch { /* keep */ } };
  dock.querySelectorAll('.calc-key').forEach(k => k.onclick = () => {
    const v = k.dataset.k;
    if (v === 'C') exp.value = '';
    else if (v === '⌫') exp.value = exp.value.slice(0, -1);
    else if (v === '=') { finishEq(); return; }
    else if (v === '()') { const open = (exp.value.match(/\(/g) || []).length, close = (exp.value.match(/\)/g) || []).length; exp.value += open > close ? ')' : '('; }
    else exp.value += ({ '÷': '/', '×': '*', '−': '-' }[v] || v);
    exp.focus(); showRes();
  });

  // GST tab
  const g = s => dock.querySelector(`[data-g="${s}"]`);
  const gstCalc = () => {
    const amt = Number(g('amt').value), rate = Number(g('rate').value), mode = g('mode').value;
    if (!amt) { g('out').textContent = 'Enter an amount above.'; return; }
    if (mode === 'add') {
      const gst = amt * rate / 100;
      g('out').innerHTML = `Base: <b>${rupee(amt)}</b><br/>GST ${rate}%: <b>${rupee(gst)}</b><br/>Total: <b style="font-size:16px">${rupee(amt + gst)}</b>`;
    } else {
      const base = amt / (1 + rate / 100), gst = amt - base;
      g('out').innerHTML = `Incl. amount: <b>${rupee(amt)}</b><br/>Base: <b>${rupee(base)}</b><br/>GST ${rate}% inside: <b>${rupee(gst)}</b>`;
    }
  };
  ['amt', 'rate', 'mode'].forEach(s => { g(s).oninput = gstCalc; g(s).onchange = gstCalc; });

  // Margin tab
  const m = s => dock.querySelector(`[data-m="${s}"]`);
  const marginCalc = () => {
    const cost = Number(m('cost').value), sell = Number(m('sell').value);
    if (!cost || !sell) { m('out').textContent = 'Enter cost & selling price.'; return; }
    const profit = sell - cost;
    const margin = (profit / sell) * 100, markup = (profit / cost) * 100;
    m('out').innerHTML = `Profit: <b>${rupee(profit)}</b><br/>Margin (on selling): <b>${margin.toFixed(2)}%</b><br/>Markup (on cost): <b>${markup.toFixed(2)}%</b>`;
  };
  ['cost', 'sell'].forEach(s => { m(s).oninput = marginCalc; });

  document.body.appendChild(dock);
}

export function unmountCalcDock() {
  document.querySelector('.calc-dock')?.remove();
}
