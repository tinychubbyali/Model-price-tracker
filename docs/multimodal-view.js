// Multimodal tab: video, image, speech, transcription, music and 3D prices, each converted to the
// price of one standard deliverable so models in a modality can be ranked side by side.
import { bindHover, legend, lineChart } from './charts.js';

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

export const MODALITIES = [
  { id: 'video', name: '视频生成', std: '一条 5 秒 720p 视频', short: '条 5 秒 720p 视频', color: 'var(--series-2)',
    note: '按秒计价，分辨率越高越贵。标准成品 = 720p 每秒价 × 5 秒；只报一个价的模型按该价计算。' },
  { id: 'image', name: '图片生成', std: '一张约 1K 图片', short: '张 1K 图片', color: 'var(--series-4)',
    note: '多数按张计价。OpenAI 按“图片 token”计价，按官方公布的 1024×1024 高质量约 4,160 个输出 token 估算，标为“估算”。' },
  { id: 'tts', name: '语音合成', std: '1 分钟语音', short: '分钟语音', color: 'var(--series-3)',
    note: '大多按输入字符计价，1 分钟按约 900 个英文字符算（中文约 250–300 字，会更便宜）。按秒或按音频 token 计价的也换算到 1 分钟，音频 token 按每秒 32 个估算。' },
  { id: 'stt', name: '语音识别', std: '1 小时音频转写', short: '小时转写', color: 'var(--series-5)',
    note: '按音频时长计价，换算成每小时。只按音频 token 计价的按每秒 32 个估算。' },
  { id: 'music', name: '音乐生成', std: '一首歌', short: '首歌', color: 'var(--series-1)',
    note: 'Google Lyria 有官方按首计价（片段版为 30 秒）。Suno 只卖订阅，按“月费 ÷ 套餐内可生成的歌曲数”估算，人工录入。' },
  { id: '3d', name: '3D 生成', std: '一个带贴图的 3D 模型', short: '个 3D 模型', color: 'var(--text-secondary)',
    note: '多数按积分计费，没有公开的按次 API 牌价，按“订阅价 ÷ 积分 × 每个模型消耗的积分”估算，人工录入。' },
];
const TIER_NAMES = { flagship: '旗舰', fast: '快速', light: '轻量' };
const VENDOR_NAMES = {
  openai: 'OpenAI', google: 'Google', xai: 'xAI', minimax: 'MiniMax', alibaba: '阿里 · 百炼', bytedance: '字节 · 火山引擎',
  elevenlabs: 'ElevenLabs', bfl: 'Black Forest Labs', mistral: 'Mistral', deepgram: 'Deepgram',
};

const vendorOf = (m) => m.vendorName ?? VENDOR_NAMES[m.vendor] ?? m.vendor;

// Friendlier names for the model ids vendors use in their APIs.
export function displayName(m) {
  return m.model
    .replace(/^doubao-seedance-(\d+)-(\d+)/, 'Seedance $1.$2')
    .replace(/^gemini-3-pro-image$/, 'Nano Banana Pro（Gemini 3 Pro Image）')
    .replace(/-generate$/, '')
    .replace(/_/g, ' ');
}

const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  if (!s.length) return null;
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
};

// The value a model's history held on a given date (history rows are in date order).
const valueOn = (history, date, f) => {
  let v = null;
  for (const h of history) { if (h.date <= date) v = f(h); else break; }
  return v;
};
const activeOn = (m, date) => m.firstSeen <= date && (!m.removed || m.removed > date);

// Daily index of a group's median price, 100 on its first recorded day.
export function indexSeries(models, f, dates) {
  const pts = [];
  for (const date of dates) {
    const vals = models.filter((m) => activeOn(m, date)).map((m) => valueOn(m.history, date, f)).filter((v) => v > 0);
    const med = median(vals);
    if (med !== null) pts.push({ date, value: med });
  }
  const base = pts[0]?.value;
  return base ? pts.map((p) => ({ date: p.date, value: Math.round((p.value / base) * 1000) / 10 })) : [];
}

