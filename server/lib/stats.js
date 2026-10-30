// ---------------------------------------------------------------
// Analysis engine. All results are computed from the actual rows.
// Also detects "semantic roles" (revenue/profit/date/category...)
// so KPIs adapt to whatever columns the dataset actually has.
// ---------------------------------------------------------------
const { isEmpty, isNumericVal, toNumber, parseFlexibleDate } = require('./parse');

const num = v => (isNumericVal(v) ? toNumber(v) : null);

// ---------- semantic role detection ----------
function detectRoles(columns, rows) {
  const roles = {};
  const find = (regex, type) => {
    const c = columns.find(c => (!type || c.type === type) && regex.test(c.name.toLowerCase().replace(/[\s_-]+/g, '')));
    return c ? c.name : null;
  };
  roles.revenue  = find(/(revenue|sales(amount)?|totalamount|totalsales|amount|grosssale)/, 'number')
                || find(/^(total|value)$/, 'number');
  roles.profit   = find(/(profit|margin|netincome)/, 'number');
  roles.cost     = find(/(cost|expense|cogs)/, 'number');
  roles.quantity = find(/(quantity|qty|units(sold)?|count)/, 'number');
  roles.price    = find(/(unitprice|price|rate)/, 'number');
  roles.discount = find(/(discount)/, 'number');
  roles.orderId  = columns.find(c => /(order(id|no|number)|invoice|transaction|bill)/.test(c.name.toLowerCase().replace(/[\s_-]+/g, '')))?.name || null;
  roles.customer = columns.find(c => /(customer|client|buyer|user)(id|name)?/.test(c.name.toLowerCase().replace(/[\s_-]+/g, '')))?.name || null;
  roles.date     = columns.find(c => c.type === 'date')?.name || null;
  roles.product  = columns.find(c => /(product|item|sku)/.test(c.name.toLowerCase()) && c.type !== 'number')?.name || null;
  roles.category = columns.find(c => /(category|segment|type|department|class)/.test(c.name.toLowerCase()) && c.type !== 'number')?.name || null;
  roles.region   = columns.find(c => /(region|state|city|country|zone|area|location)/.test(c.name.toLowerCase()) && c.type !== 'number')?.name || null;

  // Good categorical candidates: text columns with 2..50 distinct values
  roles.categoricals = columns.filter(c => c.type === 'text').map(c => {
    const distinct = new Set(rows.slice(0, 5000).map(r => r[c.name]).filter(v => !isEmpty(v)).map(String)).size;
    return { name: c.name, distinct };
  }).filter(c => c.distinct >= 2 && c.distinct <= 50).map(c => c.name);

  roles.numerics = columns.filter(c => c.type === 'number').map(c => c.name);
  roles.dates = columns.filter(c => c.type === 'date').map(c => c.name);
  return roles;
}

// ---------- basic helpers ----------
function colNumbers(rows, col) {
  const out = [];
  for (const r of rows) { const x = num(r[col]); if (x !== null) out.push(x); }
  return out;
}
function describe(nums) {
  if (!nums.length) return null;
  const s = [...nums].sort((a, b) => a - b);
  const sum = s.reduce((a, b) => a + b, 0);
  const mean = sum / s.length;
  const sd = Math.sqrt(s.reduce((a, b) => a + (b - mean) ** 2, 0) / s.length);
  const q = p => s[Math.min(s.length - 1, Math.floor(p * (s.length - 1)))];
  return { count: s.length, sum, mean, median: q(0.5), min: s[0], max: s[s.length - 1], std: sd, q1: q(0.25), q3: q(0.75) };
}

function groupBy(rows, catCol, valCol, agg = 'sum') {
  const map = new Map();
  for (const r of rows) {
    const k = isEmpty(r[catCol]) ? '(blank)' : String(r[catCol]).trim();
    if (!map.has(k)) map.set(k, { sum: 0, count: 0 });
    const g = map.get(k);
    g.count++;
    if (valCol) { const x = num(r[valCol]); if (x !== null) g.sum += x; }
  }
  let entries = [...map.entries()].map(([key, g]) => ({
    key, count: g.count, sum: +g.sum.toFixed(2), avg: g.count ? +(g.sum / g.count).toFixed(2) : 0,
  }));
  const metric = valCol ? (agg === 'avg' ? 'avg' : agg === 'count' ? 'count' : 'sum') : 'count';
  entries.sort((a, b) => b[metric] - a[metric]);
  return { entries, metric };
}

