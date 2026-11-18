// Overview and price-trend pages, drawn from data/weekly.json (one point per week, a year back).
import { SERIES_COLORS, bindWeekly, weekHeatmap, weeklyChart } from './charts.js';
import { MODALITIES } from './multimodal-view.js';
import { SEGMENTS } from './segments.js';

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const pct = (v, d = 1) => (v === null || v === undefined || !Number.isFinite(v) ? '—' : `${v > 0 ? '+' : ''}${v.toFixed(d)}%`);
const tone = (v) => (v < -0.05 ? 'down' : v > 0.05 ? 'up' : '');
const short = (d) => d.slice(5).replace('-', '/');

export const RANGES = [[12, '近 12 周'], [26, '近半年'], [53, '近 1 年']];
const KINDS = [['text', '文本 Token'], ['mm', '多模态']];
const METHODS = [['chain', '同款调价指数'], ['median', '在售价格中位数']];

export function groupColor(g) {
  if (g.kind === 'text') return SERIES_COLORS[SEGMENTS.findIndex((s) => s.id === g.id) % SERIES_COLORS.length];
  return MODALITIES.find((m) => m.id === g.id)?.color ?? 'var(--text-muted)';
}
const groupName = (g) => (g.kind === 'text' && g.id === 'multimodal' ? '多模态（按 Token 计费）' : g.name);
const liveFrom = (weekly, kind) => weekly.backfill?.[kind]?.until ?? null;
const firstIdx = (vals) => vals.findIndex((v) => v !== null);

// Change of a series over the visible range (first non-null to last), in percent.
function changeOver(vals, range) {
  const v = range ? vals.slice(-range) : vals;
  const a = v.find((x) => x !== null), b = v.findLast((x) => x !== null);
  return a && b ? (b / a - 1) * 100 : null;
}

// Why a group has no line for part of the year: shown, never hidden.
function gapNote(weekly, g) {
  const i = firstIdx(g.chain);
  if (i === -1) return g.kind === 'text' && g.id === 'open' ? '数据源未收录这一类，暂无数据' : '暂无数据';
  if (g.kind === 'mm' && g.id === '3d') return `人工估算，自 ${weekly.weeks[i]} 当周起记录`;
  if (i > 0) return `数据源无更早历史，自 ${weekly.weeks[i]} 当周起有数据`;
  return '';
}

function seg(id, options, current) {
  return `<div class="seg small" data-ctl="${id}" role="group">${options.map(([v, label]) => `<button type="button" data-v="${v}" aria-pressed="${String(v) === String(current)}">${esc(label)}</button>`).join('')}</div>`;
}

function eventLine(e, providerName) {
  const who = e.kind === 'mm' ? e.vendor : providerName(e.vendor);
  return `${who} ${e.name} ${pct(e.pct, 0)}${e.excluded ? '（潜在异常，未计入）' : ''}`;
}

function eventsByWeek(weekly, kind, providerName) {
  const m = new Map();
  for (const e of weekly.events) if (!kind || e.kind === kind) m.set(e.week, [...(m.get(e.week) ?? []), eventLine(e, providerName)]);
  return m;
}

