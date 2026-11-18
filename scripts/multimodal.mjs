// Pure helpers for multimodal (video, image, speech, transcription, music, 3D) list prices.
// Vendors bill these in their own units; each model keeps its native prices and also gets a
// "standard deliverable" price (one 5-second 720p clip, one ~1K image, ...) so models in the
// same modality can be ranked. Kept free of I/O so they can be unit tested.

export const MODALITIES = [
  { id: 'video', name: '视频生成', std: '一条 5 秒 720p 视频' },
  { id: 'image', name: '图片生成', std: '一张约 1K（1024×1024）图片' },
  { id: 'tts', name: '语音合成', std: '1 分钟语音（约 900 个英文字符）' },
  { id: 'stt', name: '语音识别', std: '1 小时音频转写' },
  { id: 'music', name: '音乐生成', std: '一首歌（Lyria 片段版为 30 秒）' },
  { id: '3d', name: '3D 生成', std: '一个带贴图的 3D 模型' },
];

// Conversion assumptions behind the standard deliverables.
export const STD = {
  videoSeconds: 5,
  // OpenAI's published output size for a 1024×1024 high-quality gpt-image render.
  imageTokens1K: 4160,
  ttsCharsPerMinute: 900,
  // Gemini counts 32 tokens per second of audio.
  audioTokensPerSecond: 32,
};

// First-party vendors only; resellers (fal, Runway, Replicate, Azure, ...) are left out.
// `vendor` groups providers that are the same company (Gemini API and Vertex AI are both Google).
export const MM_PROVIDERS = {
  openai: { vendor: 'openai', name: 'OpenAI', prefix: '' },
  gemini: { vendor: 'google', name: 'Google', prefix: 'gemini/' },
  vertex_ai: { vendor: 'google', name: 'Google', prefix: 'vertex_ai/' },
  'vertex_ai-video-models': { vendor: 'google', name: 'Google', prefix: 'vertex_ai/' },
  xai: { vendor: 'xai', name: 'xAI', prefix: 'xai/' },
  minimax: { vendor: 'minimax', name: 'MiniMax', prefix: 'minimax/' },
  dashscope: { vendor: 'alibaba', name: '阿里 · 百炼', prefix: 'dashscope/' },
  volcengine: { vendor: 'bytedance', name: '字节 · 火山引擎', prefix: 'volcengine/' },
  elevenlabs: { vendor: 'elevenlabs', name: 'ElevenLabs', prefix: 'elevenlabs/' },
  black_forest_labs: { vendor: 'bfl', name: 'Black Forest Labs', prefix: 'black_forest_labs/' },
  mistral: { vendor: 'mistral', name: 'Mistral', prefix: 'mistral/' },
  deepgram: { vendor: 'deepgram', name: 'Deepgram', prefix: 'deepgram/' },
};
export const vendorName = (vendor) => Object.values(MM_PROVIDERS).find((p) => p.vendor === vendor)?.name ?? vendor;

const MODE_TO_MODALITY = {
  video_generation: 'video',
  image_generation: 'image',
  audio_speech: 'tts',
  audio_transcription: 'stt',
};

// Release stamps: -2026-03-02, -20260403, -260128 (Volcengine), -2602 (Mistral).
const DATE_SUFFIX = /-(\d{4}-\d{2}-\d{2}|\d{8}|\d{6}|\d{4})$/;
// Variants that only repeat a main model's price, matched against the name after the provider prefix.
const SKIP = [
  /-(latest|i2v|r2v)$/, // aliases and image-/reference-to-video twins of a text-to-video model
  /\//, // size or quality presets like 1024-x-1024/gpt-image-1, streaming/nova-3
  /^(dall-e|tts-1-(hd-)?1106)/,
  /^(gpt-4o|gpt-audio)(?!-mini-tts|-transcribe|-mini-transcribe)/, // chat models billed per token stay on the token tab
  /^(virtual-try-on|nano-banana-pro)/, // a try-on tool, and an alias of gemini-3-pro-image
];
// One name per model: release stamps, -preview / -001 tags and Mistral's -3-0 spelling are dropped.
export function canonicalName(short, provider) {
  const name = short.replace(DATE_SUFFIX, '').replace(/-(preview|experimental|exp)$/, '').replace(/-\d{3}$/, '');
  return provider === 'mistral' ? name.replace(/-(\d)-0$/, '-$1') : name;
}
// Deepgram lists one entry per domain (finance, phonecall, ...); keep the current flagship.
const KEEP_ONLY = { deepgram: /^nova-3$/ };

