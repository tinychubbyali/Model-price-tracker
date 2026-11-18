// Overview and macro tabs. Macro figures stay in USD; token prices follow the currency toggle.
import { SERIES_COLORS, barChart, bindHover, legend, lineChart, sparkline } from './charts.js';

// One color per segment on every chart, in segment order.
const segColor = (macro, id) => SERIES_COLORS[macro.segments.findIndex((s) => s.id === id) % SERIES_COLORS.length];
import { segmentOf, stripDate } from './segments.js';

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

// The headline chart: daily token price medians by segment, with every price event marked,
// and a panel naming the most recent day's changes.
function dailyHero(macro, { money, changes, models }) {
  const lines = macro.segments.map((seg) => ({ id: seg.id, name: seg.name, color: segColor(macro, seg.id), points: byId(macro, `token-index-${seg.id}`)?.points ?? [] }));
  const live = lines.filter((l) => l.points.length);
  if (!live.length) return '';
  const blended = (h) => (h.input * 3 + h.output) / 4;
  const kindOf = (c) => (c.type === 'changed' ? (blended(c.after) < blended(c.before) ? 'down' : blended(c.after) > blended(c.before) ? 'up' : 'new') : 'new');
  const name = (c) => c.id.split('/').slice(1).join('/');
  const TYPE = { added: '新上线', removed: '下架', restored: '重新上架' };
  const describe = (c) => {
    const k = kindOf(c);
    if (c.type === 'changed') {
      const pctChange = blended(c.after) / blended(c.before) - 1;
      if (k === 'new') return '缓存价调整';
      return `<span class="${k}">${k === 'down' ? '降价' : '涨价'} ${pct(pctChange)}</span>`;
    }
    return esc(TYPE[c.type] ?? c.type);
  };
  const events = (changes ?? []).map((c) => ({ date: c.date, kind: kindOf(c), label: `${c.date} ${name(c)}` }));
  const lastDate = changes?.[0]?.date;
  const latest = (changes ?? []).filter((c) => c.date === lastDate);
  const segName = (id) => macro.segments.find((s) => s.id === id)?.name ?? '';
  // Usage columns appear once OpenRouter data exists; then every segment gets a row, priced or not.
  const total = byId(macro, 'usage-total')?.points ?? [];
  const hasUsage = total.length > 1;
  const wow = (pts) => (pts.length > 1 && pts.at(-2).value ? pts.at(-1).value / pts.at(-2).value - 1 : null);
  const tone = (v) => (v < 0 ? 'down' : v > 0 ? 'up' : '');
  const shown = hasUsage ? lines.filter((l) => l.points.length || byId(macro, `usage-${l.id}`)?.points.length) : live;
  const usageOf = (l) => {
    const pts = byId(macro, `usage-${l.id}`)?.points ?? [];
    const share = shareSeries(macro, l.id).at(-1)?.value ?? null;
    return { share, growth: wow(pts) };
  };
  const rows = shown.map((l) => {
    const last = l.points.at(-1);
    const w = l.points.length ? changeOver(l.points, 7) : null;
    const u = hasUsage ? usageOf(l) : null;
    return `<tr><td><i class="dot" style="background:${l.color}"></i>${esc(l.name)}</td>` +
      `<td class="num">${last ? money(last.value) : '—'}</td>` +
      `<td class="num ${tone(w?.change)}">${pct(w?.change ?? null)}</td>` +
      (u ? `<td class="num">${u.share === null ? '—' : `${(u.share * 100).toFixed(1)}%`}</td><td class="num">${pct(u.growth)}</td>` : '') +
      '</tr>';
  }).join('');
  // One sentence of takeaways from the usage data.
  let usageNote = '';
  if (hasUsage) {
    const ranked = shown.map((l) => ({ l, g: usageOf(l).growth })).filter((x) => x.g !== null).sort((a, b) => b.g - a.g);
    const fastest = ranked[0];
    usageNote = `<p class="kpi-note hero-usage">OpenRouter 本周（${esc(total.at(-1).date)}）总用量 ${tokensBig(total.at(-1).value)}，环比 ${pct(wow(total))}` +
      (fastest ? `；${fastest.g >= 0 ? '增长最快' : '降幅最小'}的是${esc(fastest.l.name)}（${pct(fastest.g)}）` : '') + '。用量是 OpenRouter 公开流量，价格是本站牌价。</p>';
  }
  const head = `<tr><th>类型</th><th class="num">价格</th><th class="num">近 7 天</th>${hasUsage ? '<th class="num">用量占比</th><th class="num">用量周环比</th>' : ''}</tr>`;
  return `<article class="card hero">
    <div class="hero-head">
      <div>
        <p class="chips"><span class="chip">模型层（Token）</span><span class="chip">每日更新</span></p>
        <h2>Token 价格中位数，按模型类型</h2>
        <p class="kpi-note">混合价格（输入:输出 = 3:1），每百万 tokens。中位数也会因新模型上线而变动，不全是调价。底部圆点是每一次价格事件：<span class="down">绿色降价</span>、<span class="up">红色涨价</span>、灰色上新或下架。</p>
      </div>
    </div>
    <div class="hero-body${hasUsage ? ' wide-side' : ''}">
      <div class="hero-chart">${lineChart(live, { format: money, step: true, width: 760, height: 260, money: true, events, endLabels: true })}</div>
      <aside class="hero-side">
        <table class="hero-table"><thead>${head}</thead><tbody>${rows}</tbody></table>${usageNote}
        ${lastDate ? `<h3>最新变化 · ${esc(lastDate)}</h3>
        <ul class="hero-changes">${latest.slice(0, 6).map((c) => `<li><a href="#${esc(c.id)}">${esc(name(c))}</a> <span class="tag">${esc(segName(models?.[c.id] ? segmentOf(models[c.id]) : ''))}</span> ${describe(c)}</li>`).join('')}</ul>
        ${latest.length > 6 ? `<p class="kpi-note">当天另有 ${latest.length - 6} 条，见 <a href="#prices">Token 价格</a>。</p>` : ''}` : ''}
      </aside>
    </div>
  </article>`;
}

