// ---------------------------------------------------------------
// Insight generation.
// 1) If OPENAI_API_KEY (or compatible) is set in .env, verified
//    statistics are sent to the AI API from the SERVER and the
//    response is labelled "AI-generated".
// 2) Otherwise a rule-based engine produces plain-English insights
//    from the same verified statistics, labelled "rule-based".
// Numbers always come from fullAnalysis(); the AI never invents data.
// ---------------------------------------------------------------
const { fullAnalysis, groupBy, timeSeries, describe, colNumbers, detectRoles } = require('./stats');
const { profileDataset } = require('./profile');
const { isEmpty } = require('./parse');

const fmt = n => typeof n === 'number' ? n.toLocaleString('en-IN', { maximumFractionDigits: 2 }) : n;

// ---------- Rule-based insight engine ----------
function ruleBasedInsights(rows, columns) {
  const a = fullAnalysis(rows, columns);
  const p = profileDataset(rows, columns);
  const insights = [];

  // Category leaders
  for (const b of a.categoryBreakdowns.slice(0, 3)) {
    if (!b.top.length) continue;
    const top = b.top[0];
    const metricWord = b.valueCol ? `total ${b.valueCol}` : 'record count';
    const totalAll = b.top.concat(b.bottom).reduce((s, e) => s + e[b.metric], 0);
    const share = b.valueCol && totalAll > 0 ? '' : '';
    insights.push({
      type: 'leader', severity: 'positive',
      title: `"${top.key}" leads ${b.column}`,
      text: `Among ${b.totalGroups} ${b.column} groups, "${top.key}" has the highest ${metricWord} at ${fmt(top[b.metric])}.` +
        (b.top[1] ? ` It is ${b.top[1][b.metric] ? fmt(+(top[b.metric] / b.top[1][b.metric]).toFixed(2)) : '—'}× the next group ("${b.top[1].key}" at ${fmt(b.top[1][b.metric])}).` : ''),
      evidence: { column: b.column, metric: b.metric, valueCol: b.valueCol, top: b.top.slice(0, 5) },
    });
    if (b.bottom.length && b.totalGroups > 3) {
      const low = b.bottom[0];
      insights.push({
        type: 'laggard', severity: 'warning',
        title: `"${low.key}" trails in ${b.column}`,
        text: `"${low.key}" has the lowest ${metricWord} (${fmt(low[b.metric])}) across ${b.column}. Worth checking whether this is expected.`,
        evidence: { column: b.column, metric: b.metric, bottom: b.bottom },
      });
    }
  }

  // Trend insight
  if (a.trend && a.trend.length >= 3) {
    const metric = a.trendValueCol ? 'sum' : 'count';
    const first = a.trend[0], last = a.trend[a.trend.length - 1];
    const change = first[metric] !== 0 ? ((last[metric] - first[metric]) / Math.abs(first[metric])) * 100 : null;
    const best = [...a.trend].sort((x, y) => y[metric] - x[metric])[0];
    insights.push({
      type: 'trend', severity: change !== null && change < 0 ? 'warning' : 'positive',
      title: change !== null ? `${a.trendValueCol || 'Activity'} ${change >= 0 ? 'grew' : 'declined'} ${fmt(Math.abs(change))}% over the period` : 'Time trend detected',
      text: `From ${first.key} to ${last.key}, monthly ${a.trendValueCol ? `total ${a.trendValueCol}` : 'record count'} moved from ${fmt(first[metric])} to ${fmt(last[metric])}. The strongest month was ${best.key} (${fmt(best[metric])}).`,
      evidence: { series: a.trend.slice(-12), metric },
    });
  }

  // Correlation insight
  if (a.correlations) {
    const { cols, matrix } = a.correlations;
    let best = null;
    for (let i = 0; i < cols.length; i++) for (let j = i + 1; j < cols.length; j++) {
      const r = matrix[i][j];
      if (r !== null && (!best || Math.abs(r) > Math.abs(best.r))) best = { a: cols[i], b: cols[j], r };
    }
    if (best && Math.abs(best.r) >= 0.5) {
      insights.push({
        type: 'correlation', severity: 'info',
        title: `${best.a} and ${best.b} are ${Math.abs(best.r) >= 0.8 ? 'strongly' : 'moderately'} ${best.r > 0 ? 'positively' : 'negatively'} correlated`,
        text: `Pearson correlation r = ${best.r}. ${best.r > 0 ? 'They tend to rise and fall together.' : 'When one rises the other tends to fall.'} Correlation does not prove causation.`,
        evidence: { r: best.r, columns: [best.a, best.b] },
      });
    }
  }

  // Outliers
  for (const o of a.outliers.slice(0, 2)) {
    insights.push({
      type: 'outlier', severity: 'warning',
      title: `${o.count} outlier value(s) in ${o.column}`,
      text: `Values outside [${fmt(o.low)}, ${fmt(o.high)}] (1.5×IQR rule). Examples: ${o.examples.map(fmt).join(', ')}. These may be data entry errors or genuinely exceptional records.`,
      evidence: o,
    });
  }

  // Data quality
  if (p.duplicateRows > 0) insights.push({
    type: 'quality', severity: 'warning',
    title: `${p.duplicateRows} duplicate row(s) detected`,
    text: `Duplicates can inflate totals. Use Data Cleaning → "Remove duplicate rows" before relying on aggregate numbers.`,
    evidence: { duplicateRows: p.duplicateRows },
  });
  const worstMissing = [...p.columns].sort((x, y) => y.missingPct - x.missingPct)[0];
  if (worstMissing && worstMissing.missingPct > 5) insights.push({
    type: 'quality', severity: 'warning',
    title: `"${worstMissing.name}" is ${worstMissing.missingPct}% empty`,
    text: `${worstMissing.missing} of ${p.rowCount} rows have no value for "${worstMissing.name}". Consider a fill strategy or dropping affected rows in Data Cleaning.`,
    evidence: { column: worstMissing.name, missing: worstMissing.missing, pct: worstMissing.missingPct },
  });
  if (!insights.length) insights.push({
    type: 'info', severity: 'info',
    title: 'Dataset looks clean and uniform',
    text: `No strong leaders, trends, correlations or quality problems were detected across ${p.rowCount} rows and ${p.colCount} columns. Try exploring individual columns in the Charts tab.`,
    evidence: {},
  });
  return { engine: 'rule-based', insights };
}

