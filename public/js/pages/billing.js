// ---------------------------------------------------------------
// Business Tools: Quotation Builder + Bill/Invoice Generator.
// One shared engine, two modes. 100% client-side:
//   - live totals (per-item GST, discount, grand total)
//   - logo upload (stored as data-URL)
//   - professional A4 print view (print → Save as PDF) + .html download
//   - auto-saved to this browser's localStorage (honest label in UI)
// ---------------------------------------------------------------
import { el, esc, toast, fmtNum } from '../util.js';

const MODES = {
  quotation: {
    title: 'Quotation Builder', icon: '🧾', docTitle: 'QUOTATION', numPrefix: 'QTN',
    dateLabel: 'Quotation date', dueLabel: 'Valid until', ls: 'dv_quotation_v1',
    notesDefault: 'Prices are valid until the date mentioned above. Taxes as applicable. Kindly confirm by email/phone to proceed.',
  },
  invoice: {
    title: 'Bill / Invoice Generator', icon: '💸', docTitle: 'TAX INVOICE', numPrefix: 'INV',
    dateLabel: 'Invoice date', dueLabel: 'Due date', ls: 'dv_invoice_v1',
    notesDefault: 'Payment is due by the due date. Please quote the invoice number in your payment reference. Thank you for your business!',
  },
};

const GST_RATES = [0, 5, 12, 18, 28];
const today = () => new Date().toISOString().slice(0, 10);
const plusDays = d => { const x = new Date(); x.setDate(x.getDate() + d); return x.toISOString().slice(0, 10); };
const money = n => '₹' + (isNaN(n) ? '0.00' : n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));

function blankDoc(cfg) {
  return {
    number: `${cfg.numPrefix}-${new Date().getFullYear()}-${String(Math.floor(Math.random() * 900) + 100)}`,
    date: today(), due: plusDays(cfg.numPrefix === 'INV' ? 15 : 30),
    biz: { name: '', addr: '', phone: '', email: '', gstin: '', logo: '' },
    client: { name: '', addr: '', phone: '', gstin: '' },
    items: [{ desc: '', qty: 1, rate: 0, gst: 18 }],
    discount: 0,
    notes: cfg.notesDefault,
  };
}

const loadDoc = cfg => {
  try { const d = JSON.parse(localStorage.getItem(cfg.ls)); if (d && d.items) return d; } catch { /* ignore */ }
  return blankDoc(cfg);
};

/* ---------- number → words (Indian system) for invoices ---------- */
const ONES = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
function two(n) { return n < 20 ? ONES[n] : (TENS[Math.floor(n / 10)] + (n % 10 ? ' ' + ONES[n % 10] : '')); }
function inWords(num) {
  num = Math.round(num);
  if (num <= 0 || num > 999999999) return '';
  const parts = [];
  const crore = Math.floor(num / 10000000); num %= 10000000;
  const lakh = Math.floor(num / 100000); num %= 100000;
  const thou = Math.floor(num / 1000); num %= 1000;
  const hund = Math.floor(num / 100); const rest = num % 100;
  if (crore) parts.push(two(crore) + ' Crore');
  if (lakh) parts.push(two(lakh) + ' Lakh');
  if (thou) parts.push(two(thou) + ' Thousand');
  if (hund) parts.push(ONES[hund] + ' Hundred');
  if (rest) parts.push((parts.length ? 'and ' : '') + two(rest));
  return 'Rupees ' + parts.join(' ') + ' Only';
}

/* ---------- totals ---------- */
function computeTotals(doc) {
  let subtotal = 0, gstTotal = 0;
  const lines = doc.items.map(it => {
    const qty = Number(it.qty) || 0, rate = Number(it.rate) || 0, gstPct = Number(it.gst) || 0;
    const amount = qty * rate, gstAmt = amount * gstPct / 100;
    subtotal += amount; gstTotal += gstAmt;
    return { ...it, qty, rate, gstPct, amount, gstAmt };
  });
  const discount = Math.min(Number(doc.discount) || 0, subtotal + gstTotal);
  const grand = subtotal + gstTotal - discount;
  return { lines, subtotal, gstTotal, discount, grand };
}

