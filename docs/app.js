import { renderMacro, renderOverview } from './macro-view.js';
import { renderMultimodal } from './multimodal-view.js';
import { SEGMENTS, matchKey, segmentOf } from './segments.js';

const PROVIDER_NAMES = {
  openai: 'OpenAI',
  anthropic: 'Anthropic',
  gemini: 'Google Gemini',
  deepseek: 'DeepSeek',
  dashscope: '阿里云百炼 (Qwen)',
  xai: 'xAI',
  mistral: 'Mistral',
  zai: '智谱 (Z.ai)',
  moonshot: 'Moonshot (Kimi)',
};
const FIELD_NAMES = { input: '输入', output: '输出', cacheRead: '缓存命中' };
const CURRENCY_SYMBOLS = { USD: '$', CNY: '¥', SGD: 'S$' };
const CAP_NAMES = {
  reasoning: '推理', vision: '识图', tools: '工具调用', web: '联网搜索',
  computer: '电脑操作', pdf: 'PDF', audio: '音频输入', video: '视频输入',
};
// Two-character labels keep the table's capability column on one line.
const CAP_SHORT = { reasoning: '推理', vision: '识图', tools: '工具', web: '联网', computer: '电脑', audio: '音频', video: '视频' };
const SCORE_NAMES = { intelligence: '综合智能', engineering: '工程', finance_and_accounting: '财务会计', legal: '法律' };
const CHANGES_SHOWN = 8;

const $ = (sel) => document.querySelector(sel);
const state = { currency: 'USD', sort: { key: 'provider', dir: 1 }, selected: null, tab: 'overview', caps: new Set(), allChanges: false, mmSub: 'video' };
const TABS = ['overview', 'prices', 'multimodal', 'macro'];
let data, changes, macro, bench, disclosed, mm;

function loadPrefs() {
  try {
    const c = localStorage.getItem('currency');
    if (c in CURRENCY_SYMBOLS) state.currency = c;
  } catch {}
}

function savePref(key, value) {
  try { localStorage.setItem(key, value); } catch {}
}

// Units of the selected currency per 1 USD; null when no rate has been fetched.
function rate(currency = state.currency) {
  if (currency === 'USD') return 1;
  return data.fx?.rates?.[currency] ?? (currency === 'CNY' ? data.usdCny : null) ?? null;
}

function money(v) {
  if (v === null || v === undefined) return '—';
  const n = v * rate();
  const sym = CURRENCY_SYMBOLS[state.currency];
  if (n === 0) return sym + '0';
  const digits = n >= 100 ? 0 : n >= 1 ? 2 : n >= 0.01 ? 3 : 4;
  return sym + n.toFixed(digits);
}

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

const providerName = (p) => PROVIDER_NAMES[p] ?? p;
const lastChange = (m) => m.history.at(-1)?.date ?? m.firstSeen;

// 131072 -> 128K, 200000 -> 200K, 1048576 -> 1M.
function tokensShort(v) {
  if (!v) return '—';
  const base = v % 1024 === 0 ? 1024 : 1000;
  if (v >= base * base) return `${+(v / base / base).toFixed(1)}M`;
  return `${Math.round(v / base)}K`;
}

// Artificial Analysis scores for a model, tolerating -latest / -preview suffixes.
function benchOf(m) {
  if (!bench?.models) return null;
  const key = matchKey(m.model);
  return bench.models[key] ?? bench.models[key.replace(/-(latest|preview|exp)$/, '')] ?? null;
}
const intelligence = (m) => benchOf(m)?.scores.intelligence ?? null;
const sortValue = (m, key) => {
  if (key === 'lastChange') return lastChange(m);
  if (key === 'context') return m.specs?.context ?? null;
  if (key === 'intelligence') return intelligence(m);
  return m[key];
};