export function renderOverview(el, { macro, money, changes, models }) {
  const capex = byId(macro, 'capex-total')?.points ?? [];
  const nvda = byId(macro, 'revenue-nvda')?.points ?? [];
  const capexYoy = yoy(capex);
  const nvdaYoy = yoy(nvda);
  const month = new Date().toISOString().slice(0, 7);
  const moves = macro.series.filter((s) => s.kind === 'moves')
    .map((s) => s.points.find((p) => p.date === month) ?? { cuts: 0, hikes: 0 })
    .reduce((a, p) => ({ cuts: a.cuts + p.cuts, hikes: a.hikes + p.hikes }), { cuts: 0, hikes: 0 });
  const stocks = macro.series.filter((s) => s.group === 'stocks' && s.points.length);
  const usage = byId(macro, 'usage-total')?.points ?? [];
  const since = Date.now() - 30 * 864e5;
  const launches = (changes ?? []).filter((c) => c.type === 'added' && Date.parse(c.date) >= since);
  const launchBySeg = macro.segments.map((seg) => [seg.name, launches.filter((c) => models?.[c.id] && segmentOf(models[c.id]) === seg.id).length])
    .filter(([, n]) => n).map(([n, k]) => `${esc(n)} ${k}`).join(' · ');
  const chinaShare = shareSeries(macro, 'china');

  el.innerHTML = `
    <p class="lead">最上面是每天更新的 Token 价格和最新调价；下面的卡片按变化快慢排列，先是每周的股价和用量，再是每月、每季度的调价节奏和财报基本面。</p>
    ${dailyHero(macro, { money, changes, models })}
    <div class="kpi-grid">
      ${card({ freq: '每周',
        title: '产业链股价（近 3 个月）', note: '和上面的基本面对照，判断预期是否过热。',
        missing: stocks.length ? null : STOCK_MISSING,
        value: '',
        sub: stocks.map((s) => `${esc(s.name.replace(/股价$/, ''))} ${pct(changeOver(s.points, 91)?.change ?? null)}`).join('<br>'),
      })}
      ${card({ freq: '每日',
        title: '新模型上线（近 30 天）', note: '上新越密集，说明模型层竞争越激烈，旧模型的定价压力越大。',
        value: `${launches.length} 个`,
        sub: launchBySeg || '近 30 天没有新模型',
      })}
      ${card({ freq: '每周',
        title: 'OpenRouter 周用量', note: '开发者侧的真实需求。用量增速快于降价速度，说明需求弹性在兑现。',
        missing: usage.length ? null : USAGE_MISSING,
        value: usage.length ? `${tokensBig(usage.at(-1).value)}` : '',
        sub: usage.length ? `${esc(usage.at(-1).date)} 当周 · 环比 ${pct(usage.length > 1 ? usage.at(-1).value / usage.at(-2).value - 1 : null)} · 同比 ${pct(yoy(usage))}` : '',
        spark: sparkline(usage, { color: SERIES_COLORS[2] }),
      })}
      ${card({ freq: '每周',
        title: '中国模型用量占比', note: 'OpenRouter 上中国模型占总用量的比例，看国产模型在海外开发者中的渗透。',
        missing: chinaShare.length ? null : USAGE_MISSING,
        value: chinaShare.length ? pct(chinaShare.at(-1).value).replace('+', '') : '',
        sub: chinaShare.length > 4 ? `较 4 周前 ${pp(chinaShare.at(-1).value - chinaShare.at(-5).value)}` : '',
        spark: sparkline(chinaShare, { color: SERIES_COLORS[1] }),
      })}
      ${card({ freq: '每月',
        title: '价格战强度', note: '降价密集对模型层是压力，对下游应用是利好。',
        value: `<span class="down">降价 ${moves.cuts}</span> · <span class="up">涨价 ${moves.hikes}</span>`,
        sub: `${esc(month)} 本月，所有分类合计`,
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
  bindHover(el, money);
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
  return `<table><thead><tr><th>分类</th><th class="num">降价</th><th class="num">涨价</th></tr></thead><tbody>${rows}</tbody></table>`;
}

function fastBand(macro, moneyAxis) {
  const stocks = macro.series.filter((s) => s.group === 'stocks');
  // Rebase each stock to 100 at its first point so different price levels share one axis.
  const stockLines = stocks.map((s) => ({ name: s.name.replace(/股价$/, ''),
    points: s.points.map((p) => ({ date: p.date, value: (p.value / s.points[0].value) * 100 })) }));
  const tokenLines = macro.segments.map((seg) => ({
    name: seg.name, color: segColor(macro, seg.id), points: byId(macro, `token-index-${seg.id}`)?.points ?? [] }));
  const empty = tokenLines.filter((x) => !x.points.length).map((x) => x.name);
  return `<div class="macro-grid">
    <article class="card macro-card wide">
      ${chips(macro, 'markets', 'week')}
      <h3>产业链股价走势（起点 = 100）</h3>
      ${stocks.some((s) => s.points.length) ? legend(stockLines) + lineChart(stockLines, { format: (v) => v.toFixed(0), width: 760 }) : `<p class="kpi-missing">${esc(STOCK_MISSING)}</p>`}
      <p class="source">来源：<a href="https://www.alphavantage.co/" rel="noopener">Alpha Vantage</a> 周收盘价。模型公司收入和估值第二版加入。</p>
    </article>
    <article class="card macro-card wide">
      ${chips(macro, 'tokens', 'day')}
      <h3>各类模型 Token 价格中位数</h3>
      <p class="kpi-note">混合价格（输入:输出 = 3:1），每百万 tokens。${empty.length ? `${esc(empty.join('、'))}暂无数据，需要扩展收录范围。` : ''}</p>
      ${legend(tokenLines)}${lineChart(tokenLines, { format: moneyAxis, step: true, width: 760, money: true, endLabels: true })}
      <p class="source">来源：本站价格数据</p>
    </article>
    ${usageCards(macro)}
  </div>`;
}

function usageCards(macro) {
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
      ${barChart(total.points, { format: tokensBig, color: SERIES_COLORS[2], width: 760 })}
      <p class="source">${cite}</p>
    </article>
    <article class="card macro-card wide">
      ${chips(macro, 'demand', 'week')}
      <h3>各类模型用量占比</h3>
      <p class="kpi-note">只统计前 50 名模型，其余计入总量但不分类。</p>
      ${legend(shares)}${lineChart(shares, { format: (v) => `${Math.round(v * 100)}%`, width: 760, endLabels: true })}
    </article>
    ${top.length ? `<article class="card macro-card wide">
      ${chips(macro, 'demand', 'week')}
      <h3>用量前 10 的模型（${esc(macro.usageTop.week)} 当周）</h3>
      <table><thead><tr><th>#</th><th>模型</th><th>分类</th><th class="num">周用量</th></tr></thead><tbody>
      ${top.map((r, i) => `<tr><td>${i + 1}</td><td>${esc(stripDate(r.slug))}</td><td>${esc(segName(r.segment))}</td><td class="num">${tokensBig(r.tokens)}</td></tr>`).join('')}
      </tbody></table>
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

export function renderMacro(el, { macro, money, moneyAxis, disclosed }) {
  const bodies = { fast: fastBand(macro, moneyAxis), month: monthBand(macro), quarter: quarterBand(macro), disclosed: disclosedBand(macro, disclosed) };
  const sections = BANDS.map((b) =>
    `<section class="layer"><h2>${esc(b.name)}</h2><p class="kpi-note">${esc(b.blurb)}</p>${bodies[b.id]}</section>`).join('');
  el.innerHTML = `<p class="lead">按数据变化的快慢排列：越往上更新越频繁。每张卡片标出它属于产业链的哪一环。财报数据单位为美元；Token 价格跟随右上角的货币设置。数据更新于 ${esc(new Date(macro.updatedAt).toLocaleString('zh-CN', { hour12: false }))}。</p>
    ${sections}
    <section class="layer"><h2>第二版加入</h2><p class="empty">模型公司收入和估值，需要人工录入。</p></section>`;
  bindHover(el, money);
}