const num = (v) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null);
const round = (v, digits = 6) => (v === null ? null : Math.round(v * 10 ** digits) / 10 ** digits);

// Native prices kept per modality: exactly what the vendor bills, in USD.
function nativeOf(modality, v) {
  if (modality === 'video') {
    const base = num(v.output_cost_per_second) ?? num(v.output_cost_per_video_per_second);
    return {
      perSecond: base,
      '480p': num(v.output_cost_per_second_480p),
      '720p': num(v.output_cost_per_second_720p) ?? num(v.output_cost_per_second_768p),
      '1080p': num(v.output_cost_per_second_1080p),
      '4k': num(v.output_cost_per_second_4k),
    };
  }
  if (modality === 'image') {
    return {
      perImage: num(v.output_cost_per_image_1K) ?? num(v.output_cost_per_image) ?? num(v.input_cost_per_image),
      perImage2K: num(v.output_cost_per_image_2K),
      perImageToken: num(v.output_cost_per_image_token),
    };
  }
  if (modality === 'tts') {
    return {
      perChar: num(v.input_cost_per_character),
      perSecond: num(v.output_cost_per_second),
      perAudioToken: num(v.output_cost_per_audio_token),
    };
  }
  if (modality === 'stt') {
    return { perSecond: num(v.input_cost_per_second), perAudioToken: num(v.input_cost_per_audio_token) };
  }
  if (modality === 'music') {
    // LiteLLM stores Lyria's per-track price in the per-image field.
    return { perTrack: num(v.output_cost_per_image) };
  }
  return {};
}

// The standard deliverable price, and whether it rests on an assumption (an estimate).
const mul = (v, ...ks) => (v === null || v === undefined ? null : ks.reduce((a, k) => a * k, v));
export function standardPrice(modality, n) {
  const pick = (...pairs) => {
    for (const [v, est] of pairs) if (v !== null && v !== undefined) return { std: round(v), estimate: est };
    return { std: null, estimate: false };
  };
  if (modality === 'video') {
    const s = n['720p'] ?? n.perSecond ?? null;
    return pick([mul(s, STD.videoSeconds), false]);
  }
  if (modality === 'image') {
    return pick([n.perImage, false], [mul(n.perImageToken, STD.imageTokens1K), true]);
  }
  if (modality === 'tts') {
    return pick(
      [mul(n.perChar, STD.ttsCharsPerMinute), false],
      [mul(n.perSecond, 60), false],
      [mul(n.perAudioToken, STD.audioTokensPerSecond * 60), true],
    );
  }
  if (modality === 'stt') {
    return pick(
      [mul(n.perSecond, 3600), false],
      [mul(n.perAudioToken, STD.audioTokensPerSecond * 3600), true],
    );
  }
  if (modality === 'music') return pick([n.perTrack, false]);
  return pick([n.perModel ?? null, true]);
}

// Flagship / fast / light, read from the model name.
export function tierOf(model) {
  const word = (w) => new RegExp(`(^|[-_.])(${w})([-_.]|$)`).test(model);
  if (word('lite|mini|nano|clip|dev') || model === 'tts-1') return 'light';
  if (word('fast|flash|turbo')) return 'fast';
  return 'flagship';
}

