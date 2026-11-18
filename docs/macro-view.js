// Overview and macro tabs. Macro figures stay in USD; token prices follow the currency toggle.
import { SERIES_COLORS, barChart, bindHover, bindWeekly, legend, sparkline, weeklyChart } from './charts.js';

// One color per segment on every chart, in segment order.
const segColor = (macro, id) => SERIES_COLORS[macro.segments.findIndex((s) => s.id === id) % SERIES_COLORS.length];
import { stripDate } from './segments.js';

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

// 1e8 = 亿, the unit Chinese finance readers expect for company-scale figures.
export function usdBig(v) {
  if (v === null || v === undefined) return '—';
  const yi = v / 1e8;
  return `$${yi >= 100 ? Math.round(yi).toLocaleString('en-US') : yi.toFixed(1)}亿`;
}
const pct = (v) => (v === null || !Number.isFinite(v) ? '—' : `${v >= 0 ? '+' : ''}${(v * 100).toFixed(1)}%`);
const pp = (v) => (v === null || !Number.isFinite(v) ? '—' : `${v >= 0 ? '+' : ''}${(v * 100).toFixed(1)} 个百分点`);
// Token counts in Chinese units: 万亿 (1e12) and 亿 (1e8).
export function tokensBig(v) {
  if (v === null || v === undefined || !Number.isFinite(v)) return '—';
  if (v >= 1e12) return `${(v / 1e12).toFixed(v >= 1e14 ? 0 : 1)} 万亿`;
  if (v >= 1e8) return `${(v / 1e8).toFixed(0)} 亿`;
  return v.toLocaleString('en-US');
}
const usd = (v) => `$${v >= 100 ? v.toFixed(0) : v.toFixed(2)}`;

const byId = (macro, id) => macro.series.find((s) => s.id === id);

// Same quarter a year earlier: four quarters back for 2025Q3 labels, ±20 days for dates.
function yoy(points) {
  const last = points.at(-1);
  if (!last) return null;
  let prev;
  if (/^\d{4}Q\d$/.test(last.date)) {
    prev = points.find((p) => p.date === `${+last.date.slice(0, 4) - 1}${last.date.slice(4)}`);
  } else {
    const target = Date.parse(last.date) - 365 * 864e5;
    prev = points.find((p) => Math.abs(Date.parse(p.date) - target) <= 20 * 864e5);
  }
  return prev && prev.value ? last.value / prev.value - 1 : null;
}

// Change since the first point on or after `days` ago (or since the series starts).
function changeOver(points, days) {
  const last = points.at(-1);
  if (!last) return null;
  const cutoff = Date.parse(last.date) - days * 864e5;
  const base = points.find((p) => Date.parse(p.date) >= cutoff);
  return base && base.value ? { change: last.value / base.value - 1, since: base.date } : null;
}

function card({ freq, title, value, sub, spark = '', note, missing }) {
  return `<article class="kpi">
    <h3>${esc(title)}<span class="tag">${esc(freq)}</span></h3>
    ${missing
      ? `<p class="kpi-missing">${esc(missing)}</p>`
      : `<p class="kpi-value">${value}</p><p class="kpi-sub">${sub}</p>${spark}`}
    <p class="kpi-note">${esc(note)}</p>
  </article>`;
}

const SEC_MISSING = '等待财报数据（需在仓库 Secrets 配置 SEC_CONTACT_EMAIL）';
const STOCK_MISSING = '等待行情数据（需在仓库 Secrets 配置 ALPHAVANTAGE_API_KEY）';
const USAGE_MISSING = '等待用量数据（需在仓库 Secrets 配置 OPENROUTER_API_KEY）';

// Share of a segment in the total for each week both report.
function shareSeries(macro, segId) {
  const total = new Map((byId(macro, 'usage-total')?.points ?? []).map((p) => [p.date, p.value]));
  return (byId(macro, `usage-${segId}`)?.points ?? []).filter((p) => total.get(p.date))
    .map((p) => ({ date: p.date, value: p.value / total.get(p.date) }));
}

// Weekly points of several series aligned on Monday dates, oldest first.
const monday = (d) => { const t = Date.parse(d); return new Date(t - ((new Date(t).getUTCDay() + 6) % 7) * 864e5).toISOString().slice(0, 10); };
export function alignWeekly(list) {
  const weeks = [...new Set(list.flatMap((s) => s.points.map((p) => monday(p.date))))].sort();
  return { weeks, series: list.map((s) => {
    const m = new Map(s.points.map((p) => [monday(p.date), p.value]));
    return { ...s, values: weeks.map((w) => m.get(w) ?? null) };
  }) };
}