/* ---------- professional A4 print HTML ---------- */
function printHTML(doc, cfg) {
  const t = computeTotals(doc);
  const rows = t.lines.filter(l => l.desc || l.amount).map((l, i) => `
    <tr><td style="text-align:center">${i + 1}</td><td>${esc(l.desc)}</td>
    <td style="text-align:right">${l.qty}</td><td style="text-align:right">${money(l.rate)}</td>
    <td style="text-align:center">${l.gstPct}%</td><td style="text-align:right">${money(l.gstAmt)}</td>
    <td style="text-align:right">${money(l.amount + l.gstAmt)}</td></tr>`).join('');
  const box = 'border:1px solid #d7dbe4;border-radius:8px;padding:12px 14px';
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${esc(doc.number)}</title>
<style>
  @page { size: A4; margin: 14mm; }
  body { font-family: 'Segoe UI', Arial, sans-serif; color: #1c2434; margin: 0; font-size: 13px; }
  table { width: 100%; border-collapse: collapse; }
  .items th { background: #16233f; color: #fff; padding: 8px 9px; font-size: 12px; text-align: left; }
  .items td { border-bottom: 1px solid #e4e7ee; padding: 7px 9px; vertical-align: top; }
  .totals td { padding: 5px 9px; }
  h1 { letter-spacing: 2px; color: #16233f; margin: 0; font-size: 24px; }
  .muted { color: #6a7487; }
  @media print { .noprint { display: none; } }
</style></head><body>
<div class="noprint" style="background:#eef3ff;padding:10px 14px;margin-bottom:14px;border-radius:8px;font-size:13px">
  💡 Press <b>Ctrl+P</b> and choose <b>“Save as PDF”</b> to download this ${cfg.docTitle.toLowerCase()} as a PDF.
  <button onclick="window.print()" style="margin-left:10px;padding:6px 14px;cursor:pointer">🖨 Print / Save as PDF</button>
</div>
<table><tr>
  <td style="width:60%">
    ${doc.biz.logo ? `<img src="${doc.biz.logo}" style="max-height:64px;max-width:200px;margin-bottom:8px"/><br/>` : ''}
    <div style="font-size:19px;font-weight:700">${esc(doc.biz.name) || 'Your Business Name'}</div>
    <div class="muted" style="white-space:pre-line">${esc(doc.biz.addr)}</div>
    <div class="muted">${esc([doc.biz.phone, doc.biz.email].filter(Boolean).join(' · '))}</div>
    ${doc.biz.gstin ? `<div class="muted">GSTIN: ${esc(doc.biz.gstin)}</div>` : ''}
  </td>
  <td style="text-align:right;vertical-align:top">
    <h1>${cfg.docTitle}</h1>
    <div style="margin-top:8px"><b>No:</b> ${esc(doc.number)}</div>
    <div><b>${cfg.dateLabel}:</b> ${esc(doc.date)}</div>
    <div><b>${cfg.dueLabel}:</b> ${esc(doc.due)}</div>
  </td>
</tr></table>
<div style="display:flex;gap:14px;margin:18px 0 14px">
  <div style="flex:1;${box}">
    <div class="muted" style="font-size:11px;letter-spacing:1px">${cfg.numPrefix === 'INV' ? 'BILL TO' : 'QUOTATION FOR'}</div>
    <div style="font-weight:700;font-size:15px;margin-top:3px">${esc(doc.client.name) || 'Client Name'}</div>
    <div class="muted" style="white-space:pre-line">${esc(doc.client.addr)}</div>
    <div class="muted">${esc(doc.client.phone)}</div>
    ${doc.client.gstin ? `<div class="muted">GSTIN: ${esc(doc.client.gstin)}</div>` : ''}
  </div>
</div>
<table class="items"><thead><tr>
  <th style="width:34px">#</th><th>Item / Description</th><th style="text-align:right">Qty</th>
  <th style="text-align:right">Rate</th><th style="text-align:center">GST</th>
  <th style="text-align:right">GST Amt</th><th style="text-align:right">Amount</th>
</tr></thead><tbody>${rows || '<tr><td colspan="7" style="text-align:center;color:#999">No items</td></tr>'}</tbody></table>
<table style="margin-top:12px"><tr>
  <td style="vertical-align:top;width:55%">
    <div style="${box};min-height:60px">
      <div class="muted" style="font-size:11px;letter-spacing:1px">NOTES / TERMS</div>
      <div style="white-space:pre-line;margin-top:4px">${esc(doc.notes)}</div>
    </div>
    ${t.grand > 0 ? `<div class="muted" style="margin-top:10px;font-style:italic">${inWords(t.grand)}</div>` : ''}
  </td>
  <td style="vertical-align:top">
    <table class="totals">
      <tr><td class="muted">Subtotal</td><td style="text-align:right">${money(t.subtotal)}</td></tr>
      <tr><td class="muted">Total GST</td><td style="text-align:right">${money(t.gstTotal)}</td></tr>
      ${t.discount ? `<tr><td class="muted">Discount</td><td style="text-align:right">− ${money(t.discount)}</td></tr>` : ''}
      <tr><td style="font-size:17px;font-weight:800;border-top:2px solid #16233f;padding-top:8px">GRAND TOTAL</td>
          <td style="font-size:17px;font-weight:800;border-top:2px solid #16233f;padding-top:8px;text-align:right">${money(t.grand)}</td></tr>
    </table>
  </td>
</tr></table>
<table style="margin-top:46px"><tr>
  <td class="muted" style="font-size:11px">Generated with DataVision AI</td>
  <td style="text-align:right"><div style="border-top:1px solid #9aa3b5;display:inline-block;padding:6px 10px 0;min-width:200px;text-align:center">
    Authorised Signatory${doc.biz.name ? `<br/><span class="muted" style="font-size:11px">${esc(doc.biz.name)}</span>` : ''}</div></td>
</tr></table>
</body></html>`;
}

/* ================= page ================= */
export function renderBilling(ctx, mode) {
  const cfg = MODES[mode];
  let doc = loadDoc(cfg);
  const save = () => { try { localStorage.setItem(cfg.ls, JSON.stringify(doc)); } catch { toast('Could not auto-save (storage full — logo too big?)', 'error'); } };

  const node = el(`<div>
    <div class="grid" style="grid-template-columns:1fr 340px;align-items:start;gap:14px">
      <div>
        <div class="card" style="margin-bottom:14px">
          <div class="card-title">${cfg.icon} ${cfg.title}</div>
          <div class="card-sub">Everything is calculated live. Auto-saved in this browser — refresh-safe. Nothing is uploaded to the server.</div>
          <div class="grid grid-2" style="gap:14px;margin-top:12px">
            <div>
              <div class="bb-label">YOUR BUSINESS</div>
              <input class="input" data-k="biz.name" placeholder="Business / company name"/>
              <textarea class="input" data-k="biz.addr" rows="2" placeholder="Address"></textarea>
              <div class="grid grid-2" style="gap:8px">
                <input class="input" data-k="biz.phone" placeholder="Phone"/>
                <input class="input" data-k="biz.email" placeholder="Email"/>
              </div>
              <input class="input" data-k="biz.gstin" placeholder="GSTIN (optional)"/>
              <label class="btn btn-ghost btn-sm" style="margin-top:6px">🖼 Upload logo<input type="file" id="bbLogo" accept="image/*" hidden/></label>
              <span id="bbLogoName" class="small muted"></span>
            </div>
            <div>
              <div class="bb-label">CLIENT DETAILS</div>
              <input class="input" data-k="client.name" placeholder="Client / customer name"/>
              <textarea class="input" data-k="client.addr" rows="2" placeholder="Client address"></textarea>
              <input class="input" data-k="client.phone" placeholder="Client phone / email"/>
              <input class="input" data-k="client.gstin" placeholder="Client GSTIN (optional)"/>
              <div class="bb-label" style="margin-top:10px">DOCUMENT</div>
              <div class="grid grid-2" style="gap:8px">
                <label class="small muted">Number<input class="input" data-k="number"/></label>
                <label class="small muted">${cfg.dateLabel}<input class="input" type="date" data-k="date"/></label>
              </div>
              <label class="small muted">${cfg.dueLabel}<input class="input" type="date" data-k="due"/></label>
            </div>
          </div>
        </div>

        <div class="card">
          <div class="card-title">Items</div>
          <div class="table-wrap"><table class="dv bb-items"><thead>
            <tr><th style="min-width:200px">Description</th><th style="width:70px">Qty</th><th style="width:110px">Rate (₹)</th><th style="width:90px">GST %</th><th style="width:120px;text-align:right">Amount</th><th style="width:36px"></th></tr>
          </thead><tbody id="bbRows"></tbody></table></div>
          <button class="btn btn-ghost btn-sm" id="bbAdd" style="margin-top:10px">＋ Add item</button>
        </div>

        <div class="card" style="margin-top:14px">
          <div class="card-title">Notes / Terms</div>
          <textarea class="input" data-k="notes" rows="3"></textarea>
        </div>
      </div>

      <div class="card bb-side">
        <div class="card-title">Summary</div>
        <div class="bb-tot"><span>Subtotal</span><b id="bbSub">₹0.00</b></div>
        <div class="bb-tot"><span>Total GST</span><b id="bbGst">₹0.00</b></div>
        <div class="bb-tot"><span>Discount (₹)</span><input class="input" data-k="discount" type="number" min="0" style="width:110px;text-align:right"/></div>
        <div class="bb-tot bb-grand"><span>Grand Total</span><b id="bbGrand">₹0.00</b></div>
        <div class="small muted" id="bbWords" style="margin:6px 0 14px;font-style:italic"></div>
        <button class="btn btn-primary" id="bbPrint" style="width:100%">🖨 Preview &amp; Print / Save PDF</button>
        <button class="btn btn-ghost" id="bbHtml" style="width:100%;margin-top:8px">⬇ Download as HTML file</button>
        <button class="btn btn-ghost" id="bbNew" style="width:100%;margin-top:8px">🗑 Start a new ${mode}</button>
        <p class="small muted" style="margin-top:12px">Tip: the print view opens in a new tab — press <b>Ctrl+P</b> → “Save as PDF” for a professional PDF with your logo.</p>
      </div>
    </div>
  </div>`);

  ctx.layoutApp(node, { active: mode, title: cfg.title });

  /* ---------- bind scalar fields ---------- */
  const getPath = k => k.split('.').reduce((o, p) => o[p], doc);
  const setPath = (k, v) => { const ps = k.split('.'); const last = ps.pop(); ps.reduce((o, p) => o[p], doc)[last] = v; };
  node.querySelectorAll('[data-k]').forEach(inp => {
    inp.value = getPath(inp.dataset.k) ?? '';
    inp.oninput = () => { setPath(inp.dataset.k, inp.value); save(); refreshTotals(); };
  });
  const logoName = node.querySelector('#bbLogoName');
  if (doc.biz.logo) logoName.textContent = '✓ logo saved';
  node.querySelector('#bbLogo').onchange = e => {
    const f = e.target.files[0]; if (!f) return;
    if (f.size > 400 * 1024) return toast('Logo too big — please use an image under 400 KB.', 'error');
    const rd = new FileReader();
    rd.onload = () => { doc.biz.logo = rd.result; save(); logoName.textContent = '✓ ' + f.name; toast('Logo added — it will appear on the printed document.', 'success'); };
    rd.readAsDataURL(f);
  };

  /* ---------- items table ---------- */
  const rowsBox = node.querySelector('#bbRows');
  function renderRows() {
    rowsBox.innerHTML = doc.items.map((it, i) => `<tr data-i="${i}">
      <td><input class="input bb-in" data-f="desc" value="${esc(it.desc)}" placeholder="Item or service description"/></td>
      <td><input class="input bb-in" data-f="qty" type="number" min="0" value="${esc(it.qty)}"/></td>
      <td><input class="input bb-in" data-f="rate" type="number" min="0" value="${esc(it.rate)}"/></td>
      <td><select class="input bb-in" data-f="gst">${GST_RATES.map(g => `<option value="${g}" ${+it.gst === g ? 'selected' : ''}>${g}%</option>`).join('')}</select></td>
      <td class="num" data-amt style="text-align:right;font-weight:600"></td>
      <td><button class="icon-btn bb-del" title="Remove">✕</button></td>
    </tr>`).join('');
    rowsBox.querySelectorAll('tr').forEach(tr => {
      const i = +tr.dataset.i;
      tr.querySelectorAll('.bb-in').forEach(inp => {
        inp.oninput = () => { doc.items[i][inp.dataset.f] = inp.value; save(); refreshTotals(); };
        inp.onchange = inp.oninput;
      });
      tr.querySelector('.bb-del').onclick = () => {
        if (doc.items.length === 1) { doc.items = [{ desc: '', qty: 1, rate: 0, gst: 18 }]; }
        else doc.items.splice(i, 1);
        save(); renderRows(); refreshTotals();
      };
    });
    refreshTotals();
  }
  node.querySelector('#bbAdd').onclick = () => { doc.items.push({ desc: '', qty: 1, rate: 0, gst: 18 }); save(); renderRows(); };

  /* ---------- live totals ---------- */
  function refreshTotals() {
    const t = computeTotals(doc);
    rowsBox.querySelectorAll('tr').forEach((tr, i) => {
      const cell = tr.querySelector('[data-amt]');
      if (cell && t.lines[i]) cell.textContent = money(t.lines[i].amount);
    });
    node.querySelector('#bbSub').textContent = money(t.subtotal);
    node.querySelector('#bbGst').textContent = money(t.gstTotal);
    node.querySelector('#bbGrand').textContent = money(t.grand);
    node.querySelector('#bbWords').textContent = t.grand > 0 ? inWords(t.grand) : '';
  }

  /* ---------- outputs ---------- */
  node.querySelector('#bbPrint').onclick = () => {
    const w = window.open('', '_blank');
    if (!w) return toast('Popup blocked — please allow popups for this site and try again.', 'error');
    w.document.write(printHTML(doc, cfg)); w.document.close();
  };
  node.querySelector('#bbHtml').onclick = () => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([printHTML(doc, cfg)], { type: 'text/html' }));
    a.download = `${doc.number}.html`; a.click(); URL.revokeObjectURL(a.href);
    toast('HTML file downloaded — open it in any browser and print to PDF.', 'success');
  };
  node.querySelector('#bbNew').onclick = () => {
    if (!confirm(`Start a fresh ${mode}? Current details will be cleared (business details are kept).`)) return;
    const biz = doc.biz;
    doc = blankDoc(cfg); doc.biz = biz;
    save();
    node.querySelectorAll('[data-k]').forEach(inp => { inp.value = getPath(inp.dataset.k) ?? ''; });
    renderRows();
    toast('New document started — business details carried over.', 'success');
  };

  renderRows();
}
