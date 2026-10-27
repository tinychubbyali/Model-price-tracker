// Fetches current list prices and records any changes into docs/data/.
// Usage: node scripts/fetch-prices.mjs [--from path/to/local.json]
import { readFile, writeFile } from 'node:fs/promises';
import { applySnapshot, normalize, sanityCheck } from './lib.mjs';

const SOURCE_URL =
  'https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json';
const FX_URL = 'https://open.er-api.com/v6/latest/USD';
const DATA_DIR = new URL('../docs/data/', import.meta.url);
const PRICES = new URL('prices.json', DATA_DIR);
const CHANGES = new URL('changes.json', DATA_DIR);

async function readJson(url, fallback) {
  try {
    return JSON.parse(await readFile(url, 'utf8'));
  } catch (err) {
    if (err.code === 'ENOENT') return fallback;
    throw err;
  }
}

async function loadSource() {
  const i = process.argv.indexOf('--from');
  if (i !== -1) return JSON.parse(await readFile(process.argv[i + 1], 'utf8'));
  const res = await fetch(SOURCE_URL);
  if (!res.ok) throw new Error(`price source returned HTTP ${res.status}`);
  return res.json();
}

async function loadUsdCny(previous) {
  try {
    const res = await fetch(FX_URL);
    const rate = (await res.json())?.rates?.CNY;
    if (typeof rate === 'number' && rate > 1) return rate;
  } catch {}
  return previous ?? 7.1;
}

const state = await readJson(PRICES, { models: {} });
const changes = await readJson(CHANGES, []);
const snapshot = normalize(await loadSource());

const errors = sanityCheck(state.models, snapshot);
if (Object.keys(snapshot).length === 0) errors.push('no models parsed from source');
if (errors.length) {
  console.error('Refusing to update prices:\n  ' + errors.join('\n  '));
  process.exit(1);
}

const now = new Date().toISOString();
const date = now.slice(0, 10);
const result = applySnapshot(state.models, snapshot, date);
// The first run seeds every model; listing them all as "added" would bury real changes.
if (Object.keys(state.models).length === 0) result.changes = [];

await writeFile(
  PRICES,
  JSON.stringify(
    { updatedAt: now, source: SOURCE_URL, usdCny: await loadUsdCny(state.usdCny), models: result.models },
    null,
    1,
  ) + '\n',
);
await writeFile(CHANGES, JSON.stringify([...result.changes, ...changes], null, 1) + '\n');

const counts = {};
for (const c of result.changes) counts[c.type] = (counts[c.type] ?? 0) + 1;
console.log(`${Object.keys(snapshot).length} models fetched; changes:`, counts);