// The slower industry-chain cards shown at the bottom of the overview.
export function chainCards(macro) {
  const capex = byId(macro, 'capex-total')?.points ?? [];
  const nvda = byId(macro, 'revenue-nvda')?.points ?? [];
  const capexYoy = yoy(capex);
  const nvdaYoy = yoy(nvda);
  const stocks = macro.series.filter((s) => s.group === 'stocks' && s.points.length);
  return `<div class="kpi-grid">
      ${card({ freq: '每周',
        title: '产业链股价（近 3 个月）', note: '和基本面对照，判断预期是否过热。',
        missing: stocks.length ? null : STOCK_MISSING,
        value: '',
        sub: stocks.map((s) => `${esc(s.name.replace(/股价$/, ''))} ${pct(changeOver(s.points, 91)?.change ?? null)}`).join('<br>'),
      })}
      ${card({ freq: '每季度',
        title: '英伟达季度营收', note: '算力供给的景气度。',
        missing: nvda.length ? null : SEC_MISSING,
        value: nvda.length ? usdBig(nvda.at(-1).value) : '',
        sub: nvda.length ? `截至 ${esc(nvda.at(-1).date)} · 同比 ${pct(nvdaYoy)}` : '',
        spark: sparkline(nvda, { color: SERIES_COLORS[1] }),
      })}
      ${card({ freq: '每季度',
        title: '云厂商资本开支', note: '五大云厂商合计。增速放缓是上游持仓的首要预警。',
        missing: capex.length ? null : SEC_MISSING,
        value: capex.length ? usdBig(capex.at(-1).value) : '',
        sub: capex.length ? `${esc(capex.at(-1).date)} · 同比 ${pct(capexYoy)}` : '',
        spark: sparkline(capex),
      })}
      ${card({ freq: '每季度',
        title: '投入与供给的背离', note: '资本开支增速减英伟达营收增速。拉开说明钱流向了其他环节，或需求在放缓。',
        missing: capexYoy !== null && nvdaYoy !== null ? null : SEC_MISSING,
        value: pp(capexYoy - nvdaYoy),
        sub: `资本开支 ${pct(capexYoy)} vs 英伟达 ${pct(nvdaYoy)}`,
      })}
    </div>`;
}

// Bands ordered from fastest-moving data to slowest, so the top of the page is what changes daily.
const BANDS = [
  { id: 'fast', name: '每日 / 每周', blurb: '股价、Token 价格和用量，变化最快，适合日常跟踪。' },
  { id: 'month', name: '每月', blurb: '各类模型的调价节奏，看价格战是否在加剧。' },
  { id: 'quarter', name: '每季度', blurb: '财报里的基本面，变化慢，但决定产业的长期方向。' },
  { id: 'disclosed', name: '不定期：厂商公布', blurb: '厂商在发布会、财报里公布的调用量，口径各不相同，适合看量级和增速。' },
];
const FREQ_NAME = { day: '每日', week: '每周', month: '每月', quarter: '每季度', irregular: '不定期' };

// Small label naming the value-chain layer and update frequency of a card.
function chips(macro, layerId, freq) {
  const layer = macro.layers.find((l) => l.id === layerId);
  return `<p class="chips"><span class="chip">${esc(layer?.name ?? layerId)}</span><span class="chip">${esc(FREQ_NAME[freq] ?? freq)}更新</span></p>`;
}

function seriesCard(macro, s, body) {
  return `<article class="card macro-card">
    ${chips(macro, s.layer, s.freq)}
    <h3>${esc(s.name)}${s.stale ? ' <span class="tag">数据未更新</span>' : ''}</h3>
    ${s.note ? `<p class="kpi-note">${esc(s.note)}</p>` : ''}
    ${body}
    <p class="source">来源：${s.sourceUrl ? `<a href="${esc(s.sourceUrl)}" rel="noopener">${esc(s.source)}</a>` : esc(s.source)}</p>
  </article>`;
}

function movesTable(macro) {
  const rows = macro.segments.map((seg) => {
    const pts = byId(macro, `token-moves-${seg.id}`)?.points ?? [];
    const cuts = pts.reduce((a, p) => a + p.cuts, 0);
    const hikes = pts.reduce((a, p) => a + p.hikes, 0);
    return `<tr><td>${esc(seg.name)}</td><td class="num down">${cuts}</td><td class="num up">${hikes}</td></tr>`;
  }).join('');
  return `<div class="table-scroll"><table><thead><tr><th>分类</th><th class="num">降价</th><th class="num">涨价</th></tr></thead><tbody>${rows}</tbody></table></div>`;
}

