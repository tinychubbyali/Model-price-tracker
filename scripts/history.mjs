// Pure helpers for the one-year backfill, the weekly price indices and the daily review list.
// Kept free of I/O so they can be unit tested.
import { segmentOf } from '../docs/segments.js';

const DAY = 864e5;
const iso = (t) => new Date(t).toISOString().slice(0, 10);

// Monday of the ISO week containing `date` (YYYY-MM-DD).
export function weekOf(date) {
  const t = Date.parse(date);
  const dow = (new Date(t).getUTCDay() + 6) % 7; // Monday = 0
  return iso(t - dow * DAY);
}

// Monday dates from the week of `from` to the week of `to`, inclusive.
export function weeksBetween(from, to) {
  const out = [];
  for (let t = Date.parse(weekOf(from)); t <= Date.parse(weekOf(to)); t += 7 * DAY) out.push(iso(t));
  return out;
}

// "-latest" aliases are repointed to newer models; that looks like a price change but isn't one.
export const isAlias = (id) => /-latest$/.test(id);

// How each dataset stores a price row.
export const TEXT = {
  kind: 'text',
  pick: (r) => ({ input: r.input ?? null, output: r.output ?? null, cacheRead: r.cacheRead ?? null }),
  same: (a, b) => a.input === b.input && a.output === b.output && a.cacheRead === b.cacheRead,
  value: (r) => (r.input === null || r.output === null ? null : (r.input * 3 + r.output) / 4),
  group: (m) => segmentOf(m),
};
export const MM = {
  kind: 'mm',
  pick: (r) => r.std,
  same: (a, b) => a.std === b.std && JSON.stringify(a.native) === JSON.stringify(b.native),
  value: (r) => r.std ?? null,
  group: (m) => m.modality,
};

// Joins a state replayed from old weekly snapshots (dates before liveStart) onto the live state.
// Returns merged models and the change events implied at the seam, all marked backfill.
export function mergeBackfill(back, live, liveStart, fmt) {
  const models = structuredClone(live);
  const seam = [];
  for (const [id, b] of Object.entries(back)) {
    const m = models[id];
    if (!m) {
      const old = structuredClone(b);
      if (!old.removed) {
        old.removed = liveStart;
        seam.push({ date: liveStart, id, type: 'removed', before: fmt.pick(old), backfill: true });
      }
      models[id] = old;
      continue;
    }
    const lastBack = b.history.at(-1);
    const firstLive = m.history[0];
    let hist = m.history;
    if (b.removed) {
      seam.push({ date: firstLive.date, id, type: 'restored', after: fmt.pick(firstLive), backfill: true });
    } else if (fmt.same(lastBack, firstLive)) {
      hist = hist.slice(1);
    } else if (fmt.kind === 'text' || fmt.pick(lastBack) !== fmt.pick(firstLive)) {
      seam.push({ date: firstLive.date, id, type: 'changed', before: fmt.pick(lastBack), after: fmt.pick(firstLive), backfill: true });
    }
    m.history = [...b.history, ...hist];
    m.firstSeen = b.firstSeen;
  }
  return { models, seam };
}

// Price change events worth reviewing: real moves of non-alias models.
export function priceMoves(changes, fmt) {
  return changes.filter((c) => c.type === 'changed' && !isAlias(c.id) && (fmt.kind === 'mm'
    ? c.before !== c.after
    : c.before.input !== c.after.input || c.before.output !== c.after.output));
}

const reviewKey = (c) => `${c.id}@${c.date}`;

// Flags changes that look like data-entry errors in the source rather than vendor moves.
// bulk: one vendor, one week, 5+ models set to the very same price.
// flipflop: a model returns to its earlier price within 4 weeks.
// magnitude: price multiplied or divided by 5 or more at once.
export function anomalies(moves, fmt) {
  const flags = new Map();
  const add = (c, f) => flags.set(reviewKey(c), [...new Set([...(flags.get(reviewKey(c)) ?? []), f])]);
  const groups = new Map();
  for (const c of moves) {
    const k = `${c.id.split('/')[0]}|${weekOf(c.date)}|${JSON.stringify(fmt.kind === 'mm' ? c.after : [c.after.input, c.after.output])}`;
    groups.set(k, [...(groups.get(k) ?? []), c]);
  }
  for (const g of groups.values()) if (g.length >= 5) g.forEach((c) => add(c, 'bulk'));
  const byId = new Map();
  for (const c of moves) byId.set(c.id, [...(byId.get(c.id) ?? []), c]);
  for (const list of byId.values()) {
    list.sort((a, b) => a.date.localeCompare(b.date));
    for (let i = 1; i < list.length; i++) {
      const [a, b] = [list[i - 1], list[i]];
      const back = JSON.stringify(b.after) === JSON.stringify(a.before);
      if (back && Date.parse(b.date) - Date.parse(a.date) <= 28 * DAY) { add(a, 'flipflop'); add(b, 'flipflop'); }
    }
  }
  for (const c of moves) {
    const v = (x) => (fmt.kind === 'mm' ? x : (x.input * 3 + x.output) / 4);
    const r = v(c.after) / v(c.before);
    if (r >= 5 || r <= 0.2) add(c, 'magnitude');
  }
  return flags;
}