// Turns the upstream dataset into { id: { modality, vendor, model, native, std, estimate, tier, source } }.
export function normalizeMultimodal(raw) {
  const out = {};
  for (const [key, v] of Object.entries(raw)) {
    if (!v || typeof v !== 'object') continue;
    const provider = MM_PROVIDERS[v.litellm_provider];
    if (!provider) continue;
    const short = key.startsWith(provider.prefix) ? key.slice(provider.prefix.length) : key;
    const modality = /^lyria/.test(short) ? 'music' : MODE_TO_MODALITY[v.mode];
    if (!modality) continue;
    if (SKIP.some((re) => re.test(short))) continue;
    if (KEEP_ONLY[v.litellm_provider] && !KEEP_ONLY[v.litellm_provider].test(short)) continue;
    const native = nativeOf(modality, v);
    const { std, estimate } = standardPrice(modality, native);
    if (std === null) continue;
    const base = canonicalName(short, v.litellm_provider);
    const id = `${provider.vendor}/${base}`;
    // Keep one entry per model: the plain name wins over a dated or preview release, and the Gemini API over Vertex.
    if (out[id] && !(out[id].dated && short === base)) continue;
    out[id] = {
      modality,
      vendor: provider.vendor,
      model: base,
      native: Object.fromEntries(Object.entries(native).filter(([, x]) => x !== null)),
      std,
      estimate,
      tier: tierOf(base),
      source: v.source ?? null,
      dated: short !== base,
    };
  }
  for (const m of Object.values(out)) delete m.dated;
  return out;
}

// Hand-maintained entries (subscription or credit pricing with no public per-unit API price).
export function normalizeManual(manual) {
  const out = {};
  for (const e of manual.models ?? []) {
    out[`${e.vendor}/${e.model}`] = {
      modality: e.modality,
      vendor: e.vendor,
      vendorName: e.vendorName,
      model: e.model,
      native: e.native ?? {},
      nativeText: e.nativeText,
      std: e.std,
      estimate: true,
      manual: true,
      tier: e.tier ?? 'flagship',
      source: e.source,
      checked: e.checked,
    };
  }
  return out;
}

// Refuses an update that looks like a broken fetch: a modality losing most of its models.
export function sanityCheckMultimodal(prev, next) {
  const errors = [];
  for (const { id } of MODALITIES) {
    const before = Object.values(prev).filter((m) => m.modality === id && !m.removed && !m.manual).length;
    const after = Object.values(next).filter((m) => m.modality === id && !m.manual).length;
    if (before >= 4 && after < before * 0.5) errors.push(`${id}: model count dropped from ${before} to ${after}`);
  }
  return errors;
}

// Merges a snapshot into stored state. History rows keep the native prices too, so a later
// backfill from older price files can write rows of the same shape.
export function applyMultimodal(prev, next, date) {
  const models = structuredClone(prev);
  const changes = [];
  const row = (m) => ({ date, std: m.std, native: m.native });
  for (const [id, m] of Object.entries(next)) {
    const old = models[id];
    if (!old) {
      models[id] = { ...m, firstSeen: date, history: [row(m)] };
      changes.push({ date, id, type: 'added', after: m.std });
      continue;
    }
    const changed = old.std !== m.std || JSON.stringify(old.native) !== JSON.stringify(m.native);
    const before = old.std;
    const { history, firstSeen, removed } = old;
    models[id] = { ...m, firstSeen, history };
    if (removed) {
      changes.push({ date, id, type: 'restored', after: m.std });
      history.push(row(m));
    } else if (changed) {
      if (before !== m.std) changes.push({ date, id, type: 'changed', before, after: m.std });
      history.push(row(m));
    }
  }
  for (const [id, old] of Object.entries(models)) {
    if (!next[id] && !old.removed) {
      old.removed = date;
      changes.push({ date, id, type: 'removed', before: old.std });
    }
  }
  return { models, changes };
}