function fastBand(macro, { weekly, range }) {
  const stocks = macro.series.filter((s) => s.group === 'stocks');
  // Rebase each stock to 100 at its first point so different price levels share one axis.
  const stockLines = stocks.filter((s) => s.points.length).map((s, i) => ({ name: s.name.replace(/股价$/, ''), color: SERIES_COLORS[i % SERIES_COLORS.length],
    points: s.points.map((p) => ({ date: p.date, value: (p.value / s.points[0].value) * 100 })) }));
  const st = alignWeekly(stockLines);
  return `<div class="macro-grid">
    <article class="card macro-card wide">
      ${chips(macro, 'markets', 'week')}
      <h3>产业链股价走势（起点 = 100）</h3>
      ${stockLines.length ? legend(stockLines) + weeklyChart(st.weeks, st.series, { range, baseline: 100 }) : `<p class="kpi-missing">${esc(STOCK_MISSING)}</p>`}
      <p class="source">来源：<a href="https://www.alphavantage.co/" rel="noopener">Alpha Vantage</a> 周收盘价。模型公司收入和估值第二版加入。</p>
    </article>
    ${priceVsUsage(macro, weekly, range)}
    ${usageCards(macro, range)}
  </div>`;
}

// Did cheaper tokens bring more usage? Usage and the text price index on the same weeks, each rebased to 100.
function priceVsUsage(macro, weekly, range) {
  const usage = byId(macro, 'usage-total')?.points ?? [];
  if (!weekly || usage.length < 2) return '';
  const idx = new Map(weekly.weeks.map((w, i) => [w, i]));
  const weeks = usage.map((p) => monday(p.date)).filter((w) => idx.has(w));
  const from = range && weeks.length > range ? weeks.length - range : 0;
  const ws = weeks.slice(from);
  const base = (vals) => { const b = vals.find((v) => v); return vals.map((v) => (v && b ? (v / b) * 100 : null)); };
  const u = new Map(usage.map((p) => [monday(p.date), p.value]));
  const text = weekly.groups.filter((g) => g.kind === 'text' && ['frontier', 'china'].includes(g.id));
  const priceSeries = text.map((g, i) => ({ name: `${g.name}（在售中位数）`, color: SERIES_COLORS[i === 0 ? 0 : 1], values: base(ws.map((w) => g.median[idx.get(w)])) }));
  const usageSeries = [{ name: 'OpenRouter 周用量', color: SERIES_COLORS[2], values: base(ws.map((w) => u.get(w) ?? null)) }];
  const last = (s) => s.values.findLast((v) => v !== null);
  return `<article class="card macro-card wide">
      ${chips(macro, 'demand', 'week')}
      <h3>价格 × 用量：降价有没有带来用量</h3>
      <p class="kpi-note">同样的周，起点都记为 100。到最近一周，用量是起点的 ${(last(usageSeries[0]) / 100).toFixed(1)} 倍；在售价格中位数${priceSeries.map((p) => `${esc(p.name.replace('（在售中位数）', ''))}是起点的 ${(last(p) / 100).toFixed(2)} 倍`).join('，')}。价格用在售中位数，因为用户实际买的是当时在售的模型；在售价上涨多半是更贵的新一代模型上线，用量仍在增长说明用户愿意为更强的模型付费。</p>
      ${legend([...usageSeries, ...priceSeries].map((s) => ({ ...s, points: [1] })))}
      ${weeklyChart(ws, usageSeries, { height: 180, format: (v) => v.toFixed(0) })}
      ${weeklyChart(ws, priceSeries, { height: 160, format: (v) => v.toFixed(0), baseline: 100 })}
    </article>`;
}

function usageCards(macro, range) {
  const total = byId(macro, 'usage-total');
  const cite = `来源：<a href="https://openrouter.ai/rankings" rel="noopener">OpenRouter</a>${macro.usageTop?.asOf ? `，截至 ${esc(macro.usageTop.asOf.slice(0, 10))}` : ''}。Licensed under CC BY 4.0。各厂商分词方式不同，Token 数不完全可比。`;
  if (!total?.points.length) {
    return `<article class="card macro-card wide">${chips(macro, 'demand', 'week')}<h3>OpenRouter 每周 Token 用量</h3><p class="kpi-missing">${esc(USAGE_MISSING)}</p></article>`;
  }
  const shares = macro.segments.map((seg) => ({ name: seg.name, color: segColor(macro, seg.id), points: shareSeries(macro, seg.id) }));
  const top = macro.usageTop?.rows ?? [];
  const segName = (id) => macro.segments.find((x) => x.id === id)?.name ?? '';
  return `<article class="card macro-card wide">
      ${chips(macro, 'demand', 'week')}
      <h3>OpenRouter 每周 Token 用量</h3>
      <p class="kpi-note">${esc(total.note)}</p>
      ${barChart(range ? total.points.slice(-range) : total.points, { format: tokensBig, color: SERIES_COLORS[2], width: 760 })}
      <p class="source">${cite}</p>
    </article>
    <article class="card macro-card wide">
      ${chips(macro, 'demand', 'week')}
      <h3>各类模型用量占比</h3>
      <p class="kpi-note">只统计前 50 名模型，其余计入总量但不分类。</p>
      ${(() => { const a = alignWeekly(shares.filter((x) => x.points.length)); return weeklyChart(a.weeks, a.series.map((x) => ({ ...x, values: x.values.map((v) => (v === null ? null : v * 100)) })), { range, format: (v) => `${Math.round(v)}%` }); })()}
    </article>
    ${top.length ? `<article class="card macro-card wide">
      ${chips(macro, 'demand', 'week')}
      <h3>用量前 10 的模型（${esc(macro.usageTop.week)} 当周）</h3>
      <div class="table-scroll"><table><thead><tr><th>#</th><th>模型</th><th>分类</th><th class="num">周用量</th></tr></thead><tbody>
      ${top.map((r, i) => `<tr><td>${i + 1}</td><td>${esc(stripDate(r.slug))}</td><td>${esc(segName(r.segment))}</td><td class="num">${tokensBig(r.tokens)}</td></tr>`).join('')}
      </tbody></table></div>
    </article>` : ''}`;
}

