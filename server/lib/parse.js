// ---------------------------------------------------------------
// Workbook / CSV parsing + column type inference
// ---------------------------------------------------------------
const XLSX = require('xlsx');

const MAX_ROWS = 50000; // processing cap for this demo platform

// Date detection: ISO, D/M/Y, M/D/Y, "Jan 5 2024", Excel serials handled by XLSX
const DATE_PATTERNS = [
  /^\d{4}-\d{1,2}-\d{1,2}([T ].*)?$/,            // 2024-01-31
  /^\d{1,2}[\/\-.]\d{1,2}[\/\-.]\d{2,4}$/,       // 31/01/2024, 1-31-24
  /^\d{1,2}\s+[A-Za-z]{3,9}\s+\d{2,4}$/,         // 31 Jan 2024
  /^[A-Za-z]{3,9}\s+\d{1,2},?\s+\d{2,4}$/,       // Jan 31, 2024
];

function looksLikeDate(v) {
  if (v instanceof Date) return true;
  if (typeof v !== 'string') return false;
  const s = v.trim();
  if (!s || /^\d+(\.\d+)?$/.test(s)) return false; // plain numbers are not dates
  return DATE_PATTERNS.some(re => re.test(s)) && !isNaN(parseFlexibleDate(s)?.getTime());
}

// Parse common date strings. For ambiguous d/m vs m/d we prefer D/M/Y
// (common in India) unless the first part can only be a month.
function parseFlexibleDate(v) {
  if (v instanceof Date) return v;
  if (typeof v !== 'string') return null;
  const s = v.trim();
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})([T ].*)?$/);
  if (m) return new Date(+m[1], +m[2] - 1, +m[3]);
  m = s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})$/);
  if (m) {
    let a = +m[1], b = +m[2], y = +m[3];
    if (y < 100) y += 2000;
    let day = a, mon = b;
    if (a <= 12 && b > 12) { mon = a; day = b; }      // must be M/D
    if (a > 12 && b <= 12) { day = a; mon = b; }      // must be D/M
    if (mon > 12 || day > 31) return null;
    return new Date(y, mon - 1, day);
  }
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

function isNumericVal(v) {
  if (typeof v === 'number') return isFinite(v);
  if (typeof v !== 'string') return false;
  const s = v.trim().replace(/[,₹$€£%]/g, '');
  return s !== '' && !isNaN(Number(s));
}

function toNumber(v) {
  if (typeof v === 'number') return v;
  if (typeof v !== 'string') return NaN;
  return Number(v.trim().replace(/[,₹$€£%]/g, ''));
}

function isEmpty(v) {
  return v === null || v === undefined || (typeof v === 'string' && v.trim() === '');
}

// Infer a column type from sampled values: number | date | boolean | text
function inferType(values) {
  const sample = values.filter(v => !isEmpty(v)).slice(0, 500);
  if (!sample.length) return 'empty';
  let nums = 0, dates = 0, bools = 0;
  for (const v of sample) {
    if (typeof v === 'boolean' || /^(true|false|yes|no)$/i.test(String(v).trim())) bools++;
    if (isNumericVal(v)) nums++;
    else if (looksLikeDate(v)) dates++;
  }
  const n = sample.length;
  if (bools / n > 0.9) return 'boolean';
  if (nums / n > 0.85) return 'number';
  if (dates / n > 0.7) return 'date';
  return 'text';
}

// Parse an uploaded buffer (.csv/.xlsx/.xls) → { rows, columns, truncated, sheetName }
function parseUpload(buffer, filename) {
  const ext = (filename.split('.').pop() || '').toLowerCase();
  if (!['csv', 'xlsx', 'xls'].includes(ext)) {
    throw Object.assign(new Error('Unsupported file type. Please upload a .csv, .xlsx or .xls file.'), { status: 400 });
  }
  let wb;
  try {
    wb = XLSX.read(buffer, { type: 'buffer', cellDates: true, raw: false });
  } catch (e) {
    throw Object.assign(new Error('Could not read this file. It may be corrupted or password-protected.'), { status: 400 });
  }
  const sheetName = wb.SheetNames[0];
  if (!sheetName) throw Object.assign(new Error('The workbook contains no sheets.'), { status: 400 });
  const ws = wb.Sheets[sheetName];
  let rows = XLSX.utils.sheet_to_json(ws, { defval: null, raw: false, dateNF: 'yyyy-mm-dd' });
  if (!rows.length) throw Object.assign(new Error('No data rows were found in the file (the first sheet appears empty).'), { status: 400 });

  const truncated = rows.length > MAX_ROWS;
  if (truncated) rows = rows.slice(0, MAX_ROWS);

  // Normalise headers: trim, de-duplicate
  const rawCols = Object.keys(rows[0]);
  const seen = {};
  const colMap = {};
  for (const c of rawCols) {
    let name = String(c).trim() || 'Column';
    if (seen[name] != null) name = `${name}_${++seen[name]}`;
    else seen[name] = 0;
    colMap[c] = name;
  }
  if (rawCols.some(c => colMap[c] !== c)) {
    rows = rows.map(r => {
      const o = {};
      for (const c of rawCols) o[colMap[c]] = r[c];
      return o;
    });
  }
  const colNames = rawCols.map(c => colMap[c]);

  // Convert Date objects to ISO strings for JSON storage
  rows = rows.map(r => {
    for (const k of colNames) {
      if (r[k] instanceof Date) r[k] = r[k].toISOString().slice(0, 10);
    }
    return r;
  });

  const columns = colNames.map(name => ({
    name,
    type: inferType(rows.map(r => r[name])),
  }));

  // Excel serial-date rescue: some .xlsx files store dates as raw serial
  // numbers (e.g. 45839) with no date format applied, so they arrive as
  // plain numbers. If a column header mentions "date" and its values look
  // like Excel date serials (1954..2064 range), convert them to ISO dates.
  const isSerial = (v) => {
    const n = toNumber(v);
    return Number.isFinite(n) && Number.isInteger(n) && n >= 20000 && n <= 60000;
  };
  for (const col of columns) {
    if (col.type !== 'number') continue;
    if (!/date/i.test(col.name)) continue;
    const vals = rows.map(r => r[col.name]).filter(v => !isEmpty(v));
    if (!vals.length) continue;
    const serialShare = vals.filter(isSerial).length / vals.length;
    if (serialShare < 0.85) continue;
    for (const r of rows) {
      if (!isEmpty(r[col.name]) && isSerial(r[col.name])) {
        const n = toNumber(r[col.name]);
        // 25569 = days between 1899-12-30 (Excel epoch) and 1970-01-01
        r[col.name] = new Date(Math.round((n - 25569) * 86400000)).toISOString().slice(0, 10);
      }
    }
    col.type = 'date';
  }

  return { rows, columns, truncated, sheetName };
}

module.exports = { parseUpload, inferType, looksLikeDate, parseFlexibleDate, isNumericVal, toNumber, isEmpty, MAX_ROWS };
