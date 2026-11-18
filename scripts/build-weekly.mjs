// Builds docs/data/weekly.json (weekly price indices, price events) and keeps docs/data/review.json
// (the daily review list of price changes) up to date. Runs after the daily fetches.
// Usage: node scripts/build-weekly.mjs
import { readFile, writeFile } from 'node:fs/promises';
import { SEGMENTS } from '../docs/segments.js';
import { MODALITIES, vendorName } from './multimodal.mjs';
import { MM, TEXT, anomalies, excluded, priceMoves, updateReview, weekOf, weeksBetween, weeklySeries } from './history.mjs';

const DATA = new URL('../docs/data/', import.meta.url);
const read = async (f, fallback) => {
  try { return JSON.parse(await readFile(new URL(f, DATA), 'utf8')); } catch (e) { if (e.code === 'ENOENT') return fallback; throw e; }
};
const write = (f, v) => writeFile(new URL(f, DATA), JSON.stringify(v, null, 1) + '\n');

const prices = await read('prices.json');
const changes = await read('changes.json', []);
const mm = await read('multimodal.json');
let review = await read('review.json', { about: '每日待复核的调价清单。status: pending 待复核 / confirmed 已确认 / error 确认是数据源错误。announced 填厂商公告日期，link 填公告链接。', items: {} });

const today = new Date().toISOString().slice(0, 10);
const sets = [
  { fmt: TEXT, models: prices.models, changes, groups: SEGMENTS.map((s) => ({ id: s.id, name: s.name })) },
  { fmt: MM, models: mm.models, changes: mm.changes ?? [], groups: MODALITIES.map((m) => ({ id: m.id, name: m.name })) },
];

let added = 0;
for (const s of sets) {
  const moves = priceMoves(s.changes, s.fmt);
  const r = updateReview(review, moves, anomalies(moves, s.fmt), s.fmt.kind, today);
  review = r.review;
  added += r.added;
}

const start = [prices, mm].map((d) => d.backfill?.from ?? Object.values(d.models).map((m) => m.firstSeen).sort()[0]).sort()[0];
const weeks = weeksBetween(start, today);
const groups = [];
const events = [];
for (const s of sets) {
  const series = weeklySeries(s.models, s.groups, s.fmt, { weeks, review: review.items, today });
  s.groups.forEach((g, i) => groups.push({ kind: s.fmt.kind, ...g, ...series[i] }));
  for (const [key, it] of Object.entries(review.items)) {
    if (it.kind !== s.fmt.kind) continue;
    const m = s.models[it.id];
    if (!m) continue;
    const v = (x) => (s.fmt.kind === 'mm' ? x : (x.input * 3 + x.output) / 4);
    events.push({
      key, kind: it.kind, id: it.id, date: it.date, week: weekOf(it.announced ?? it.date),
      name: m.model, vendor: s.fmt.kind === 'mm' ? (m.vendorName ?? vendorName(m.vendor)) : m.provider,
      group: s.fmt.group(m), before: it.before, after: it.after, pct: +((v(it.after) / v(it.before) - 1) * 100).toFixed(1),
      flags: it.flags, status: it.status, announced: it.announced, link: it.link ?? m.source ?? null,
      backfill: it.backfill, excluded: !!excluded(it),
    });
  }
}
events.sort((a, b) => (b.announced ?? b.date).localeCompare(a.announced ?? a.date));

// New models per week, by dataset, from the change logs.
const launches = weeks.map((w) => sets.map((s) => s.changes.filter((c) => c.type === 'added' && weekOf(c.date) === w).length));

await write('review.json', review);
await write('weekly.json', {
  updatedAt: new Date().toISOString(),
  weeks,
  partialLast: weekOf(today) === weeks.at(-1) && new Date(today).getUTCDay() !== 0,
  backfill: { text: prices.backfill ?? null, mm: mm.backfill ?? null },
  groups,
  events,
  launches,
});
const pending = Object.values(review.items).filter((i) => i.status === 'pending').length;
console.log(`weekly: ${weeks.length} weeks, ${groups.length} groups, ${events.length} price events; review: ${added} new, ${pending} pending`);