function renderMeta() {
  const when = new Date(data.updatedAt).toLocaleString('zh-CN', { hour12: false });
  const n = Object.values(data.models).filter((m) => !m.removed).length;
  const fxText = ['CNY', 'SGD'].filter((c) => rate(c)).map((c) => `${rate(c).toFixed(4)} ${c}`).join(' ≈ ');
  const fxSource = data.fx?.source
    ? `（<a href="${esc(data.fx.source)}" rel="noopener">${data.fx.source.includes('mas.gov.sg') ? '新加坡金管局' : '汇率来源'}</a>${data.fx.date ? ` ${esc(data.fx.date)}` : ''}）`
    : '';
  $('#meta').innerHTML =
    `收录 ${n} 个模型 · 最后抓取 ${esc(when)} · ` +
    (fxText ? `汇率 1 USD ≈ ${fxText}${fxSource} · ` : '') +
    `<a href="${esc(data.source)}" rel="noopener">价格数据来源</a>`;
  $('#unit').textContent = `（每百万 tokens，${state.currency}）`;
}

function filters() {
  const [lo, hi] = ($('#priceBand').value || '-').split('-').map((x) => (x === '' ? null : Number(x)));
  return {
    q: $('#search').value.trim().toLowerCase(),
    segment: $('#segment').value,
    provider: $('#provider').value,
    context: Number($('#context').value) || 0,
    lo, hi,
    changedOnly: $('#changedOnly').checked,
    showRemoved: $('#showRemoved').checked,
  };
}

function renderTable() {
  const f = filters();
  const { key, dir } = state.sort;
  const rows = Object.entries(data.models)
    .filter(([id, m]) =>
      (f.showRemoved || !m.removed) &&
      (!f.provider || m.provider === f.provider) &&
      (!f.segment || segmentOf(m) === f.segment) &&
      (!f.q || id.toLowerCase().includes(f.q)) &&
      (!f.context || (m.specs?.context ?? 0) >= f.context) &&
      // Price bands are in USD whatever the display currency.
      (!f.lo || m.output > f.lo) &&
      (f.hi === null || m.output <= f.hi) &&
      (!f.changedOnly || m.history.length > 1) &&
      [...state.caps].every((c) => m.specs?.caps?.includes(c)))
    .sort(([, a], [, b]) => {
      const va = sortValue(a, key);
      const vb = sortValue(b, key);
      if (va === vb) return a.model.localeCompare(b.model);
      if (va === null || va === undefined) return 1;
      if (vb === null || vb === undefined) return -1;
      return (typeof va === 'number' ? va - vb : String(va).localeCompare(String(vb))) * dir;
    });

  // One block per segment, in the fixed segment order; sorting applies inside each block.
  const html = SEGMENTS.map((seg) => {
    const group = rows.filter(([, m]) => segmentOf(m) === seg.id);
    if (!group.length) return '';
    const blended = group.map(([, m]) => (m.input * 3 + m.output) / 4).sort((a, b) => a - b);
    const mid = blended[blended.length >> 1];
    return `<tr class="group"><td colspan="9"><b>${esc(seg.name)}</b> <span class="tag">${group.length} 个模型 · 混合价中位数 ${money(mid)}</span><span class="group-driver">驱动因素：${esc(seg.driver)}</span></td></tr>` +
      group.map(([id, m]) => {
        const b = benchOf(m);
        return `
      <tr data-id="${esc(id)}" class="${m.removed ? 'removed' : ''}" aria-selected="${id === state.selected}">
        <td>${esc(m.model)}${m.removed ? '<span class="tag">已下架</span>' : ''}${m.history.length > 1 ? `<span class="tag">调价 ${m.history.length - 1} 次</span>` : ''}${m.specs?.deprecation ? `<span class="tag warn">${esc(m.specs.deprecation)} 停用</span>` : ''}</td>
        <td>${esc(providerName(m.provider))}</td>
        <td class="num">${tokensShort(m.specs?.context)}</td>
        <td class="caps">${(m.specs?.caps ?? []).filter((c) => CAP_SHORT[c]).map((c) => `<span class="cap" title="${esc(CAP_NAMES[c])}">${CAP_SHORT[c]}</span>`).join('')}</td>
        <td class="num">${b?.scores.intelligence ?? '—'}</td>
        <td class="num">${money(m.input)}</td>
        <td class="num">${money(m.output)}</td>
        <td class="num">${money(m.cacheRead)}</td>
        <td class="num">${esc(lastChange(m))}</td>
      </tr>`;
      }).join('');
  }).join('');
  $('#prices tbody').innerHTML = html;
  $('#noResults').hidden = rows.length > 0;
  $('#resultCount').textContent = `· 共 ${rows.length} 个`;
  $('#benchSource').innerHTML = bench
    ? `智能指数：<a href="${esc(bench.sourceUrl)}" rel="noopener">${esc(bench.citation)}</a>${bench.asOf ? `，截至 ${esc(bench.asOf.slice(0, 10))}` : ''}。上下文和能力标签来自价格数据源。`
    : '智能指数需要在仓库 Secrets 配置 OPENROUTER_API_KEY 后才会出现。上下文和能力标签来自价格数据源。';

  for (const th of document.querySelectorAll('#prices th[data-sort]')) {
    th.setAttribute('aria-sort', th.dataset.sort === key ? (dir > 0 ? 'ascending' : 'descending') : 'none');
  }
}