// Plain-language summary of the last complete week, generated from the data every day.
function brief(weekly, macro, providerName) {
  const n = weekly.weeks.length;
  const lw = weekly.weeks[weekly.partialLast ? n - 2 : n - 1];
  const lwEnd = new Date(Date.parse(lw) + 6 * 864e5).toISOString().slice(0, 10);
  const li = weekly.weeks.indexOf(lw);
  const moves = weekly.events.filter((e) => e.week === lw).sort((a, b) => Math.abs(b.pct) - Math.abs(a.pct));
  const [lt, lm] = weekly.launches[li] ?? [0, 0];
  const items = [];
  items.push(moves.length
    ? `上周有 ${moves.length} 次调价：${moves.slice(0, 3).map((e) => `${esc(eventLine(e, providerName))}`).join('，')}${moves.length > 3 ? ' 等' : ''}。`
    : '上周没有已上线模型调价。');
  items.push(`上周新上线 ${lt} 个文本模型、${lm} 个多模态模型。`);
  const yr = (kind) => weekly.groups.filter((g) => g.kind === kind).map((g) => ({ g, c: changeOver(g.chain, 0) })).filter((x) => x.c !== null);
  const mmMoves = yr('mm').filter((x) => Math.abs(x.c) >= 1).sort((a, b) => a.c - b.c);
  const textMoves = yr('text').filter((x) => ['frontier', 'china'].includes(x.g.id));
  items.push(`过去一年同款价格：${mmMoves.map((x) => `${esc(x.g.name)} <span class="${tone(x.c)}">${pct(x.c, 0)}</span>`).join('，') || '多模态基本没变'}；文本 ${textMoves.map((x) => `${esc(groupName(x.g))} <span class="${tone(x.c)}">${pct(x.c, 0)}</span>`).join('，')}。文本变便宜主要靠新模型以更低价格上线。`);
  const usage = macro?.series.find((s) => s.id === 'usage-total')?.points ?? [];
  if (usage.length > 1) {
    const [a, b] = usage.slice(-2);
    const china = macro.series.find((s) => s.id === 'usage-china')?.points.at(-1);
    items.push(`OpenRouter ${esc(b.date)} 当周用量 ${(b.value / 1e12).toFixed(0)} 万亿 token，环比 <span class="${tone(b.value / a.value - 1)}">${pct((b.value / a.value - 1) * 100)}</span>${china && china.date === b.date ? `，中国模型占 ${((china.value / b.value) * 100).toFixed(1)}%` : ''}。`);
  }
  const cur = weekly.partialLast ? weekly.events.filter((e) => e.week === weekly.weeks[n - 1]) : [];
  if (cur.length) items.push(`本周至今已有 ${cur.length} 次调价：${cur.slice(0, 2).map((e) => esc(eventLine(e, providerName))).join('，')}。`);
  return `<section class="card brief"><h2>本周要点 <span class="unit">${short(lw)} 至 ${short(lwEnd)} · 每天自动更新</span></h2><ul>${items.map((t) => `<li>${t}</li>`).join('')}</ul></section>`;
}

function kpis(weekly, macro) {
  const g = (kind, id) => weekly.groups.find((x) => x.kind === kind && x.id === id);
  const c = (kind, id) => changeOver(g(kind, id)?.chain ?? [], 0);
  const four = weekly.launches.slice(-4).reduce((a, [t, m]) => [a[0] + t, a[1] + m], [0, 0]);
  const usage = macro?.series.find((s) => s.id === 'usage-total')?.points ?? [];
  const card = (h, v, sub, note) => `<article class="kpi"><h3>${h}</h3><p class="kpi-value">${v}</p><p class="kpi-sub">${sub}</p><p class="kpi-note">${note}</p></article>`;
  const list = (kind, ids) => ids.map((id) => `${esc(groupName(g(kind, id)))} <span class="${tone(c(kind, id))}">${pct(c(kind, id), 0)}</span>`).join(' · ');
  const front = g('text', 'frontier');
  return `<div class="kpi-grid">
    ${card('文本 Token 同款调价（近 1 年）', `<span class="${tone(c('text', 'frontier'))}">${pct(c('text', 'frontier'))}</span>`, `海外前沿闭源 · ${list('text', ['china', 'niche'])}`, '已上线文本模型自己的牌价变化，新模型不计入。')}
    ${card('多模态同款调价（近 1 年）', `<span class="${tone(c('mm', 'video'))}">${pct(c('mm', 'video'))}</span>`, `视频生成 · ${list('mm', ['stt', 'tts', 'image'])}`, '多模态是厂商直接给老产品降价。')}
    ${card('新上线模型（近 4 周）', `${four[0] + four[1]} 个`, `文本 ${four[0]} · 多模态 ${four[1]}`, `文本降价主要靠新品：海外前沿在售中位数 $${(front?.median.at(-1) ?? 0).toFixed(2)}/百万 token。`)}
    ${usage.length > 1 ? card('OpenRouter 周用量', `${(usage.at(-1).value / 1e12).toFixed(0)} 万亿`, `${esc(usage.at(-1).date)} 当周 · 环比 ${pct((usage.at(-1).value / usage.at(-2).value - 1) * 100)}`, '用量增速远快于降价速度。') : card('OpenRouter 周用量', '—', '等待用量数据', '')}
  </div>`;
}