// Adds new price moves to the review list; existing entries (and their review notes) are kept.
export function updateReview(review, moves, flags, kind, today) {
  const items = { ...(review.items ?? {}) };
  let added = 0;
  for (const c of moves) {
    const key = reviewKey(c);
    const f = flags.get(key) ?? [];
    if (items[key]) { items[key] = { ...items[key], flags: f }; continue; }
    items[key] = { id: c.id, date: c.date, kind, before: c.before, after: c.after, backfill: !!c.backfill, flags: f, status: 'pending', announced: null, link: null, note: null, listed: today };
    added++;
  }
  return { review: { ...review, items }, added };
}

// A flagged change stays out of the index until someone confirms it; a change marked as an error never counts.
export const excluded = (item) => item && (item.status === 'error' || (item.flags.length > 0 && item.status !== 'confirmed'));

const median = (a) => {
  const s = a.filter((x) => x !== null && Number.isFinite(x)).sort((x, y) => x - y);
  if (!s.length) return null;
  const k = s.length >> 1;
  return s.length % 2 ? s[k] : (s[k - 1] + s[k]) / 2;
};

// Price of a model at the end of `end` (inclusive), honouring announcement dates from the review.
function priceAt(m, id, end, review, fmt) {
  if (m.firstSeen > end) return undefined;
  if (m.removed && m.removed <= end) return undefined;
  let row = null, rowEff = '';
  for (const h of m.history) {
    const eff = review[`${id}@${h.date}`]?.announced ?? h.date;
    if (eff <= end && eff >= rowEff) { row = h; rowEff = eff; }
  }
  return row ?? m.history[0];
}

// Weekly series per group: a chain-linked same-model index (CPI style, start = 100) and the
// median list price of everything on sale. Weeks run Monday to Sunday; the last may be partial.
export function weeklySeries(models, groups, fmt, { weeks, review = {}, today }) {
  const ids = Object.keys(models).filter((id) => !isAlias(id));
  const out = groups.map((g) => ({ id: g.id, chain: [], median: [], wow: [], count: [] }));
  const at = groups.map(() => 100);
  const started = groups.map(() => false);
  let prev = null;
  weeks.forEach((w, wi) => {
    const end = wi === weeks.length - 1 && today ? today : iso(Date.parse(w) + 6 * DAY);
    const now = new Map();
    for (const id of ids) {
      const m = models[id];
      const row = priceAt(m, id, end, review, fmt);
      if (row) now.set(id, { g: fmt.group(m), v: fmt.value(row), row });
    }
    groups.forEach((g, gi) => {
      const members = [...now.entries()].filter(([, x]) => x.g === g.id);
      const o = out[gi];
      o.count.push(members.length);
      o.median.push(members.length ? median(members.map(([, x]) => x.v)) : null);
      if (!members.length && !started[gi]) { o.chain.push(null); o.wow.push(null); return; }
      if (!started[gi]) { started[gi] = true; o.chain.push(100); o.wow.push(null); return; }
      const ratios = [];
      for (const [id, x] of members) {
        const p = prev?.get(id);
        if (!p || !(p.v > 0) || !(x.v > 0) || p.v === x.v) { if (p && p.v === x.v && x.v > 0) ratios.push(1); continue; }
        const key = Object.keys(review).find((k) => k.startsWith(`${id}@`) && weekOf(review[k].announced ?? review[k].date) === w && excluded(review[k]));
        if (key) { ratios.push(1); continue; }
        ratios.push(x.v / p.v);
      }
      if (ratios.length) at[gi] *= Math.exp(ratios.reduce((s, r) => s + Math.log(r), 0) / ratios.length);
      const last = o.chain.findLast((v) => v !== null) ?? 100;
      o.chain.push(+at[gi].toFixed(2));
      o.wow.push(ratios.length ? +((at[gi] / last - 1) * 100).toFixed(2) : 0);
    });
    prev = now;
  });
  return out;
}