function timeSeries(rows, dateCol, valCol, granularity = 'month') {
  const map = new Map();
  for (const r of rows) {
    const d = parseFlexibleDate(r[dateCol]);
    if (!d || isNaN(d.getTime())) continue;
    let key;
    if (granularity === 'day') key = d.toISOString().slice(0, 10);
    else if (granularity === 'year') key = String(d.getFullYear());
    else key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    if (!map.has(key)) map.set(key, { sum: 0, count: 0 });
    const g = map.get(key);
    g.count++;
    if (valCol) { const x = num(r[valCol]); if (x !== null) g.sum += x; }
  }
  return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]))
    .map(([key, g]) => ({ key, sum: +g.sum.toFixed(2), count: g.count, avg: g.count ? +(g.sum / g.count).toFixed(2) : 0 }));
}

function correlation(xs, ys) {
  const n = Math.min(xs.length, ys.length);
  if (n < 3) return null;
  let sx = 0, sy = 0, sxx = 0, syy = 0, sxy = 0, m = 0;
  for (let i = 0; i < n; i++) {
    const x = xs[i], y = ys[i];
    if (x === null || y === null) continue;
    m++; sx += x; sy += y; sxx += x * x; syy += y * y; sxy += x * y;
  }
  if (m < 3) return null;
  const cov = sxy - sx * sy / m;
  const den = Math.sqrt((sxx - sx * sx / m) * (syy - sy * sy / m));
  return den === 0 ? null : +(cov / den).toFixed(3);
}

function correlationMatrix(rows, numericCols) {
  const cols = numericCols.slice(0, 8);
  const vals = {};
  for (const c of cols) vals[c] = rows.map(r => num(r[c]));
  const matrix = [];
  for (const a of cols) {
    const row = [];
    for (const b of cols) row.push(a === b ? 1 : correlation(vals[a], vals[b]));
    matrix.push(row);
  }
  return { cols, matrix };
}

function outliers(rows, col) {
  const nums = colNumbers(rows, col);
  const d = describe(nums);
  if (!d || nums.length < 8) return null;
  const iqr = d.q3 - d.q1;
  if (iqr <= 0) return null;
  const lo = d.q1 - 1.5 * iqr, hi = d.q3 + 1.5 * iqr;
  const out = nums.filter(x => x < lo || x > hi);
  if (!out.length) return null;
  return { column: col, count: out.length, low: +lo.toFixed(2), high: +hi.toFixed(2), examples: out.slice(0, 5) };
}

