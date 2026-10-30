// ---------------------------------------------------------------
// Cleaning operations. Pure functions: rows in → new rows out.
// The ORIGINAL dataset is never mutated; callers decide whether
// to preview or persist the result as the "cleaned" variant.
// ---------------------------------------------------------------
const { isEmpty, isNumericVal, toNumber, looksLikeDate, parseFlexibleDate } = require('./parse');

/**
 * ops = {
 *   removeDuplicates: bool,
 *   trimWhitespace: bool,
 *   standardizeDates: [colName, ...],      // convert to YYYY-MM-DD
 *   dropColumns: [colName, ...],
 *   missing: { colName: { strategy: 'drop_row'|'fill_mean'|'fill_median'|'fill_mode'|'fill_zero'|'fill_value', value? } }
 * }
 */
function applyCleaning(rows, columns, ops = {}) {
  let out = rows.map(r => ({ ...r }));
  const log = [];
  const colNames = columns.map(c => c.name);

  // 1. Trim whitespace
  if (ops.trimWhitespace) {
    let count = 0;
    out = out.map(r => {
      const o = {};
      for (const k of Object.keys(r)) {
        if (typeof r[k] === 'string' && r[k] !== r[k].trim()) { o[k] = r[k].trim(); count++; }
        else o[k] = r[k];
      }
      return o;
    });
    log.push(`Trimmed whitespace in ${count} cell(s).`);
  }

  // 2. Standardize dates → YYYY-MM-DD
  for (const col of ops.standardizeDates || []) {
    if (!colNames.includes(col)) continue;
    let count = 0;
    out = out.map(r => {
      const v = r[col];
      if (!isEmpty(v) && looksLikeDate(v)) {
        const d = parseFlexibleDate(v);
        if (d) {
          const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
          if (iso !== v) count++;
          return { ...r, [col]: iso };
        }
      }
      return r;
    });
    log.push(`Standardized ${count} date(s) in "${col}" to YYYY-MM-DD.`);
  }

  // 3. Missing-value strategies (per column)
  for (const [col, cfg] of Object.entries(ops.missing || {})) {
    if (!colNames.includes(col) || !cfg || !cfg.strategy) continue;
    const strategy = cfg.strategy;
    const missingBefore = out.filter(r => isEmpty(r[col])).length;
    if (!missingBefore) continue;

    if (strategy === 'drop_row') {
      out = out.filter(r => !isEmpty(r[col]));
      log.push(`Dropped ${missingBefore} row(s) with missing "${col}".`);
      continue;
    }
    let fill = null;
    const nonEmpty = out.map(r => r[col]).filter(v => !isEmpty(v));
    if (strategy === 'fill_mean' || strategy === 'fill_median') {
      const nums = nonEmpty.filter(isNumericVal).map(toNumber).sort((a, b) => a - b);
      if (!nums.length) { log.push(`Skipped "${col}": no numeric values to compute ${strategy === 'fill_mean' ? 'mean' : 'median'}.`); continue; }
      fill = strategy === 'fill_mean'
        ? +(nums.reduce((a, b) => a + b, 0) / nums.length).toFixed(4)
        : nums[Math.floor(nums.length / 2)];
    } else if (strategy === 'fill_mode') {
      const freq = {};
      for (const v of nonEmpty) freq[String(v)] = (freq[String(v)] || 0) + 1;
      fill = Object.entries(freq).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
    } else if (strategy === 'fill_zero') fill = 0;
    else if (strategy === 'fill_value') fill = cfg.value ?? '';

    if (fill !== null) {
      out = out.map(r => isEmpty(r[col]) ? { ...r, [col]: fill } : r);
      log.push(`Filled ${missingBefore} missing value(s) in "${col}" with ${JSON.stringify(fill)} (${strategy.replace('fill_', '')}).`);
    }
  }

  // 4. Remove duplicate rows
  if (ops.removeDuplicates) {
    const seen = new Set();
    const before = out.length;
    out = out.filter(r => {
      const key = JSON.stringify(r);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    log.push(`Removed ${before - out.length} duplicate row(s).`);
  }

  // 5. Drop columns
  const drop = (ops.dropColumns || []).filter(c => colNames.includes(c));
  if (drop.length) {
    out = out.map(r => {
      const o = { ...r };
      for (const c of drop) delete o[c];
      return o;
    });
    log.push(`Removed column(s): ${drop.join(', ')}.`);
  }
  const newColumns = columns.filter(c => !drop.includes(c.name));

  return { rows: out, columns: newColumns, log };
}

module.exports = { applyCleaning };