function eventsList(weekly, providerName, kind) {
  const list = weekly.events.filter((e) => !kind || e.kind === kind);
  if (!list.length) return '<p class="empty">还没有记录到调价。</p>';
  const FLAG = { bulk: '同厂商同周多个模型改成同一价格', flipflop: '价格来回跳', magnitude: '单次变动 5 倍以上' };
  const groupLabel = (e) => (e.kind === 'mm' ? MODALITIES.find((m) => m.id === e.group)?.name : SEGMENTS.find((s) => s.id === e.group)?.name) ?? '';
  const priceText = (e) => (e.kind === 'mm' ? `标准成品价 $${e.before} → $${e.after}` : `输入/输出 $${e.before.input}/$${e.before.output} → $${e.after.input}/$${e.after.output}`);
  return `<ul class="events">${list.map((e) => `<li><time>${esc(e.announced ?? e.date)}</time><b>${esc(e.kind === 'mm' ? e.vendor : providerName(e.vendor))}</b> ${esc(e.name)} <span class="${tone(e.pct)}">${pct(e.pct, 0)}</span>` +
    `${e.flags.length && e.status !== 'confirmed' ? `<span class="tag anomaly" title="${esc(e.flags.map((f) => FLAG[f]).join('、'))}">潜在异常</span>` : ''}${e.backfill ? '<span class="tag bf">回溯</span>' : ''}` +
    `<span class="ev-sub">${esc(groupLabel(e))} · ${esc(priceText(e))} · ${e.announced ? '厂商公告日期' : '数据源更新日期，待补公告日期'}${e.link ? ` · <a href="${esc(e.link)}" rel="noopener">价格页</a>` : ''}</span></li>`).join('')}</ul>`;
}

const RANGE_WEEKS = (r) => Number(r) || 0;

export function renderHome(el, { weekly, macro, view, onView, providerName, chainCards }) {
  if (!weekly) { el.innerHTML = '<p class="empty">周度数据还没有生成，下一次每日抓取后会出现。</p>'; return; }
  const kind = view.kind ?? 'text';
  const range = RANGE_WEEKS(view.range);
  const groups = weekly.groups.filter((g) => g.kind === kind);
  const series = groups.map((g) => ({ name: groupName(g), color: groupColor(g), values: g.chain, wow: g.wow }));
  const notes = groups.map((g) => [g, gapNote(weekly, g)]).filter(([, n]) => n);
  const rows = weekly.groups.map((g) => ({ name: groupName(g), wow: g.wow, note: gapNote(weekly, g) && firstIdx(g.chain) === -1 ? '暂无数据' : '' }));
  el.innerHTML = `
    ${brief(weekly, macro, providerName)}
    ${kpis(weekly, macro)}
    <section class="card">
      <div class="toolbar"><h2>一年价格指数，每周一个点</h2><div class="ctrls">${seg('kind', KINDS, kind)}${seg('range', RANGES, view.range ?? 0)}</div></div>
      <p class="kpi-note">同款调价指数：只比较同一个模型前后两周的价格，起点 = 100，新模型上线不会让曲线跳动。浅蓝底色是从数据源历史版本回溯的部分。鼠标移到（手机上点）任何一周，可以看到当周数值和当周调价。</p>
      ${weeklyChart(weekly.weeks, series, { range, liveFrom: liveFrom(weekly, kind), events: eventsByWeek(weekly, kind, providerName), partialLast: weekly.partialLast, baseline: 100 })}
      ${notes.length ? `<p class="source">${notes.map(([g, n]) => `${esc(groupName(g))}：${esc(n)}`).join('；')}。</p>` : ''}
    </section>
    <div class="two-col">
      <section class="card"><h2>每周涨跌一览</h2><p class="kpi-note">一格是一周。绿色是当周降价，橙红是涨价，灰色是没变，最浅的是还没有数据。把鼠标停在格子上看具体数值。</p>
        ${weekHeatmap(weekly.weeks, rows, { range, liveFrom: liveFrom(weekly, 'text') })}</section>
      <section class="card"><h2>调价大事记</h2><p class="kpi-note">「潜在异常」是疑似数据源录入错误，复核前不计入指数；「回溯」来自数据源历史版本。日期默认是数据源更新日，复核后改为厂商公告日。</p>
        ${eventsList(weekly, providerName)}</section>
    </div>
    ${chainCards ? `<h2 class="section-title">产业链速览 <span class="unit"><a href="#chain">看全部 →</a></span></h2>${chainCards}` : ''}`;
  bindWeekly(el);
  bindSegs(el, onView);
}