function datesFrom(start, end) {
  const out = [];
  for (let t = Date.parse(start); t <= Date.parse(end); t += 864e5) out.push(new Date(t).toISOString().slice(0, 10));
  return out;
}

// Native price in the vendor's own unit, with small per-unit prices scaled to readable units.
function nativeText(m, money) {
  if (m.nativeText) return esc(m.nativeText);
  const n = m.native ?? {};
  const parts = [];
  if (m.modality === 'image') {
    if (n.perImage) parts.push(`${money(n.perImage)}/张${n.perImage2K ? ` · 2K ${money(n.perImage2K)}` : ''}`);
    if (n.perImageToken) parts.push(`${money(n.perImageToken * 1e6)}/百万图片 token`);
  } else if (m.modality === 'tts') {
    if (n.perChar) parts.push(`${money(n.perChar * 1e6)}/百万字符`);
    if (n.perSecond) parts.push(`${money(n.perSecond * 60)}/分钟`);
    if (n.perAudioToken) parts.push(`${money(n.perAudioToken * 1e6)}/百万音频 token`);
  } else if (m.modality === 'stt') {
    if (n.perSecond) parts.push(`${money(n.perSecond * 60)}/分钟`);
    else if (n.perAudioToken) parts.push(`${money(n.perAudioToken * 1e6)}/百万音频 token`);
  } else if (m.modality === 'music') {
    if (n.perTrack) parts.push(`${money(n.perTrack)}/首`);
  }
  return parts.join('；') || '—';
}

const VIDEO_RES = [['480p', '480p'], ['720p', '720p'], ['1080p', '1080p'], ['4k', '4K']];

function table(mod, models, money) {
  const rows = models.filter((m) => m.modality === mod.id && !m.removed).sort((a, b) => b.std - a.std);
  if (!rows.length) return '<p class="empty">暂无数据</p>';
  const max = Math.max(...rows.map((m) => m.std));
  const extraHead = mod.id === 'video'
    ? VIDEO_RES.map(([, label]) => `<th class="num">${label}<span class="native">每秒</span></th>`).join('')
    : '<th>厂商原生计价</th>';
  const body = rows.map((m) => {
    const tags = [
      m.estimate ? '<span class="tag warn" title="按假设换算，不是厂商直接报的价">估算</span>' : '',
      m.manual ? `<span class="tag">人工录入 · ${esc(m.checked ?? '')}</span>` : '',
      m.history.length > 1 ? `<span class="tag">调价 ${m.history.length - 1} 次</span>` : '',
    ].join('');
    const extra = mod.id === 'video'
      ? VIDEO_RES.map(([k]) => {
        const v = m.native[k] ?? (k === '720p' ? m.native.perSecond : null);
        return `<td class="num res${k === '720p' ? ' em' : ''}">${v ? money(v) : '—'}</td>`;
      }).join('')
      : `<td class="res">${nativeText(m, money)}</td>`;
    const name = m.source ? `<a href="${esc(m.source)}" rel="noopener">${esc(displayName(m))}</a>` : esc(displayName(m));
    return `<tr><td>${name}${tags}</td><td>${esc(vendorOf(m))}</td><td><span class="tier t-${m.tier}">${TIER_NAMES[m.tier] ?? ''}</span></td>` +
      `<td class="num"><span class="std">${money(m.std)}</span><span class="bar" style="width:${Math.max(3, Math.round((60 * m.std) / max))}px"></span></td>${extra}</tr>`;
  }).join('');
  return `<div class="table-scroll"><table class="mm-table">
    <thead><tr><th>模型</th><th>厂商</th><th>档位</th><th class="num">${esc(mod.std)}</th>${extraHead}</tr></thead>
    <tbody>${body}</tbody></table></div>`;
}