// ---------- Optional AI integration (server-side key only) ----------
async function aiInsights(rows, columns) {
  const key = process.env.OPENAI_API_KEY;
  if (!key) return null;
  const a = fullAnalysis(rows, columns);
  const p = profileDataset(rows, columns);
  const evidence = {
    rowCount: p.rowCount, colCount: p.colCount, qualityScore: p.qualityScore,
    duplicateRows: p.duplicateRows, totalMissing: p.totalMissing,
    numericStats: a.numericStats,
    categoryBreakdowns: a.categoryBreakdowns.map(b => ({ column: b.column, valueCol: b.valueCol, top: b.top.slice(0, 5) })),
    monthlyTrend: a.trend ? a.trend.slice(-12) : null,
    outliers: a.outliers,
  };
  const body = {
    model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
    messages: [
      { role: 'system', content: 'You are a data analyst. You are given VERIFIED statistics computed from a real dataset. Write 4-6 short insights in simple English. Only state facts supported by the given numbers; cite the numbers. Return JSON: {"insights":[{"title":"...","text":"...","severity":"positive|warning|info"}]}' },
      { role: 'user', content: JSON.stringify(evidence) },
    ],
    response_format: { type: 'json_object' },
  };
  const res = await fetch((process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1') + '/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`AI API error ${res.status}`);
  const json = await res.json();
  const parsed = JSON.parse(json.choices[0].message.content);
  return { engine: 'ai', insights: (parsed.insights || []).map(i => ({ ...i, type: 'ai', evidence })) };
}

async function generateInsights(rows, columns) {
  try {
    const ai = await aiInsights(rows, columns);
    if (ai) return ai;
  } catch (e) {
    console.warn('[insights] AI call failed, falling back to rules:', e.message);
  }
  return ruleBasedInsights(rows, columns);
}

// ---------- Natural-language question answering ----------
// Translates a limited set of question patterns into SAFE, predefined
// analytical operations. No user text is ever executed as SQL/code.
function answerQuestion(question, rows, columns) {
  const q = String(question || '').toLowerCase().trim();
  if (!q) return { answer: 'Please type a question.', method: null };
  const roles = detectRoles(columns, rows);
  const colNames = columns.map(c => c.name);
  const findCol = () => colNames.find(c => q.includes(c.toLowerCase()));

  const valueCol = colNames.find(c => q.includes(c.toLowerCase()) && columns.find(x => x.name === c).type === 'number')
    || roles.revenue || roles.numerics[0] || null;
  const catCol = colNames.find(c => q.includes(c.toLowerCase()) && columns.find(x => x.name === c).type === 'text')
    || (q.includes('product') ? roles.product : null)
    || (q.includes('categor') ? roles.category : null)
    || (q.includes('region') || q.includes('state') || q.includes('city') || q.includes('country') ? roles.region : null)
    || roles.category || roles.product || roles.categoricals[0] || null;

  // duplicates
  if (/duplicate/.test(q)) {
    const seen = new Set(); let dup = 0;
    for (const r of rows) { const k = JSON.stringify(r); if (seen.has(k)) dup++; else seen.add(k); }
    return { answer: `The dataset contains ${dup} exact duplicate row(s) out of ${rows.length} rows.`, method: 'Full-row comparison of all rows.', table: null };
  }
  // missing
  if (/missing|null|empty|blank/.test(q)) {
    const t = columns.map(c => ({ Column: c.name, Missing: rows.filter(r => isEmpty(r[c.name])).length }))
      .filter(x => x.Missing > 0).sort((a, b) => b.Missing - a.Missing);
    return { answer: t.length ? `${t.length} column(s) contain missing values. The worst is "${t[0].Column}" with ${t[0].Missing} missing cells.` : 'No missing values were found in any column.', method: 'Counted empty cells per column.', table: t.slice(0, 10) };
  }
  // monthly / trend
  if (/month|trend|over time|growth|timeline|yearly|daily/.test(q) && roles.date) {
    const gran = /daily|per day/.test(q) ? 'day' : /year/.test(q) ? 'year' : 'month';
    const series = timeSeries(rows, roles.date, valueCol, gran);
    const metric = valueCol ? 'sum' : 'count';
    const best = [...series].sort((a, b) => b[metric] - a[metric])[0];
    return {
      answer: valueCol
        ? `${series.length} ${gran} period(s) found using "${roles.date}". Total ${valueCol} peaked in ${best?.key} at ${fmt(best?.[metric])}.`
        : `${series.length} ${gran} period(s) found. The busiest was ${best?.key} with ${best?.count} records.`,
      method: `Grouped rows by ${gran} of "${roles.date}"${valueCol ? ` and summed "${valueCol}"` : ' and counted rows'}.`,
      table: series.map(s => ({ Period: s.key, [valueCol ? `Total ${valueCol}` : 'Records']: valueCol ? s.sum : s.count })).slice(-24),
      chart: { kind: 'line', labels: series.map(s => s.key), values: series.map(s => valueCol ? s.sum : s.count), label: valueCol ? `Total ${valueCol}` : 'Records' },
    };
  }
  // top / best / highest / compare
  const topMatch = q.match(/top\s*(\d+)/);
  if (/top|best|highest|most|largest|maximum|compare|leading|winner/.test(q) && catCol) {
    const n = topMatch ? Math.min(25, +topMatch[1]) : 5;
    const g = groupBy(rows, catCol, valueCol);
    const top = g.entries.slice(0, n);
    return {
      answer: top.length ? `By ${valueCol ? `total ${valueCol}` : 'record count'}, the top ${catCol} is "${top[0].key}" (${fmt(top[0][g.metric])}).` : 'No groups found.',
      method: `Grouped rows by "${catCol}"${valueCol ? `, summed "${valueCol}"` : ', counted rows'}, sorted descending.`,
      table: top.map(e => ({ [catCol]: e.key, [valueCol ? `Total ${valueCol}` : 'Records']: e[g.metric] })),
      chart: { kind: 'bar', labels: top.map(e => e.key), values: top.map(e => e[g.metric]), label: valueCol ? `Total ${valueCol}` : 'Records' },
    };
  }
  // bottom / worst / lowest
  if (/bottom|worst|lowest|least|minimum|weakest/.test(q) && catCol) {
    const n = (q.match(/bottom\s*(\d+)/) || [])[1] ? Math.min(25, +q.match(/bottom\s*(\d+)/)[1]) : 5;
    const g = groupBy(rows, catCol, valueCol);
    const bottom = g.entries.slice(-n).reverse();
    return {
      answer: bottom.length ? `The lowest ${catCol} by ${valueCol ? `total ${valueCol}` : 'count'} is "${bottom[0].key}" (${fmt(bottom[0][g.metric])}).` : 'No groups found.',
      method: `Grouped rows by "${catCol}"${valueCol ? `, summed "${valueCol}"` : ''}, sorted ascending.`,
      table: bottom.map(e => ({ [catCol]: e.key, [valueCol ? `Total ${valueCol}` : 'Records']: e[g.metric] })),
      chart: { kind: 'bar', labels: bottom.map(e => e.key), values: bottom.map(e => e[g.metric]), label: valueCol ? `Total ${valueCol}` : 'Records' },
    };
  }
  // "<metric> by <category>" — grouped aggregation, e.g. "total revenue by region",
  // "average profit per category", "sales by payment method"
  if (/\b(by|per|across|for each|in each)\b/.test(q) && catCol && valueCol) {
    const explicitNumeric = colNames.some(c => q.includes(c.toLowerCase()) && columns.find(x => x.name === c).type === 'number');
    const wantsCount = /how many|number of|count of|count\b/.test(q) && !explicitNumeric;
    const agg = wantsCount ? 'count' : /average|avg|mean/.test(q) ? 'avg' : 'sum';
    const g = groupBy(rows, catCol, wantsCount ? null : valueCol, agg);
    const entries = g.entries.slice(0, 25);
    const label = wantsCount ? 'Records' : `${agg === 'avg' ? 'Average' : 'Total'} ${valueCol}`;
    if (entries.length) {
      return {
        answer: `${label} by ${catCol}: "${entries[0].key}" is highest at ${fmt(entries[0][g.metric])}${entries.length > 1 ? `, "${entries[entries.length - 1].key}" is lowest at ${fmt(entries[entries.length - 1][g.metric])}` : ''} (${entries.length} group(s)).`,
        method: wantsCount
          ? `Grouped rows by "${catCol}" and counted records per group, sorted descending.`
          : `Grouped rows by "${catCol}" and ${agg === 'avg' ? 'averaged' : 'summed'} "${valueCol}" per group, sorted descending.`,
        table: entries.map(e => ({ [catCol]: e.key, [label]: e[g.metric] })),
        chart: { kind: 'bar', labels: entries.map(e => e.key), values: entries.map(e => e[g.metric]), label },
      };
    }
  }
  // average / total / sum / count of a column
  if (/average|avg|mean|total|sum|count|how many|minimum|min |maximum|max /.test(q)) {
    const col = findCol() || valueCol;
    if (/how many|count/.test(q) && !col) {
      return { answer: `The dataset has ${rows.length} rows and ${columns.length} columns.`, method: 'Counted rows and columns.' };
    }
    if (col && columns.find(c => c.name === col)?.type === 'number') {
      const d = describe(colNumbers(rows, col));
      if (d) return {
        answer: `"${col}": total ${fmt(+d.sum.toFixed(2))}, average ${fmt(+d.mean.toFixed(2))}, min ${fmt(d.min)}, max ${fmt(d.max)} (from ${d.count} values).`,
        method: `Computed descriptive statistics over all non-empty numeric values of "${col}".`,
        table: [{ Statistic: 'Sum', Value: +d.sum.toFixed(2) }, { Statistic: 'Average', Value: +d.mean.toFixed(2) }, { Statistic: 'Median', Value: +d.median.toFixed(2) }, { Statistic: 'Min', Value: d.min }, { Statistic: 'Max', Value: d.max }, { Statistic: 'Std Dev', Value: +d.std.toFixed(2) }],
      };
    }
    if (col) {
      const distinct = new Set(rows.map(r => r[col]).filter(v => !isEmpty(v)).map(String)).size;
      return { answer: `"${col}" has ${distinct} distinct value(s) across ${rows.length} rows.`, method: `Counted unique non-empty values of "${col}".` };
    }
  }
  // distinct values
  if (/distinct|unique/.test(q)) {
    const col = findCol();
    if (col) {
      const distinct = new Set(rows.map(r => r[col]).filter(v => !isEmpty(v)).map(String)).size;
      return { answer: `"${col}" has ${distinct} unique value(s).`, method: `Counted unique non-empty values of "${col}".` };
    }
  }
  return {
    answer: 'I could not map that question to a supported analysis. Try questions like: "Which product has the highest revenue?", "Show monthly sales", "Find duplicate rows", "Average of <column>", or "Compare the top 5 categories".',
    method: null,
    supported: true,
  };
}

module.exports = { generateInsights, ruleBasedInsights, answerQuestion };