function describeChange(c) {
  const name = esc(c.id.split('/').slice(1).join('/'));
  const who = `<button type="button" data-id="${esc(c.id)}">${name}</button> <span class="tag">${esc(providerName(c.id.split('/')[0]))}</span>`;
  if (c.type === 'added') return `${who} 新上线：输入 ${money(c.after.input)} / 输出 ${money(c.after.output)}`;
  if (c.type === 'removed') return `${who} 已从价目表下架`;
  if (c.type === 'restored') return `${who} 重新上架：输入 ${money(c.after.input)} / 输出 ${money(c.after.output)}`;
  const parts = Object.keys(FIELD_NAMES)
    .filter((f) => c.before[f] !== c.after[f])
    .map((f) => {
      const cls = c.after[f] === null || c.before[f] === null ? '' : c.after[f] < c.before[f] ? 'down' : 'up';
      return `${FIELD_NAMES[f]} ${money(c.before[f])} → <span class="${cls}">${money(c.after[f])}</span>`;
    });
  return `${who} ${parts.join('，')}`;
}

function renderChanges() {
  const today = Date.parse(data.updatedAt);
  const recent = changes.filter((c) => today - Date.parse(c.date) <= 30 * 864e5);
  const count = (pred) => recent.filter(pred).length;
  const cut = (c) => c.type === 'changed' && (c.after.input * 3 + c.after.output) < (c.before.input * 3 + c.before.output);
  const hike = (c) => c.type === 'changed' && (c.after.input * 3 + c.after.output) > (c.before.input * 3 + c.before.output);
  $('#changeSummary').innerHTML = `近 30 天：<span class="down">降价 ${count(cut)}</span> · <span class="up">涨价 ${count(hike)}</span> · 新上线 ${count((c) => c.type === 'added')} · 下架 ${count((c) => c.type === 'removed')}`;
  const list = changes.slice(0, state.allChanges ? 100 : CHANGES_SHOWN);
  $('#changes').innerHTML = list.length
    ? list.map((c) => `<li><time>${esc(c.date)}</time><span>${describeChange(c)}</span></li>`).join('')
    : '<li class="empty">从开始记录至今还没有检测到调价，有变动时会出现在这里。</li>';
  const more = $('#moreChanges');
  more.hidden = changes.length <= CHANGES_SHOWN;
  more.textContent = state.allChanges ? '收起' : `显示全部（${Math.min(changes.length, 100)} 条）`;
}