function notesBlock(note) {
  if (!note) return '';
  return `<div class="mm-note"><h3>${esc(note.title)}${note.asOf ? `<span class="tag">截至 ${esc(note.asOf)}</span>` : ''}</h3>
    <ul>${note.items.map((t) => `<li>${esc(t)}</li>`).join('')}</ul>
    ${note.source ? `<p class="source"><a href="${esc(note.source)}" rel="noopener">来源</a></p>` : ''}</div>`;
}

// "$1 buys": the flagship median and the cheapest model in each modality, plus text tokens for scale.
function buyCards(models, textMedian, money) {
  const cards = MODALITIES.map((mod) => {
    const live = models.filter((m) => m.modality === mod.id && !m.removed);
    if (!live.length) return '';
    const flag = median(live.filter((m) => m.tier === 'flagship').map((m) => m.std)) ?? median(live.map((m) => m.std));
    const cheapest = live.reduce((a, b) => (b.std < a.std ? b : a));
    const n = (p) => { const k = 1 / p; return k >= 100 ? Math.round(k).toLocaleString('en-US') : k >= 10 ? k.toFixed(0) : k.toFixed(1); };
    return `<article class="kpi"><h3>${esc(mod.name)}</h3>
      <p class="kpi-value">${n(flag)} <span class="unit">${esc(mod.short)}</span></p>
      <p class="kpi-sub">旗舰档中位价 ${money(flag)}</p>
      <p class="kpi-note">最便宜：${esc(displayName(cheapest))}，可买 ${n(cheapest.std)}</p></article>`;
  });
  if (textMedian) {
    const wan = 1e6 / textMedian / 1e4; // 万 output tokens per dollar
    cards.push(`<article class="kpi"><h3>文本（对照）</h3>
      <p class="kpi-value">${wan >= 10 ? wan.toFixed(0) : wan.toFixed(1)} <span class="unit">万输出 token</span></p>
      <p class="kpi-sub">全部文本模型输出价中位数 ${money(textMedian)}/百万 token</p>
      <p class="kpi-note">数据来自“Token 价格”页</p></article>`);
  }
  return `<div class="kpi-grid mm-buy">${cards.join('')}</div>`;
}

function changesList(mm, money) {
  const list = (mm.changes ?? []).slice(0, 8);
  if (!list.length) return '<p class="empty">从开始记录至今还没有检测到调价，有变动时会出现在这里。</p>';
  const name = (id) => (mm.models[id] ? displayName(mm.models[id]) : id.split('/').slice(1).join('/'));
  const what = (c) => {
    if (c.type === 'added') return `新上线：${money(c.after)}`;
    if (c.type === 'removed') return '已从价目表下架';
    if (c.type === 'restored') return `重新上架：${money(c.after)}`;
    return `${money(c.before)} → <span class="${c.after < c.before ? 'down' : 'up'}">${money(c.after)}</span>`;
  };
  return `<ul class="changes">${list.map((c) => `<li><time>${esc(c.date)}</time><span>${esc(name(c.id))} <span class="tag">${esc(MODALITIES.find((m) => m.id === mm.models[c.id]?.modality)?.name ?? '')}</span> ${what(c)}</span></li>`).join('')}</ul>`;
}

const MIN_DAYS = 7;

// Before there is a trend to draw: each modality's starting median, the 100 of the index.
function baseline(series, models, textMedian, money) {
  const rows = MODALITIES.filter((m) => !['music', '3d'].includes(m.id)).map((mod) => {
    const live = models.filter((m) => m.modality === mod.id && !m.removed && !m.manual);
    return `<tr><td><span class="dot" style="background:${mod.color}"></span>${esc(mod.name)}</td><td>${esc(mod.std)}</td><td class="num">${money(median(live.map((m) => m.std)))}</td><td class="num">${live.length}</td></tr>`;
  });
  rows.push(`<tr><td><span class="dot" style="background:var(--accent)"></span>文本 token</td><td>每百万输出 token</td><td class="num">${money(textMedian)}</td><td class="num">—</td></tr>`);
  return `<div class="table-scroll"><table class="mm-table"><thead><tr><th>模态</th><th>标准成品</th><th class="num">起点中位价</th><th class="num">模型数</th></tr></thead><tbody>${rows.join('')}</tbody></table></div>`;
}

