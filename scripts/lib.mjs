// Pure helpers for normalizing price data and recording changes.
// Kept free of I/O so they can be unit tested.

export const PROVIDERS = {
  openai: { name: 'OpenAI', prefix: '' },
  anthropic: { name: 'Anthropic', prefix: '' },
  gemini: { name: 'Google Gemini', prefix: 'gemini/' },
  deepseek: { name: 'DeepSeek', prefix: 'deepseek/' },
  dashscope: { name: '阿里云百炼 (Qwen)', prefix: 'dashscope/' },
  xai: { name: 'xAI', prefix: 'xai/' },
  mistral: { name: 'Mistral', prefix: 'mistral/' },
  zai: { name: '智谱 (Z.ai)', prefix: 'zai/' },
  moonshot: { name: 'Moonshot (Kimi)', prefix: 'moonshot/' },
};

const PRICE_FIELDS = ['input', 'output', 'cacheRead'];

// Dated snapshots (gpt-4o-2024-08-06, claude-x-20251001) duplicate their alias.
const SNAPSHOT = /-(\d{4}-\d{2}-\d{2}|\d{8}|\d{4})$/;

const perMillion = (v) =>
  typeof v === 'number' && Number.isFinite(v) ? Math.round(v * 1e6 * 1e6) / 1e6 : null;

// Turns the upstream dataset into { id: { provider, model, input, output, cacheRead, source } }.
export function normalize(raw) {
  const out = {};
  for (const [key, v] of Object.entries(raw)) {
    if (!v || typeof v !== 'object') continue;
    const provider = PROVIDERS[v.litellm_provider];
    if (!provider || v.mode !== 'chat') continue;
    if (key.startsWith('ft:') || SNAPSHOT.test(key)) continue;
    const model = key.startsWith(provider.prefix) ? key.slice(provider.prefix.length) : key;
    // Resold third-party models (e.g. dashscope/deepseek-v4) are not the vendor's own list price.
    if (v.litellm_provider === 'dashscope' && !/^(qwen|qwq)/.test(model)) continue;
    const input = perMillion(v.input_cost_per_token);
    const output = perMillion(v.output_cost_per_token);
    if (input === null || output === null) continue;
    const id = `${v.litellm_provider}/${model}`;
    if (out[id]) continue; // gemini lists some models with and without prefix
    out[id] = {
      provider: v.litellm_provider,
      model,
      input,
      output,
      cacheRead: perMillion(v.cache_read_input_token_cost),
      source: v.source ?? null,
    };
  }
  return out;
}

// Refuses to record an update that looks like a broken fetch rather than real price changes.
export function sanityCheck(prev, next) {
  const errors = [];
  for (const p of Object.keys(PROVIDERS)) {
    const before = Object.values(prev).filter((m) => m.provider === p && !m.removed).length;
    const after = Object.values(next).filter((m) => m.provider === p).length;
    if (before > 0 && after < before * 0.5) {
      errors.push(`${p}: model count dropped from ${before} to ${after}`);
    }
  }
  for (const [id, m] of Object.entries(next)) {
    if (m.input < 0 || m.output < 0) errors.push(`${id}: negative price`);
  }
  return errors;
}

// Merges a fresh snapshot into the stored state, returning the new state and the change events.
export function applySnapshot(prev, next, date) {
  const models = structuredClone(prev);
  const changes = [];
  const pick = (m) => Object.fromEntries(PRICE_FIELDS.map((f) => [f, m[f] ?? null]));

  for (const [id, m] of Object.entries(next)) {
    const old = models[id];
    if (!old) {
      models[id] = { ...m, firstSeen: date, history: [{ date, ...pick(m) }] };
      changes.push({ date, id, type: 'added', after: pick(m) });
      continue;
    }
    const before = pick(old);
    const after = pick(m);
    const changed = PRICE_FIELDS.some((f) => before[f] !== after[f]);
    Object.assign(old, { source: m.source }, after);
    if (old.removed) {
      delete old.removed;
      changes.push({ date, id, type: 'restored', after });
      old.history.push({ date, ...after });
    } else if (changed) {
      changes.push({ date, id, type: 'changed', before, after });
      old.history.push({ date, ...after });
    }
  }

  for (const [id, old] of Object.entries(models)) {
    if (!next[id] && !old.removed) {
      old.removed = date;
      changes.push({ date, id, type: 'removed', before: pick(old) });
    }
  }
  return { models, changes };
}