// Step chart: a price holds until the next recorded change.
function chartSvg(m, W) {
  const today = new Date().toISOString().slice(0, 10);
  const points = m.history.map((h) => ({ t: Date.parse(h.date), ...h }));
  const end = Date.parse(m.removed ?? today);
  const t0 = points[0].t;
  const t1 = Math.max(end, t0 + 864e5);
  const conv = (v) => (v === null ? null : v * rate());
  const max = Math.max(...points.flatMap((p) => [conv(p.input), conv(p.output)])) * 1.15 || 1;

  const H = 240, L = 56, R = 12, T = 12, B = 28;
  const x = (t) => L + ((t - t0) / (t1 - t0)) * (W - L - R);
  const y = (v) => T + (1 - v / max) * (H - T - B);
  const path = (f) => {
    let d = '';
    points.forEach((p, i) => {
      const v = conv(p[f]);
      d += i === 0 ? `M${x(p.t)},${y(v)}` : `H${x(p.t)}V${y(v)}`;
    });
    return d + `H${x(t1)}`;
  };

  const ticks = [0, 0.25, 0.5, 0.75, 1].map((k) => k * max);
  const grid = ticks.map((v) =>
    `<line x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}"/>` +
    `<text x="${L - 6}" y="${y(v) + 4}" text-anchor="end">${money(v / rate())}</text>`).join('');
  const fmt = (t) => new Date(t).toISOString().slice(0, 10);
  const markers = points.flatMap((p) => ['input', 'output'].map((f, i) =>
    `<circle cx="${x(p.t)}" cy="${y(conv(p[f]))}" r="4" fill="var(--series-${i + 1})" stroke="var(--surface-1)" stroke-width="2"/>`)).join('');

  return `
    <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(m.model)} 价格走势">
      <g class="grid">${grid}</g>
      <text x="${L}" y="${H - 6}">${fmt(t0)}</text>
      <text x="${W - R}" y="${H - 6}" text-anchor="end">${fmt(t1)}</text>
      <path d="${path('output')}" fill="none" stroke="var(--series-2)" stroke-width="2"/>
      <path d="${path('input')}" fill="none" stroke="var(--series-1)" stroke-width="2"/>
      ${markers}
      <line class="cursor" y1="${T}" y2="${H - B}" stroke="var(--text-muted)" stroke-dasharray="3 3" visibility="hidden"/>
      <rect class="hit" x="${L}" y="0" width="${W - L - R}" height="${H}" fill="transparent"/>
    </svg>
    <div class="tooltip" hidden></div>`;

}

function attachHover(el, m, W) {
  const svg = el.querySelector('svg');
  const tip = el.querySelector('.tooltip');
  const cursor = svg.querySelector('.cursor');
  const points = m.history.map((h) => ({ t: Date.parse(h.date), ...h }));
  const t0 = points[0].t;
  const t1 = Math.max(Date.parse(m.removed ?? new Date().toISOString().slice(0, 10)), t0 + 864e5);
  const L = 56, R = 12;

  svg.addEventListener('pointermove', (e) => {
    const box = svg.getBoundingClientRect();
    const vx = ((e.clientX - box.left) / box.width) * W;
    const t = t0 + ((vx - L) / (W - L - R)) * (t1 - t0);
    const p = points.findLast((pt) => pt.t <= t) ?? points[0];
    cursor.setAttribute('x1', vx);
    cursor.setAttribute('x2', vx);
    cursor.setAttribute('visibility', 'visible');
    tip.hidden = false;
    tip.innerHTML = `${new Date(Math.max(t, t0)).toISOString().slice(0, 10)}<br>` +
      `<span style="color:var(--series-1)">●</span> 输入 ${money(p.input)}<br>` +
      `<span style="color:var(--series-2)">●</span> 输出 ${money(p.output)}`;
    const left = e.clientX - box.left;
    tip.style.left = `${Math.min(left + 12, box.width - tip.offsetWidth)}px`;
    tip.style.top = '8px';
  });
  svg.addEventListener('pointerleave', () => {
    tip.hidden = true;
    cursor.setAttribute('visibility', 'hidden');
  });
}

