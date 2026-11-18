// Overview and macro tabs. Macro figures stay in USD; token prices follow the currency toggle.
import { SERIES_COLORS, barChart, bindHover, legend, lineChart, sparkline } from './charts.js';

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

// 1e8 = 亿, the unit Chinese finance readers expect for company-scale figures.
export function usdBig(v) {
  if (v === null || v === undefined) return '—';
  const yi = v / 1e8;
  return `$${yi >= 100 ? Math.round(yi).toLocaleString('en-US') : yi.toFixed(1)}亿`;
}
const pct = (v) => (v === null || !Number.isFinite(v) ? '—' : `${v >= 0 ? '+' : ''}${(v * 100).toFixed(1)}%`);
const pp = (v) => (v === null || !Number.isFinite(v) ? '—' : `${v >= 0 ? '+' : ''}${(v * 100).toFixed(1)} 个百分点`);
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

export function renderOverview(el, { macro, money }) {
  const capex = byId(macro, 'capex-total')?.points ?? [];
  const nvda = byId(macro, 'revenue-nvda')?.points ?? [];
  const capexYoy = yoy(capex);
  const nvdaYoy = yoy(nvda);
  const frontier = byId(macro, 'token-index-frontier')?.points ?? [];
  const china = byId(macro, 'token-index-china')?.points ?? [];
  const fChange = changeOver(frontier, 90);
  const cChange = changeOver(china, 90);
  const month = new Date().toISOString().slice(0, 7);
  const moves = macro.series.filter((s) => s.kind === 'moves')
    .map((s) => s.points.find((p) => p.date === month) ?? { cuts: 0, hikes: 0 })
    .reduce((a, p) => ({ cuts: a.cuts + p.cuts, hikes: a.hikes + p.hikes }), { cuts: 0, hikes: 0 });
  const stocks = macro.series.filter((s) => s.group === 'stocks' && s.points.length);

  el.innerHTML = `
    <p class="lead">按变化快慢排列：先看每周、每日变动的股价和 Token 价格，再看每季度的财报基本面。</p>
    <div class="kpi-grid">
      ${card({ freq: '每周',
        title: '产业链股价（近 3 个月）', note: '和上面的基本面对照，判断预期是否过热。',
        missing: stocks.length ? null : STOCK_MISSING,
        value: '',
        sub: stocks.map((s) => `${esc(s.name.replace(/股价$/, ''))} ${pct(changeOver(s.points, 91)?.change ?? null)}`).join('<br>'),
      })}
      ${card({ freq: '每日',
        title: 'Token 价格中位数', note: '模型层的定价压力，直接影响模型公司和应用层的毛利。',
        missing: frontier.length ? null : '暂无价格数据',
        value: `<span class="kpi-pair">海外 ${money(frontier.at(-1)?.value)}</span><span class="kpi-pair">中国 ${money(china.at(-1)?.value)}</span>`,
        sub: `每百万 tokens · 自 ${esc(fChange?.since ?? '—')} 起：海外 ${pct(fChange?.change ?? null)}，中国 ${pct(cChange?.change ?? null)}`,
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
}

// Bands ordered from fastest-moving data to slowest, so the top of the page is what changes daily.
const BANDS = [
  { id: 'fast', name: '每日 / 每周', blurb: '市场价格和 Token 价格，变化最快，适合日常跟踪。' },
  { id: 'month', name: '每月', blurb: '各类模型的调价节奏，看价格战是否在加剧。' },
  { id: 'quarter', name: '每季度', blurb: '财报里的基本面，变化慢，但决定产业的长期方向。' },
];
const FREQ_NAME = { day: '每日', week: '每周', month: '每月', quarter: '每季度' };

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
    name: seg.name, points: byId(macro, `token-index-${seg.id}`)?.points ?? [] }));
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
      ${legend(tokenLines)}${lineChart(tokenLines, { format: moneyAxis, step: true, width: 760, money: true })}
      <p class="source">来源：本站价格数据</p>
    </article>
  </div>`;
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

export function renderMacro(el, { macro, money, moneyAxis }) {
  const bodies = { fast: fastBand(macro, moneyAxis), month: monthBand(macro), quarter: quarterBand(macro) };
  const sections = BANDS.map((b) =>
    `<section class="layer"><h2>${esc(b.name)}</h2><p class="kpi-note">${esc(b.blurb)}</p>${bodies[b.id]}</section>`).join('');
  el.innerHTML = `<p class="lead">按数据变化的快慢排列：越往上更新越频繁。每张卡片标出它属于产业链的哪一环。财报数据单位为美元；Token 价格跟随右上角的货币设置。数据更新于 ${esc(new Date(macro.updatedAt).toLocaleString('zh-CN', { hour12: false }))}。</p>
    ${sections}
    <section class="layer"><h2>第二版加入</h2><p class="empty">需求与用量（OpenRouter 用量、厂商公布的调用量）、模型公司收入和估值，需要人工录入。</p></section>`;
  bindHover(el, money);
}