function disclosedBand(macro, disclosed) {
  if (!disclosed?.vendors?.length) return '<p class="empty">暂无数据。</p>';
  const rows = disclosed.vendors.map((v) => {
    const [first, last] = [v.points[0], v.points.at(-1)];
    const months = (Date.parse(`${last.date}-01`) - Date.parse(`${first.date}-01`)) / (30.44 * 864e5);
    const growth = last.perDay / first.perDay;
    const link = (p) => `<a href="${esc(p.source)}" rel="noopener">${esc(p.date)}</a>`;
    return `<tr><td><b>${esc(v.vendor)}</b><div class="group-driver">${esc(v.scope)}</div></td>
      <td>${link(first)}：${esc(first.stated)}</td><td>${link(last)}：${esc(last.stated)}</td>
      <td class="num">${tokensBig(last.perDay)}</td><td class="num">${growth.toFixed(1)} 倍 / ${Math.round(months)} 个月</td></tr>`;
  }).join('');
  return `<div class="macro-grid"><article class="card macro-card wide">
    ${chips(macro, 'demand', 'irregular')}
    <h3>厂商公布的调用量</h3>
    <div class="table-scroll"><table><thead><tr><th>厂商与口径</th><th>早期</th><th>最新</th><th class="num">折合日均</th><th class="num">增长</th></tr></thead><tbody>${rows}</tbody></table></div>
    <p class="source">点日期可查看原始出处。各家口径不同（谷歌含搜索等全部产品，OpenAI 仅 API），横向比较只看量级。人工整理，有新数字公布时更新。</p>
  </article></div>`;
}

function monthBand(macro) {
  return `<div class="macro-grid"><article class="card macro-card wide">
    ${chips(macro, 'tokens', 'month')}
    <h3>调价次数（自开始记录以来）</h3>
    ${movesTable(macro)}
    <ul class="drivers">${macro.segments.map((seg) => `<li><b>${esc(seg.name)}</b>：${esc(seg.driver)}</li>`).join('')}</ul>
  </article></div>`;
}

function quarterBand(macro) {
  // Upstream first within the band: capex (the bet), then chip revenue (who it is paid to).
  const list = ['capex', 'compute'].flatMap((id) => macro.series.filter((s) => s.layer === id && s.freq === 'quarter'));
  return `<div class="macro-grid">${list.map((s) => seriesCard(macro, s,
    s.points.length ? barChart(s.points, { format: usdBig, color: s.id === 'capex-total' ? SERIES_COLORS[0] : SERIES_COLORS[1] }) : `<p class="kpi-missing">${esc(SEC_MISSING)}</p>`)).join('')}</div>`;
}

export function renderMacro(el, { macro, money, disclosed, weekly, range, rangeCtl }) {
  const bodies = { fast: fastBand(macro, { weekly, range }), month: monthBand(macro), quarter: quarterBand(macro), disclosed: disclosedBand(macro, disclosed) };
  const sections = BANDS.map((b) =>
    `<section class="layer"><h2>${esc(b.name)}</h2><p class="kpi-note">${esc(b.blurb)}</p>${bodies[b.id]}</section>`).join('');
  el.innerHTML = `<div class="toolbar"><p class="lead">按数据变化的快慢排列：越往上更新越频繁。每张卡片标出它属于产业链的哪一环。Token 价格的走势统一放在「价格走势」页。数据更新于 ${esc(new Date(macro.updatedAt).toLocaleString('zh-CN', { hour12: false }))}。</p>${rangeCtl ?? ''}</div>
    ${sections}
    <section class="layer"><h2>第二版加入</h2><p class="empty">模型公司收入和估值，需要人工录入。</p></section>`;
  bindHover(el, money);
  bindWeekly(el, money);
}