export function renderTrend(el, { weekly, view, onView, money, providerName, buySection }) {
  if (!weekly) { el.innerHTML = '<p class="empty">周度数据还没有生成，下一次每日抓取后会出现。</p>'; return; }
  const method = view.method ?? 'chain';
  const range = RANGE_WEEKS(view.range);
  const mini = (g) => {
    const vals = method === 'chain' ? g.chain : g.median;
    const ch = changeOver(vals, range);
    const last = vals.findLast((v) => v !== null);
    const note = gapNote(weekly, g);
    const events = eventsByWeek({ ...weekly, events: weekly.events.filter((e) => e.kind === g.kind && e.group === g.id) }, g.kind, providerName);
    return `<article class="mini"><h3><i class="dot" style="background:${groupColor(g)}"></i>${esc(groupName(g))}</h3>
      <p class="kpi-sub">${last === undefined || last === null ? '—' : method === 'chain' ? last.toFixed(1) : money(last)} · ${RANGES.find(([r]) => r === range)?.[1] ?? ''} <span class="${tone(ch)}">${pct(ch)}</span> · ${g.count.at(-1)} 个模型</p>
      ${weeklyChart(weekly.weeks, [{ name: groupName(g), color: groupColor(g), values: vals, wow: method === 'chain' ? g.wow : null }],
        { range, small: true, width: 340, height: 150, liveFrom: liveFrom(weekly, g.kind), events, partialLast: weekly.partialLast, format: method === 'chain' ? (v) => v.toFixed(0) : (v) => money(v), tipFormat: method !== 'chain', baseline: method === 'chain' ? 100 : null })}
      ${note ? `<p class="source">${esc(note)}</p>` : ''}</article>`;
  };
  const block = (kind, title, lead) => `<section class="card"><h2>${title}</h2><p class="kpi-note">${lead}</p><div class="mini-grid">${weekly.groups.filter((g) => g.kind === kind).map(mini).join('')}</div></section>`;
  el.innerHTML = `
    <div class="toolbar card"><div><h2>价格走势，每周一个点</h2>
      <p class="kpi-note">${method === 'chain'
        ? '同款调价指数：只看同一个模型前后两周有没有调价，起点 = 100。回答「厂商有没有主动降价」。'
        : '在售价格中位数：当周所有在售模型价格的中位数（文本为每百万 token 混合价，输入:输出 = 3:1；多模态为一件标准成品的价格）。会因为新模型上线、旧模型下架而跳动，回答「市场上一般要花多少钱」。'}</p></div>
      <div class="ctrls">${seg('method', METHODS, method)}${seg('range', RANGES, view.range ?? 0)}</div></div>
    ${block('text', '文本 Token', '按模型类型分组。')}
    ${block('mm', '多模态', '每种模态按一件标准成品计价：5 秒 720p 视频、一张 1K 图片、1 分钟语音、1 小时转写、一首歌、一个 3D 模型。')}
    ${buySection ?? ''}
    <section class="card"><h2>调价大事记</h2>${eventsList(weekly, providerName)}</section>`;
  bindWeekly(el, money);
  bindSegs(el, onView);
}

function bindSegs(el, onView) {
  for (const s of el.querySelectorAll('[data-ctl]')) {
    s.addEventListener('click', (e) => {
      const b = e.target.closest('button[data-v]');
      if (b) onView(s.dataset.ctl, b.dataset.v);
    });
  }
}
