// Prints the daily review list (price changes waiting for an announcement date) as Markdown.
// Usage: node scripts/review-digest.mjs [--all]   (default: only items listed in the last 2 days, plus counts)
import { readFile } from 'node:fs/promises';

const DATA = new URL('../docs/data/', import.meta.url);
const review = JSON.parse(await readFile(new URL('review.json', DATA), 'utf8'));
const weekly = JSON.parse(await readFile(new URL('weekly.json', DATA), 'utf8'));
const byKey = new Map(weekly.events.map((e) => [e.key, e]));
const FLAG = { bulk: '同厂商同周多个模型改成同一价格', flipflop: '价格来回跳', magnitude: '单次变动 5 倍以上' };

const all = process.argv.includes('--all');
const cutoff = new Date(Date.now() - 2 * 864e5).toISOString().slice(0, 10);
const items = Object.entries(review.items).map(([key, it]) => ({ key, ...it, e: byKey.get(key) }));
const pending = items.filter((i) => i.status === 'pending');
const fresh = all ? pending : pending.filter((i) => i.listed >= cutoff && !i.backfill);
const fmt = (i) => (i.kind === 'mm' ? `$${i.before} → $${i.after}` : `输入/输出 $${i.before.input}/$${i.before.output} → $${i.after.input}/$${i.after.output}`);

console.log(`待复核 ${pending.length} 条（其中潜在异常 ${pending.filter((i) => i.flags.length).length} 条，回溯 ${pending.filter((i) => i.backfill).length} 条）；新增 ${fresh.length} 条。\n`);
for (const i of fresh.sort((a, b) => b.date.localeCompare(a.date))) {
  console.log(`- ${i.date} ${i.id}：${fmt(i)}（${i.e ? `${i.e.pct > 0 ? '+' : ''}${i.e.pct}%` : ''}）${i.flags.length ? ` 潜在异常：${i.flags.map((f) => FLAG[f]).join('、')}` : ''}${i.e?.link ? ` [价格页](${i.e.link})` : ''}`);
}