function specsBlock(m) {
  const s = m.specs ?? {};
  const b = benchOf(m);
  const items = [
    ['分类', esc(SEGMENTS.find((x) => x.id === segmentOf(m))?.name ?? '')],
    ['上下文', tokensShort(s.context)],
    ['最大输出', tokensShort(s.maxOutput)],
    ['能力', (s.caps ?? []).map((c) => esc(CAP_NAMES[c])).join('、') || '—'],
    ...(b ? Object.entries(b.scores).map(([k, v]) => [`${SCORE_NAMES[k] ?? k}指数`, String(v)]) : []),
    ...(s.deprecation ? [['计划停用', esc(s.deprecation)]] : []),
  ];
  return `<dl class="specs">${items.map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join('')}</dl>` +
    (b ? '' : '<p class="source">暂无该模型的 Artificial Analysis 评分。</p>');
}

function renderDetail() {
  const el = $('#detail');
  const m = data.models[state.selected];
  if (!m) { el.hidden = true; return; }
  el.hidden = false;
  const rows = [...m.history].reverse().map((h) =>
    `<tr><td>${esc(h.date)}</td><td class="num">${money(h.input)}</td><td class="num">${money(h.output)}</td><td class="num">${money(h.cacheRead)}</td></tr>`).join('');
  el.innerHTML = `
    <div class="detail-head">
      <div>
        <h2>${esc(m.model)} <span class="unit">${esc(providerName(m.provider))}${m.removed ? ` · ${esc(m.removed)} 下架` : ''}</span></h2>
        <div class="legend"><span><i style="background:var(--series-1)"></i>输入</span><span><i style="background:var(--series-2)"></i>输出</span></div>
      </div>
      <button type="button" id="closeDetail">关闭</button>
    </div>
    ${specsBlock(m)}
    <div class="chart"></div>
    <div class="table-scroll">
      <table>
        <thead><tr><th>生效日期</th><th class="num">输入</th><th class="num">输出</th><th class="num">缓存命中</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
    <p class="source">首次记录 ${esc(m.firstSeen)}${m.source ? ` · <a href="${esc(m.source)}" rel="noopener">官方价格页</a>` : ''}</p>`;
  const chart = el.querySelector('.chart');
  const W = Math.max(chart.clientWidth, 280);
  chart.innerHTML = chartSvg(m, W);
  attachHover(chart, m, W);
  $('#closeDetail').addEventListener('click', () => select(null));
}

