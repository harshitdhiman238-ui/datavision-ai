// ---------------------------------------------------------------
// Data profiling — every number here is calculated from real rows
// ---------------------------------------------------------------
const { isEmpty, isNumericVal, looksLikeDate, parseFlexibleDate, toNumber } = require('./parse');

function detectDateFormat(s) {
  if (typeof s !== 'string') return 'other';
  const t = s.trim();
  if (/^\d{4}-\d{1,2}-\d{1,2}/.test(t)) return 'YYYY-MM-DD';
  if (/^\d{1,2}\/\d{1,2}\/\d{2,4}$/.test(t)) return 'D/M/Y or M/D/Y';
  if (/^\d{1,2}-\d{1,2}-\d{2,4}$/.test(t)) return 'D-M-Y';
  if (/^\d{1,2}\.\d{1,2}\.\d{2,4}$/.test(t)) return 'D.M.Y';
  if (/^\d{1,2}\s+[A-Za-z]{3,9}\s+\d{2,4}$/.test(t)) return 'D Mon YYYY';
  if (/^[A-Za-z]{3,9}\s+\d{1,2},?\s+\d{2,4}$/.test(t)) return 'Mon D, YYYY';
  return 'other';
}

function profileDataset(rows, columns) {
  const n = rows.length;
  const colProfiles = [];

  // Duplicate rows (full-row match)
  const seen = new Map();
  let duplicateRows = 0;
  const duplicateIndexes = [];
  rows.forEach((r, i) => {
    const key = JSON.stringify(r);
    if (seen.has(key)) { duplicateRows++; duplicateIndexes.push(i); }
    else seen.set(key, i);
  });

  let totalMissing = 0;
  const emptyColumns = [];
  const whitespaceColumns = [];
  const mixedDateColumns = [];
  const typeIssueColumns = [];
  const suspiciousValues = [];

  for (const col of columns) {
    const vals = rows.map(r => r[col.name]);
    const missing = vals.filter(isEmpty).length;
    totalMissing += missing;
    const nonEmpty = vals.filter(v => !isEmpty(v));
    const distinct = new Set(nonEmpty.map(v => String(v))).size;

    let whitespace = 0, numericish = 0, dateish = 0;
    const dateFormats = new Set();
    for (const v of nonEmpty) {
      if (typeof v === 'string' && v !== v.trim()) whitespace++;
      if (isNumericVal(v)) numericish++;
      else if (looksLikeDate(v)) { dateish++; dateFormats.add(detectDateFormat(v)); }
    }
    if (whitespace > 0) whitespaceColumns.push({ column: col.name, count: whitespace });
    if (missing === n) emptyColumns.push(col.name);
    if (dateFormats.size > 1) mixedDateColumns.push({ column: col.name, formats: [...dateFormats] });

    // Type problems: a mostly-numeric column containing text values
    if (col.type === 'number') {
      const bad = nonEmpty.filter(v => !isNumericVal(v)).length;
      if (bad > 0) typeIssueColumns.push({ column: col.name, issue: `${bad} non-numeric value(s) in a numeric column` });
    }
    if (col.type === 'date') {
      const bad = nonEmpty.filter(v => !looksLikeDate(v)).length;
      if (bad > 0) typeIssueColumns.push({ column: col.name, issue: `${bad} value(s) could not be read as dates` });
    }

    // Suspicious values via configurable-style rules
    if (col.type === 'number') {
      const nums = nonEmpty.filter(isNumericVal).map(toNumber);
      const negatives = nums.filter(x => x < 0).length;
      const nameLC = col.name.toLowerCase();
      if (negatives > 0 && /(revenue|sales|amount|price|qty|quantity|units|age|count)/.test(nameLC)) {
        suspiciousValues.push({ column: col.name, rule: 'negative values in a quantity-like column', count: negatives });
      }
      // IQR-based outlier indicator
      if (nums.length >= 8) {
        const s = [...nums].sort((a, b) => a - b);
        const q = p => s[Math.min(s.length - 1, Math.floor(p * (s.length - 1)))];
        const q1 = q(0.25), q3 = q(0.75), iqr = q3 - q1;
        if (iqr > 0) {
          const out = nums.filter(x => x < q1 - 1.5 * iqr || x > q3 + 1.5 * iqr).length;
          if (out > 0) suspiciousValues.push({ column: col.name, rule: 'statistical outliers (1.5×IQR)', count: out });
        }
      }
    }

    let stats = null;
    if (col.type === 'number') {
      const nums = nonEmpty.filter(isNumericVal).map(toNumber);
      if (nums.length) {
        const sum = nums.reduce((a, b) => a + b, 0);
        stats = {
          min: Math.min(...nums.slice(0, 100000)),
          max: Math.max(...nums.slice(0, 100000)),
          mean: sum / nums.length,
          sum,
        };
      }
    } else if (col.type === 'date') {
      const ds = nonEmpty.map(parseFlexibleDate).filter(Boolean).map(d => d.getTime());
      if (ds.length) stats = { min: new Date(Math.min(...ds)).toISOString().slice(0, 10), max: new Date(Math.max(...ds)).toISOString().slice(0, 10) };
    }

    colProfiles.push({
      name: col.name, type: col.type,
      missing, missingPct: n ? +(missing / n * 100).toFixed(1) : 0,
      distinct, whitespace, stats,
      sample: nonEmpty.slice(0, 3).map(v => String(v).slice(0, 40)),
    });
  }

  // Simple quality score (transparent formula, shown in UI)
  const cells = n * columns.length || 1;
  const missingPenalty = (totalMissing / cells) * 60;
  const dupPenalty = n ? (duplicateRows / n) * 25 : 0;
  const wsPenalty = Math.min(10, whitespaceColumns.length * 2);
  const datePenalty = Math.min(5, mixedDateColumns.length * 2.5);
  const qualityScore = Math.max(0, Math.round(100 - missingPenalty - dupPenalty - wsPenalty - datePenalty));

  return {
    rowCount: n,
    colCount: columns.length,
    duplicateRows,
    duplicateIndexes: duplicateIndexes.slice(0, 200),
    totalMissing,
    emptyColumns,
    whitespaceColumns,
    mixedDateColumns,
    typeIssueColumns,
    suspiciousValues,
    qualityScore,
    columns: colProfiles,
  };
}

module.exports = { profileDataset, detectDateFormat };
