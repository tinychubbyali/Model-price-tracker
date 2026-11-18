// Model segments, grouped by what drives their prices. Shared by the site and the fetch scripts.

export const SEGMENTS = [
  { id: 'frontier', name: '海外前沿闭源', driver: '核心研发与芯片代际带来的推理成本下降' },
  { id: 'china', name: '中国模型', driver: '开源与价格竞争、国产芯片、云厂商生态补贴' },
  { id: 'open', name: '开源权重托管', driver: '推理硬件效率与托管商竞争' },
  { id: 'multimodal', name: '多模态', driver: '计价单位和成本结构与文本不同' },
  { id: 'niche', name: '小众与专用', driver: '特定场景的需求' },
];
const CHINA_PROVIDERS = new Set(['deepseek', 'dashscope', 'zai', 'moonshot']);
const MULTIMODAL = /audio|realtime|tts|vision|omni|image|-vl-|lyria|robotics/;
const NICHE = /code|coder|codestral|devstral|search|computer-use|deep-research|cyber/;

// Specialised and multimodal variants are split out first; the rest follow their vendor.
export function segmentOf(m) {
  if (MULTIMODAL.test(m.model)) return 'multimodal';
  if (NICHE.test(m.model)) return 'niche';
  return CHINA_PROVIDERS.has(m.provider) ? 'china' : 'frontier';
}

// OpenRouter model slugs ("vendor/model") have no provider field, so the vendor prefix decides.
const CHINA_VENDORS = new Set(['deepseek', 'qwen', 'z-ai', 'thudm', 'moonshotai', 'minimax', 'bytedance',
  'bytedance-seed', 'baidu', 'tencent', 'stepfun', 'stepfun-ai', 'xiaomi', 'meituan', 'inclusionai', 'kwaipilot', 'baichuan']);
const OPEN_VENDORS = new Set(['meta-llama', 'nvidia', 'microsoft', 'allenai', 'nousresearch', 'cohere', 'ibm-granite', 'liquid', 'arcee-ai']);
// Open-weight releases from closed-model vendors.
const OPEN_MODELS = /^(google\/gemma|openai\/gpt-oss|mistralai\/(mistral-small|ministral|mixtral|mistral-nemo|mistral-7b))/;

export function segmentOfSlug(slug) {
  const [vendor, ...rest] = slug.split(':')[0].split('/');
  const model = rest.join('/');
  if (!model) return null; // the "other" bucket
  if (MULTIMODAL.test(model)) return 'multimodal';
  if (NICHE.test(model)) return 'niche';
  if (CHINA_VENDORS.has(vendor)) return 'china';
  if (OPEN_VENDORS.has(vendor) || OPEN_MODELS.test(slug)) return 'open';
  return 'frontier';
}

// Loose key for matching our model names to OpenRouter slugs: claude-sonnet-4.5 == claude-sonnet-4-5.
export const matchKey = (name) => name.split(':')[0].split('/').pop().toLowerCase().replace(/[._\s]/g, '-');
