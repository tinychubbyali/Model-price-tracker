// One-off: rebuilds a year of price history from the git history of the LiteLLM price file.
// Takes the last main-line version of each week, replays it through the same parsers as the
// daily fetch, and joins the result onto the live data in docs/data/.
// Usage: node scripts/backfill.mjs --repo path/to/litellm-clone [--since 2025-11-10]
// A partial clone is enough: git clone --filter=blob:none --no-checkout https://github.com/BerriAI/litellm
import { execFileSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { applySnapshot, normalize } from './lib.mjs';
import { applyMultimodal, normalizeMultimodal } from './multimodal.mjs';
import { MM, TEXT, mergeBackfill, weekOf } from './history.mjs';

const FILE = 'model_prices_and_context_window.json';
const arg = (name, def) => {
  const i = process.argv.indexOf(name);
  return i === -1 ? def : process.argv[i + 1];
};
const repo = arg('--repo');
if (!repo) throw new Error('--repo path/to/litellm is required');
const since = arg('--since', '2025-11-10');
const DATA = new URL('../docs/data/', import.meta.url);
const read = async (f) => JSON.parse(await readFile(new URL(f, DATA), 'utf8'));
const write = (f, v) => writeFile(new URL(f, DATA), JSON.stringify(v, null, 1) + '\n');

const prices = await read('prices.json');
const changes = await read('changes.json');
const mm = await read('multimodal.json');
if ((prices.backfill || mm.backfill) && !process.argv.includes('--force')) {
  throw new Error('data already contains a backfill; pass --force to run it again on fresh data');
}

const liveText = Object.values(prices.models).map((m) => m.firstSeen).sort()[0];
const liveMm = Object.values(mm.models).map((m) => m.firstSeen).sort()[0];

// Main-line commits only: side-branch versions make models vanish and reappear between weeks.
const log = execFileSync('git', ['-C', repo, 'log', '--first-parent', `--since=${since}`, '--format=%H %cs', '--', FILE], { encoding: 'utf8', maxBuffer: 1 << 26 });
const byWeek = new Map();
for (const line of log.trim().split('\n').reverse()) {
  const [hash, date] = line.split(' ');
  byWeek.set(weekOf(date), { hash, date }); // oldest first, so the week's last commit wins
}
const snaps = [...byWeek.values()].sort((a, b) => a.date.localeCompare(b.date));
console.log(`${snaps.length} weekly versions, ${snaps[0].date} … ${snaps.at(-1).date}; live text from ${liveText}, multimodal from ${liveMm}`);

let text = {}, media = {};
const textChanges = [], mmChanges = [];
let first = { text: true, mm: true };
for (const s of snaps) {
  if (s.date >= liveText && s.date >= liveMm) break;
  const raw = JSON.parse(execFileSync('git', ['-C', repo, 'show', `${s.hash}:${FILE}`], { encoding: 'utf8', maxBuffer: 1 << 28 }));
  if (s.date < liveText) {
    const r = applySnapshot(text, normalize(raw), s.date);
    text = r.models;
    if (!first.text) textChanges.push(...r.changes.map((c) => ({ ...c, backfill: true })));
    first.text = false;
  }
  if (s.date < liveMm) {
    const r = applyMultimodal(media, normalizeMultimodal(raw), s.date);
    media = r.models;
    if (!first.mm) mmChanges.push(...r.changes.map((c) => ({ ...c, backfill: true })));
    first.mm = false;
  }
}

const newestFirst = (list) => list.sort((a, b) => b.date.localeCompare(a.date));
const t = mergeBackfill(text, prices.models, liveText, TEXT);
const m = mergeBackfill(media, mm.models, liveMm, MM);
const meta = (until) => ({ from: snaps[0].date, until, source: 'https://github.com/BerriAI/litellm/commits/main/model_prices_and_context_window.json', method: '每周取主线上最后一个版本' });

await write('prices.json', { ...prices, backfill: meta(liveText), models: t.models });
await write('changes.json', newestFirst([...changes, ...t.seam, ...textChanges]));
await write('multimodal.json', { ...mm, backfill: meta(liveMm), models: m.models, changes: newestFirst([...(mm.changes ?? []), ...m.seam, ...mmChanges]) });
console.log(`text: ${Object.keys(t.models).length} models, ${textChanges.length + t.seam.length} backfilled events; multimodal: ${Object.keys(m.models).length} models, ${mmChanges.length + m.seam.length} events`);
