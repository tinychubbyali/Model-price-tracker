// Pure helpers for the macro indicators. Kept free of I/O so they can be unit tested.

// Value-chain layers, upstream to downstream. The site renders them in this order.
export const LAYERS = [
  { id: 'compute', name: '算力供给', blurb: '芯片和算力卖得怎么样，决定了整个行业能用多少算力。' },
  { id: 'capex', name: '资本投入', blurb: '云厂商每季度花多少钱建数据中心，是对未来 AI 需求的押注。' },
  { id: 'tokens', name: '模型层（Token）', blurb: '算力最终变成 Token 卖出去，Token 的价格反映供需和技术进步。' },
  { id: 'demand', name: '需求与用量', blurb: 'Token 实际被用了多少：开发者平台的公开用量，加上厂商公布的调用量。' },
  { id: 'markets', name: '收入与资本市场', blurb: '模型公司赚到钱了吗，市场又怎么给产业链各环节定价。' },
];

import { SEGMENTS, matchKey, segmentOf, segmentOfSlug } from '../docs/segments.js';

export { SEGMENTS, segmentOf, segmentOfSlug };

const DAY = 864e5;
const days = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / DAY);

// SEC XBRL facts mix 3-month figures with year-to-date ones (cash-flow items are almost
// always year-to-date, and Q4 only appears inside the annual total). Recover single
// quarters by subtracting the shorter year-to-date figure that shares the same start.
export function quarterly(facts) {
  const byPeriod = new Map();
  for (const f of facts) {
    if (!f.start || !f.end || typeof f.val !== 'number' || !/^10-[QK]/.test(f.form ?? '')) continue;
    const key = `${f.start}|${f.end}`;
    const prev = byPeriod.get(key);
    if (!prev || (f.filed ?? '') > (prev.filed ?? '')) byPeriod.set(key, f);
  }
  const periods = [...byPeriod.values()];
  const out = new Map();
  for (const f of periods) {
    const d = days(f.start, f.end);
    if (d >= 80 && d <= 100) {
      out.set(f.end, f.val);
      continue;
    }
    if (d < 170 || d > 375) continue;
    const prior = periods.find((p) => p.start === f.start && Math.abs(days(p.end, f.end) - 91) <= 10);
    if (prior && !out.has(f.end)) out.set(f.end, f.val - prior.val);
  }
  return [...out].map(([date, value]) => ({ date, value })).sort((a, b) => a.date.localeCompare(b.date));
}

// Calendar quarter label for a fiscal period end date, e.g. 2025-08-31 -> 2025Q3.
export function calendarQuarter(date) {
  const [y, m] = date.split('-').map(Number);
  return `${y}Q${Math.ceil(m / 3)}`;
}