function select(id) {
  state.selected = id;
  history.replaceState(null, '', id ? `#${encodeURIComponent(id)}` : '#prices');
  renderDetail();
  renderTable();
  if (id) $('#detail').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// Axis labels for token prices: the same currency, fewer digits.
const moneyAxis = (v) => money(v);

function renderAll() {
  renderMeta();
  for (const t of TABS) $(`#view-${t}`).hidden = t !== state.tab;
  for (const a of document.querySelectorAll('[data-tab]')) {
    a.setAttribute('aria-current', a.dataset.tab === state.tab ? 'page' : 'false');
  }
  if (state.tab === 'prices') {
    renderTable();
    renderChanges();
    renderDetail();
  } else if (state.tab === 'multimodal') {
    renderMultimodal($('#view-multimodal'), {
      mm, money, textModels: data.models, sub: state.mmSub,
      onSub: (id) => { state.mmSub = id; history.replaceState(null, '', `#multimodal/${id}`); renderAll(); },
    });
  } else if (!macro) {
    $(`#view-${state.tab}`).innerHTML = '<p class="empty">宏观数据还没有生成，下一次每日抓取后会出现。</p>';
  } else if (state.tab === 'overview') {
    renderOverview($('#view-overview'), { macro, money, changes, models: data.models });
  } else {
    renderMacro($('#view-macro'), { macro, money, moneyAxis, disclosed });
  }
}

// A hash is a tab name, or a model id (which opens the price tab on that model).
function route() {
  const hash = decodeURIComponent(location.hash.slice(1));
  if (TABS.includes(hash)) {
    state.tab = hash;
  } else if (hash.startsWith('multimodal/')) {
    state.tab = 'multimodal';
    state.mmSub = hash.slice('multimodal/'.length);
  } else if (data.models[hash]) {
    state.tab = 'prices';
    state.selected = hash;
  } else {
    state.tab = 'overview';
  }
  renderAll();
}

async function main() {
  loadPrefs();
  [data, changes] = await Promise.all(
    ['data/prices.json', 'data/changes.json'].map((u) => fetch(u, { cache: 'no-cache' }).then((r) => r.json())));
  // macro.json appears after the first daily run that includes it; the price tab works without it.
  const optional = (u) => fetch(u, { cache: 'no-cache' }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
  [macro, bench, disclosed, mm] = await Promise.all(['data/macro.json', 'data/benchmarks.json', 'data/usage-disclosed.json', 'data/multimodal.json'].map(optional));

  const providers = [...new Set(Object.values(data.models).map((m) => m.provider))];
  $('#segment').innerHTML += SEGMENTS.map((g) => `<option value="${g.id}">${esc(g.name)}</option>`).join('');
  $('#caps').innerHTML = Object.entries(CAP_NAMES).filter(([c]) => c !== 'pdf')
    .map(([c, name]) => `<button type="button" data-cap="${c}" aria-pressed="false">${esc(name)}</button>`).join('');
  $('#caps').addEventListener('click', (e) => {
    const b = e.target.closest('[data-cap]');
    if (!b) return;
    const on = !state.caps.has(b.dataset.cap);
    if (on) state.caps.add(b.dataset.cap); else state.caps.delete(b.dataset.cap);
    b.setAttribute('aria-pressed', on);
    renderTable();
  });
  $('#resetFilters').addEventListener('click', () => {
    for (const id of ['#search', '#segment', '#provider', '#context', '#priceBand']) $(id).value = '';
    for (const id of ['#changedOnly', '#showRemoved']) $(id).checked = false;
    state.caps.clear();
    for (const b of document.querySelectorAll('[data-cap]')) b.setAttribute('aria-pressed', 'false');
    renderTable();
  });
  $('#moreChanges').addEventListener('click', () => {
    state.allChanges = !state.allChanges;
    renderChanges();
  });
  $('#provider').innerHTML += providers.map((p) => `<option value="${esc(p)}">${esc(providerName(p))}</option>`).join('');

  if (!rate()) state.currency = 'USD';
  for (const b of document.querySelectorAll('[data-currency]')) {
    b.disabled = !rate(b.dataset.currency);
    b.setAttribute('aria-pressed', b.dataset.currency === state.currency);
    b.addEventListener('click', () => {
      state.currency = b.dataset.currency;
      savePref('currency', state.currency);
      for (const o of document.querySelectorAll('[data-currency]')) o.setAttribute('aria-pressed', o === b);
      renderAll();
    });
  }
  for (const id of ['#search', '#segment', '#provider', '#context', '#priceBand', '#changedOnly', '#showRemoved']) $(id).addEventListener('input', renderTable);
  for (const th of document.querySelectorAll('#prices th[data-sort]')) {
    th.addEventListener('click', () => {
      const key = th.dataset.sort;
      state.sort = { key, dir: state.sort.key === key ? -state.sort.dir : 1 };
      renderTable();
    });
  }
  $('#prices tbody').addEventListener('click', (e) => {
    const tr = e.target.closest('tr[data-id]');
    if (tr) select(tr.dataset.id);
  });
  $('#changes').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-id]');
    if (b) select(b.dataset.id);
  });

  window.addEventListener('hashchange', route);
  route();
}

main().catch((err) => {
  $('#meta').textContent = `数据加载失败：${err.message}`;
});