// ---------- KPI computation (adaptive) ----------
function computeKPIs(rows, columns) {
  const roles = detectRoles(columns, rows);
  const kpis = [];
  const fmtMoney = x => x;
  if (roles.revenue) {
    const d = describe(colNumbers(rows, roles.revenue));
    if (d) {
      kpis.push({ id: 'revenue', label: `Total ${roles.revenue}`, value: d.sum, kind: 'money', sub: `avg ${d.mean.toFixed(2)} per row` });
      if (roles.orderId) {
        const orders = new Set(rows.map(r => r[roles.orderId]).filter(v => !isEmpty(v))).size;
        if (orders) kpis.push({ id: 'aov', label: 'Avg Order Value', value: d.sum / orders, kind: 'money', sub: `${roles.revenue} ÷ ${orders} orders` });
      } else {
        kpis.push({ id: 'aov', label: 'Avg per Record', value: d.mean, kind: 'money', sub: `mean of ${roles.revenue}` });
      }
    }
  }
  if (roles.profit) {
    const d = describe(colNumbers(rows, roles.profit));
    if (d) kpis.push({ id: 'profit', label: `Total ${roles.profit}`, value: d.sum, kind: 'money', sub: roles.revenue ? `margin ${(d.sum / (describe(colNumbers(rows, roles.revenue))?.sum || 1) * 100).toFixed(1)}%` : null });
  }
  if (roles.orderId) {
    const orders = new Set(rows.map(r => r[roles.orderId]).filter(v => !isEmpty(v))).size;
    kpis.push({ id: 'orders', label: 'Total Orders', value: orders, kind: 'int', sub: `distinct ${roles.orderId}` });
  } else {
    kpis.push({ id: 'rows', label: 'Total Records', value: rows.length, kind: 'int', sub: 'rows in dataset' });
  }
  if (roles.customer) {
    const cust = new Set(rows.map(r => r[roles.customer]).filter(v => !isEmpty(v))).size;
    kpis.push({ id: 'customers', label: 'Total Customers', value: cust, kind: 'int', sub: `distinct ${roles.customer}` });
  }
  if (roles.quantity) {
    const d = describe(colNumbers(rows, roles.quantity));
    if (d) kpis.push({ id: 'units', label: `Total ${roles.quantity}`, value: d.sum, kind: 'int', sub: null });
  }
  // Fallback for datasets without business columns: show top numeric columns
  if (kpis.length < 3) {
    for (const c of (roles.numerics || []).slice(0, 4)) {
      if (kpis.some(k => k.label.includes(c))) continue;
      const d = describe(colNumbers(rows, c));
      if (d) kpis.push({ id: 'num_' + c, label: `Sum of ${c}`, value: d.sum, kind: 'number', sub: `avg ${d.mean.toFixed(2)} · min ${d.min} · max ${d.max}` });
      if (kpis.length >= 6) break;
    }
  }

  // Trend: revenue (or row count) over time
  let trend = null;
  if (roles.date) {
    const series = timeSeries(rows, roles.date, roles.revenue, 'month');
    if (series.length >= 2) {
      trend = { dateCol: roles.date, valueCol: roles.revenue, metric: roles.revenue ? 'sum' : 'count', series };
      const last = series[series.length - 1], prev = series[series.length - 2];
      const metric = roles.revenue ? 'sum' : 'count';
      if (prev[metric] !== 0) {
        const change = ((last[metric] - prev[metric]) / Math.abs(prev[metric])) * 100;
        kpis.push({ id: 'mom', label: 'Last Period Change', value: change, kind: 'pct', sub: `${prev.key} → ${last.key}` });
      }
    }
  }
  return { roles, kpis: kpis.slice(0, 6), trend };
}

// ---------- Full automatic analysis ----------
function fullAnalysis(rows, columns) {
  const roles = detectRoles(columns, rows);
  const numericStats = {};
  for (const c of roles.numerics) {
    const d = describe(colNumbers(rows, c));
    if (d) numericStats[c] = {
      count: d.count, sum: +d.sum.toFixed(2), mean: +d.mean.toFixed(2), median: +d.median.toFixed(2),
      min: d.min, max: d.max, std: +d.std.toFixed(2),
    };
  }
  const categoryBreakdowns = [];
  const valueCol = roles.revenue || roles.profit || roles.numerics[0] || null;
  for (const cat of [roles.category, roles.product, roles.region, ...roles.categoricals]) {
    if (!cat || categoryBreakdowns.some(b => b.column === cat)) continue;
    const g = groupBy(rows, cat, valueCol);
    categoryBreakdowns.push({ column: cat, valueCol, metric: g.metric, top: g.entries.slice(0, 10), bottom: g.entries.slice(-3).reverse(), totalGroups: g.entries.length });
    if (categoryBreakdowns.length >= 4) break;
  }
  const trend = roles.date ? timeSeries(rows, roles.date, valueCol, 'month') : null;
  const corr = roles.numerics.length >= 2 ? correlationMatrix(rows, roles.numerics) : null;
  const outlierReport = roles.numerics.map(c => outliers(rows, c)).filter(Boolean);
  const distinctCounts = {};
  for (const c of columns) {
    distinctCounts[c.name] = new Set(rows.map(r => r[c.name]).filter(v => !isEmpty(v)).map(String)).size;
  }
  return { roles, numericStats, categoryBreakdowns, trend, trendValueCol: valueCol, correlations: corr, outliers: outlierReport, distinctCounts, rowCount: rows.length };
}

module.exports = { detectRoles, describe, groupBy, timeSeries, correlationMatrix, outliers, computeKPIs, fullAnalysis, colNumbers };