// Sums several quarterly series by calendar quarter, keeping only quarters every series reports.
export function sumByQuarter(seriesList) {
  const totals = new Map();
  for (const s of seriesList) {
    for (const p of s.points) {
      const q = calendarQuarter(p.date);
      const t = totals.get(q) ?? { value: 0, n: 0 };
      t.value += p.value;
      t.n += 1;
      totals.set(q, t);
    }
  }
  return [...totals]
    .filter(([, t]) => t.n === seriesList.length)
    .map(([q, t]) => ({ date: q, value: t.value }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

// Parses Alpha Vantage TIME_SERIES_WEEKLY JSON into weekly closes, oldest first.
export function parseAlphaVantage(body) {
  const series = body?.['Weekly Time Series'];
  if (!series || typeof series !== 'object') return [];
  return Object.entries(series)
    .map(([date, v]) => ({ date, value: Number(v?.['4. close']) }))
    .filter((p) => /^\d{4}-\d{2}-\d{2}$/.test(p.date) && Number.isFinite(p.value))
    .sort((a, b) => a.date.localeCompare(b.date));
}

// A blended price weights output 3:1 against input, a common proxy for a chat workload.
const blended = (h) => (h.input * 3 + h.output) / 4;

function median(xs) {
  const s = [...xs].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

// Daily median blended price across models that were listed on each day.
export function tokenPriceIndex(models, today, segment) {
  const list = Object.values(models).filter((m) => !segment || segmentOf(m) === segment);
  if (!list.length) return [];
  const start = list.map((m) => m.firstSeen).sort()[0];
  const points = [];
  for (let t = Date.parse(start); t <= Date.parse(today); t += DAY) {
    const date = new Date(t).toISOString().slice(0, 10);
    const prices = [];
    for (const m of list) {
      if (m.firstSeen > date || (m.removed && m.removed <= date)) continue;
      const h = m.history.findLast((x) => x.date <= date);
      if (h && h.input !== null && h.output !== null) prices.push(blended(h));
    }
    if (prices.length) points.push({ date, value: Math.round(median(prices) * 1e4) / 1e4 });
  }
  return points;
}

// Monthly count of price cuts and hikes, from the change log.
export function priceMoves(changes, models, segment) {
  const months = new Map();
  for (const c of changes) {
    if (c.type !== 'changed') continue;
    if (segment && (!models[c.id] || segmentOf(models[c.id]) !== segment)) continue;
    const before = blended(c.before);
    const after = blended(c.after);
    if (!Number.isFinite(before) || !Number.isFinite(after) || before === after) continue;
    const m = c.date.slice(0, 7);
    const row = months.get(m) ?? { date: m, cuts: 0, hikes: 0 };
    row[after < before ? 'cuts' : 'hikes'] += 1;
    months.set(m, row);
  }
  return [...months.values()].sort((a, b) => a.date.localeCompare(b.date));
}

// OpenRouter rankings rows ({date, model_permaslug, total_tokens}) -> weekly totals overall and by segment,
// plus the latest week's top models. "other" rows count toward the total only.
// endDate is the last complete day the data covers; a week that runs past it is partial and dropped,
// since comparing two days against a full week would look like a collapse in usage.
export function weeklyUsage(rows, endDate) {
  const complete = (d) => !endDate || Date.parse(d) + 6 * 864e5 <= Date.parse(endDate);
  rows = (rows ?? []).filter((r) => complete(r.date ?? ''));
  const total = new Map();
  const bySeg = Object.fromEntries(SEGMENTS.map((s) => [s.id, new Map()]));
  for (const r of rows ?? []) {
    const v = Number(r.total_tokens);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(r.date ?? '') || !Number.isFinite(v)) continue;
    total.set(r.date, (total.get(r.date) ?? 0) + v);
    const seg = r.model_permaslug === 'other' ? null : segmentOfSlug(r.model_permaslug ?? '');
    if (seg) bySeg[seg].set(r.date, (bySeg[seg].get(r.date) ?? 0) + v);
  }
  const dates = [...total.keys()].sort();
  // A segment with no model in the top 50 that week counts as zero, so its line doesn't freeze on an old value.
  const toPoints = (m) => dates.map((date) => ({ date, value: m.get(date) ?? 0 }));
  const last = dates.at(-1);
  const top = (rows ?? [])
    .filter((r) => r.date === last && r.model_permaslug !== 'other')
    .map((r) => ({ slug: r.model_permaslug, tokens: Number(r.total_tokens), segment: segmentOfSlug(r.model_permaslug) }))
    .sort((a, b) => b.tokens - a.tokens)
    .slice(0, 10);
  return {
    total: dates.map((date) => ({ date, value: total.get(date) })),
    bySegment: Object.fromEntries(Object.entries(bySeg).map(([k, m]) => [k, toPoints(m)])),
    top,
  };
}

// Artificial Analysis rows from OpenRouter's benchmarks endpoint -> { matchKey: {name, slug, scores} }.
const AA_SCORES = ['intelligence_index', 'engineering_index', 'finance_and_accounting_index', 'legal_index'];
export function benchmarkIndex(items) {
  const out = {};
  for (const it of items ?? []) {
    if (it?.source !== 'artificial-analysis' || typeof it.model_permaslug !== 'string') continue;
    const scores = Object.fromEntries(AA_SCORES.filter((k) => typeof it[k] === 'number').map((k) => [k.replace('_index', ''), it[k]]));
    if (!Object.keys(scores).length) continue;
    const key = matchKey(it.model_permaslug);
    // Several variants can share a key (":free", ":thinking"); keep the highest-scoring one.
    if (!out[key] || (scores.intelligence ?? 0) > (out[key].scores.intelligence ?? 0)) {
      out[key] = { name: it.display_name ?? it.model_permaslug, slug: it.model_permaslug, scores };
    }
  }
  return out;
}
