// Fetches multimodal list prices and records changes into docs/data/multimodal.json.
// Usage: node scripts/fetch-multimodal.mjs [--from path/to/local.json]
import { readFile, writeFile } from 'node:fs/promises';
import { applyMultimodal, normalizeManual, normalizeMultimodal, sanityCheckMultimodal } from './multimodal.mjs';

const SOURCE_URL =
  'https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json';
const DATA_DIR = new URL('../docs/data/', import.meta.url);
const OUT = new URL('multimodal.json', DATA_DIR);
const MANUAL = new URL('multimodal-manual.json', DATA_DIR);

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

const state = await readJson(OUT, { models: {}, changes: [] });
const manual = await readJson(MANUAL, { models: [] });
const auto = normalizeMultimodal(await loadSource());

const errors = sanityCheckMultimodal(state.models, auto);
if (Object.keys(auto).length === 0) errors.push('no multimodal models parsed from source');
if (errors.length) {
  console.error('Refusing to update multimodal prices:\n  ' + errors.join('\n  '));
  process.exit(1);
}

const now = new Date().toISOString();
const date = now.slice(0, 10);
const snapshot = { ...auto, ...normalizeManual(manual) };
const result = applyMultimodal(state.models, snapshot, date);
// The first run seeds every model; listing them all as "added" would bury real changes.
if (Object.keys(state.models).length === 0) result.changes = [];

await writeFile(
  OUT,
  JSON.stringify({ updatedAt: now, source: SOURCE_URL, notes: manual.notes ?? {}, models: result.models, changes: [...result.changes, ...(state.changes ?? [])] }, null, 1) + '\n',
);

const counts = {};
for (const m of Object.values(snapshot)) counts[m.modality] = (counts[m.modality] ?? 0) + 1;
console.log('multimodal models by modality:', counts, '; changes:', result.changes.length);