export function renderMultimodal(el, { mm, money, textModels, sub, onSub }) {
  if (!mm) {
    el.innerHTML = '<p class="empty">多模态数据还没有生成，下一次每日抓取后会出现。</p>';
    return;
  }
  const models = Object.values(mm.models);
  const today = mm.updatedAt.slice(0, 10);
  const start = models.reduce((d, m) => (m.firstSeen < d ? m.firstSeen : d), today);
  const dates = datesFrom(start, today);

  const textLive = Object.values(textModels ?? {}).filter((m) => !m.removed);
  const textMedian = median(textLive.map((m) => m.output));

  const series = MODALITIES.map((mod) => ({
    name: mod.name, color: mod.color,
    points: indexSeries(models.filter((m) => m.modality === mod.id && !m.manual), (h) => h.std, dates),
  }));
  series.push({
    name: '文本 token', color: 'var(--accent)',
    points: indexSeries(Object.values(textModels ?? {}), (h) => (h.input * 3 + h.output) / 4, dates),
  });
  const days = dates.length;

  const mod = MODALITIES.find((m) => m.id === sub) ?? MODALITIES[0];
  const count = (id) => models.filter((m) => m.modality === id && !m.removed).length;

  el.innerHTML = `
    <p class="lead">视频、图片、语音的计价单位各不相同，硬折成每百万 token 并不可靠。这里给每种模态定一个“标准成品”，统一算出做一件要多少钱，厂商原生单价放在旁边。只收官方渠道的牌价，转售平台不收。</p>
    <section class="card">
      <h2>1 美元能买到什么 <span class="unit">（按当前牌价，${esc(today)}）</span></h2>
      ${buyCards(models, textMedian, money)}
    </section>
    <section class="card">
      <h2>各模态价格指数 <span class="unit">各模态标准成品价的中位数，起点记为 100</span></h2>
      <p class="kpi-note">不同单位的模态放在同一张图上，比较谁降价更快。音乐和 3D 是人工估算价，不计入指数。${days < MIN_DAYS ? `从 ${esc(start)} 开始记录，满 ${MIN_DAYS} 天后这里会出现走势图；过去一年的历史价格会在下一版补上。下表是起点。` : ''}</p>
      ${days < MIN_DAYS ? baseline(series, models, textMedian, money) : legend(series) + lineChart(series, { width: 760, height: 240, format: (v) => v.toFixed(0), endLabels: true })}
    </section>
    <section class="card">
      <div class="subtabs" role="tablist">${MODALITIES.map((m) => `<button type="button" role="tab" data-sub="${m.id}" aria-pressed="${m.id === mod.id}">${esc(m.name)} <span class="count">${count(m.id)}</span></button>`).join('')}</div>
      <h2>${esc(mod.name)} <span class="unit">按「${esc(mod.std)}」从贵到便宜排列</span></h2>
      <p class="kpi-note mm-mod-note">${esc(mod.note)}</p>
      ${table(mod, models, money)}
      ${notesBlock(mm.notes?.[mod.id])}
      <p class="source">价格来源：<a href="${esc(mm.source)}" rel="noopener">LiteLLM 价目表</a>，只取官方渠道（模型名链接到各家官方价格页）；人工录入的条目注明了核对日期和来源。</p>
    </section>
    <section class="card">
      <h2>最近变化</h2>
      ${changesList(mm, money)}
    </section>`;
  bindHover(el, (v) => v.toFixed(1));
  for (const b of el.querySelectorAll('[data-sub]')) b.addEventListener('click', () => onSub(b.dataset.sub));
}
