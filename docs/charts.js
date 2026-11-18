// Small SVG chart helpers shared by the overview and macro tabs.
// Each returns markup; bindHover() wires the crosshair tooltip after it is in the DOM.

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
export const SERIES_COLORS = ['var(--series-1)', 'var(--series-2)', 'var(--series-3)', 'var(--series-4)', 'var(--series-5)'];

function niceMax(v) {
  if (!(v > 0)) return 1;
  const p = 10 ** Math.floor(Math.log10(v));
  return [1, 2, 2.5, 5, 10].map((m) => m * p).find((m) => m >= v);
}

// Quarter labels like 2025Q3 sort and display as-is; ISO dates are shortened.
const label = (d) => (/^\d{4}Q\d$/.test(d) ? d : d.slice(0, 10));
const toTime = (d) => (/^\d{4}Q\d$/.test(d) ? Date.UTC(+d.slice(0, 4), (+d.slice(5) - 1) * 3 + 2, 28) : Date.parse(d));

// Bars for quarterly figures. `format` prints values on the axis and in the tooltip.
export function barChart(points, { width = 520, height = 200, format = String, color = SERIES_COLORS[0] } = {}) {
  if (!points.length) return '<p class="empty">暂无数据</p>';
  const L = 56, R = 8, T = 10, B = 24;
  const max = niceMax(Math.max(...points.map((p) => p.value)));
  const step = (width - L - R) / points.length;
  const bw = Math.max(4, step - 6);
  const y = (v) => T + (1 - Math.max(v, 0) / max) * (height - T - B);
  const ticks = [0, 0.5, 1].map((k) => k * max);
  const bars = points.map((p, i) => {
    const x = L + i * step + (step - bw) / 2;
    const top = y(p.value);
    const h = height - B - top;
    // Square bottom, 4px rounded top: a path rather than a rect with rx on all corners.
    const r = Math.min(4, bw / 2, h);
    return `<path d="M${x},${height - B}V${top + r}q0,-${r} ${r},-${r}H${x + bw - r}q${r},0 ${r},${r}V${height - B}Z" fill="${color}">` +
      `<title>${esc(label(p.date))}：${esc(format(p.value))}</title></path>`;
  }).join('');
  const first = label(points[0].date), last = label(points.at(-1).date);
  return `<svg class="chart-svg" viewBox="0 0 ${width} ${height}" role="img">
    ${ticks.map((v) => `<line class="grid" x1="${L}" x2="${width - R}" y1="${y(v)}" y2="${y(v)}"/><text x="${L - 6}" y="${y(v) + 4}" text-anchor="end">${esc(format(v))}</text>`).join('')}
    ${bars}
    <text x="${L}" y="${height - 6}">${esc(first)}</text>
    <text x="${width - R}" y="${height - 6}" text-anchor="end">${esc(last)}</text>
  </svg>`;
}

// One or more lines sharing a time axis. series: [{name, points:[{date,value}]}].
// money: tooltip values go through bindHover's money formatter; otherwise they print like the axis.
// events: [{date, kind: 'down'|'up'|'new'}] drawn as ticks along the bottom axis.
// A series may carry its own `color`, so one segment keeps one color on every chart.
// endLabels: write each series' name at the end of its line instead of relying on a legend alone.
export const colorOf = (series, s) => s.color ?? SERIES_COLORS[series.indexOf(s) % SERIES_COLORS.length];
export function lineChart(series, { width = 520, height = 200, format = String, step = false, money = false, events = [], endLabels = false } = {}) {
  const live = series.filter((s) => s.points.length);
  if (!live.length) return '<p class="empty">暂无数据</p>';
  const L = 56, R = endLabels ? 96 : 8, T = 10, B = 24;
  const all = live.flatMap((s) => s.points);
  const t0 = Math.min(...all.map((p) => toTime(p.date)));
  const t1 = Math.max(t0 + 864e5, ...all.map((p) => toTime(p.date)));
  const max = niceMax(Math.max(...all.map((p) => p.value)));
  const x = (d) => L + ((toTime(d) - t0) / (t1 - t0)) * (width - L - R);
  const y = (v) => T + (1 - v / max) * (height - T - B);
  const path = (pts) => pts.map((p, i) => {
    if (i === 0) return `M${x(p.date)},${y(p.value)}`;
    return step ? `H${x(p.date)}V${y(p.value)}` : `L${x(p.date)},${y(p.value)}`;
  }).join('');
  const ticks = [0, 0.5, 1].map((k) => k * max);
  const EVENT_COLOR = { down: 'var(--down)', up: 'var(--up)', new: 'var(--text-muted)' };
  const marks = events.filter((e) => toTime(e.date) >= t0 && toTime(e.date) <= t1).map((e, i, all) => {
    // Several events on one day stack upward so each stays visible.
    const n = all.slice(0, i).filter((o) => o.date === e.date).length;
    const cx = x(e.date), cy = height - B - 5 - n * 7;
    return `<circle cx="${cx}" cy="${cy}" r="3" fill="${EVENT_COLOR[e.kind] ?? EVENT_COLOR.new}"><title>${esc(e.label ?? e.date)}</title></circle>`;
  }).join('');
  const lines = live.map((s) => {
    const color = colorOf(series, s);
    const lastP = s.points.at(-1);
    return `<path d="${path(s.points)}" fill="none" stroke="${color}" stroke-width="2"/>` +
      `<circle cx="${x(lastP.date)}" cy="${y(lastP.value)}" r="4" fill="${color}" stroke="var(--surface-1)" stroke-width="2"/>`;
  }).join('');
  // End labels, nudged apart vertically so close lines don't overprint each other.
  let labels = '';
  if (endLabels) {
    const placed = live.map((s) => ({ s, y: y(s.points.at(-1).value) })).sort((a, b) => a.y - b.y);
    for (let i = 1; i < placed.length; i++) placed[i].y = Math.max(placed[i].y, placed[i - 1].y + 13);
    labels = placed.map(({ s, y: ly }) => `<text class="end-label" x="${width - R + 8}" y="${ly + 4}" style="fill:${colorOf(series, s)}">${esc(s.name)}</text>`).join('');
  }
  const payload = esc(JSON.stringify({ L, R, width, t0, t1, money, series: live.map((s) => ({ name: s.name, color: colorOf(series, s), points: s.points.map((p) => [toTime(p.date), p.value, label(p.date)]) })) }));
  return `<div class="chart" data-hover="${payload}"><svg class="chart-svg" viewBox="0 0 ${width} ${height}" role="img">
    ${ticks.map((v) => `<line class="grid" x1="${L}" x2="${width - R}" y1="${y(v)}" y2="${y(v)}"/><text x="${L - 6}" y="${y(v) + 4}" text-anchor="end">${esc(format(v))}</text>`).join('')}
    ${lines}
    ${labels}
    ${marks}
    <text x="${L}" y="${height - 6}">${esc(label(new Date(t0).toISOString()))}</text>
    <text x="${width - R}" y="${height - 6}" text-anchor="end">${esc(label(new Date(t1).toISOString()))}</text>
    <line class="cursor" y1="${T}" y2="${height - B}" visibility="hidden"/>
  </svg><div class="tooltip" hidden></div></div>`;
}

export function legend(series) {
  return `<div class="legend">${series.filter((s) => s.points.length).map((s) =>
    `<span><i style="background:${colorOf(series, s)}"></i>${esc(s.name)}</span>`).join('')}</div>`;
}

// Crosshair + tooltip for every lineChart under root. `format` prints tooltip values.
export function bindHover(root, format = String) {
  for (const el of root.querySelectorAll('.chart[data-hover]')) {
    const cfg = JSON.parse(el.dataset.hover);
    const svg = el.querySelector('svg');
    const tip = el.querySelector('.tooltip');
    const cursor = svg.querySelector('.cursor');
    svg.addEventListener('pointermove', (e) => {
      const box = svg.getBoundingClientRect();
      const vx = ((e.clientX - box.left) / box.width) * cfg.width;
      const t = cfg.t0 + ((vx - cfg.L) / (cfg.width - cfg.L - cfg.R)) * (cfg.t1 - cfg.t0);
      const rows = cfg.series.map((s) => ({ ...s, p: s.points.findLast((p) => p[0] <= t) })).filter((s) => s.p);
      const fmt = cfg.money ? format : (v) => v.toFixed(1);
      if (!rows.length) return;
      cursor.setAttribute('x1', vx);
      cursor.setAttribute('x2', vx);
      cursor.setAttribute('visibility', 'visible');
      tip.hidden = false;
      tip.innerHTML = `${esc(rows[0].p[2])}<br>` + rows.map((s) =>
        `<span style="color:${s.color}">●</span> ${esc(s.name)} ${esc(fmt(s.p[1]))}`).join('<br>');
      const left = e.clientX - box.left;
      tip.style.left = `${Math.max(0, Math.min(left + 12, box.width - tip.offsetWidth))}px`;
      tip.style.top = '4px';
    });
    svg.addEventListener('pointerleave', () => {
      tip.hidden = true;
      cursor.setAttribute('visibility', 'hidden');
    });
  }
}

// Small trend line for overview cards, no axes.
export function sparkline(points, { width = 160, height = 36, color = SERIES_COLORS[0] } = {}) {
  if (points.length < 2) return '';
  const vs = points.map((p) => p.value);
  const lo = Math.min(...vs), hi = Math.max(...vs);
  const x = (i) => 2 + (i / (points.length - 1)) * (width - 4);
  const y = (v) => 2 + (1 - (hi === lo ? 0.5 : (v - lo) / (hi - lo))) * (height - 4);
  const d = points.map((p, i) => `${i ? 'L' : 'M'}${x(i)},${y(p.value)}`).join('');
  return `<svg class="spark" viewBox="0 0 ${width} ${height}" aria-hidden="true"><path d="${d}" fill="none" stroke="${color}" stroke-width="2"/></svg>`;
}

// ---- Weekly charts: one point per week, a tick per week, month labels, hover on any week. ----

// weeks: Monday dates. series: [{name, color, values: [number|null per week], wow?: [..]}].
// liveFrom: weeks before this date are drawn on a tinted band marked as backfilled data.
// events: Map week → [text] listed in the tooltip. small: compact multiple without end labels.
const narrow = () => typeof window !== 'undefined' && window.innerWidth < 700;
export function weeklyChart(weeks, series, { range = 0, width = narrow() ? 360 : 760, height = narrow() ? 220 : 260, format = (v) => v.toFixed(0), tipFormat, liveFrom = null, events = new Map(), small = false, partialLast = false, baseline = null } = {}) {
  const from = range && weeks.length > range ? weeks.length - range : 0;
  const ws = weeks.slice(from);
  const ss = series.map((s) => ({ ...s, values: s.values.slice(from), wow: s.wow?.slice(from) }));
  const vals = ss.flatMap((s) => s.values).filter((v) => v !== null && Number.isFinite(v));
  if (!vals.length) return `<div class="chart weekly empty-chart"><p class="empty">${small ? '数据源无历史' : '暂无数据'}</p></div>`;
  let lo = Math.min(...vals, ...(baseline === null ? [] : [baseline])), hi = Math.max(...vals, ...(baseline === null ? [] : [baseline]));
  const pad = (hi - lo) * 0.12 || Math.abs(hi) * 0.05 || 1;
  const nonNeg = lo >= 0;
  lo -= pad; hi += pad;
  if (nonNeg && lo < 0) lo = 0;
  // Narrow charts name their lines in a legend underneath instead of at the line ends.
  const compact = small || width < 600;
  const L = small ? 34 : 40, R = compact ? 8 : 180, T = 10, B = 22;
  const n = ws.length;
  const x = (i) => L + (n === 1 ? 0 : (i / (n - 1)) * (width - L - R));
  const y = (v) => T + (1 - (v - lo) / (hi - lo)) * (height - T - B);
  const fs = small ? 10 : 11;
  let s = `<svg class="chart-svg" viewBox="0 0 ${width} ${height}" role="img">`;
  const li = liveFrom ? ws.findIndex((w) => w >= weekStart(liveFrom)) : -1;
  if (li > 0) {
    s += `<rect class="backfill" x="${L}" y="${T}" width="${x(li) - L}" height="${height - T - B}"/>`;
    if (!compact) s += `<text class="band-label" x="${x(li) - 6}" y="${T + 12}" text-anchor="end">← 回溯数据　实时抓取 →</text>`;
  }
  for (let k = 0; k <= (small ? 2 : 4); k++) {
    const v = lo + ((hi - lo) * k) / (small ? 2 : 4);
    s += `<line class="grid" x1="${L}" x2="${width - R}" y1="${y(v)}" y2="${y(v)}"/><text x="${L - 5}" y="${y(v) + 4}" text-anchor="end" font-size="${fs}">${esc(format(v))}</text>`;
  }
  if (baseline !== null) s += `<line class="base" x1="${L}" x2="${width - R}" y1="${y(baseline)}" y2="${y(baseline)}"/>`;
  let lastMonth = '';
  const every = n > 30 ? (small ? 3 : 1) : 1;
  let mi = 0, lastX = -1e9;
  ws.forEach((w, i) => {
    s += `<line class="wtick" x1="${x(i)}" x2="${x(i)}" y1="${height - B}" y2="${height - B + 3}"/>`;
    const m = w.slice(0, 7);
    if (m !== lastMonth) {
      lastMonth = m;
      const text = `${+m.slice(5) === 1 || i === 0 ? `${m.slice(2, 4)}年` : ''}${+m.slice(5)}月`;
      // Labels only where there is room; a week tick still marks every week.
      if (mi++ % every === 0 && x(i) - lastX >= text.length * fs * 0.95 + 4) {
        s += `<text x="${x(i)}" y="${height - 6}" font-size="${fs}">${text}</text>`;
        lastX = x(i);
      }
    }
  });
  for (const se of ss) {
    let d = '', pen = false;
    se.values.forEach((v, i) => {
      if (v === null || !Number.isFinite(v)) { pen = false; return; }
      d += `${pen ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`;
      pen = true;
    });
    s += `<path d="${d}" fill="none" stroke="${se.color}" stroke-width="${small ? 1.6 : 2}"/>`;
    if (n <= 60) s += se.values.map((v, i) => (v === null ? '' : `<circle cx="${x(i).toFixed(1)}" cy="${y(v).toFixed(1)}" r="${small ? 1.6 : 2.4}" fill="${se.color}"/>`)).join('');
  }
  if (!compact) {
    const placed = ss.map((se) => ({ se, i: se.values.findLastIndex((v) => v !== null) })).filter((p) => p.i >= 0)
      .map((p) => ({ ...p, y: y(p.se.values[p.i]) })).sort((a, b) => a.y - b.y);
    for (let i = 1; i < placed.length; i++) placed[i].y = Math.max(placed[i].y, placed[i - 1].y + 13);
    s += placed.map((p) => `<text class="end-label" x="${width - R + 8}" y="${p.y + 4}" style="fill:${p.se.color}">${esc(p.se.name)} ${esc(format(p.se.values[p.i]))}</text>`).join('');
  }
  s += `<line class="cursor" y1="${T}" y2="${height - B}" visibility="hidden"/></svg><div class="tooltip" hidden></div>`;
  const ev = Object.fromEntries(ws.filter((w) => events.get(w)).map((w) => [w, events.get(w)]));
  const payload = { L, R, width, weeks: ws, partialLast, liveFrom: li > 0 ? ws[li] : null, events: ev,
    series: ss.map((se) => ({ name: se.name, color: se.color, values: se.values, wow: se.wow ?? null })), fmt: tipFormat ? 'money' : 'num' };
  const key = compact && !small && ss.length > 1
    ? `<div class="legend wrap-legend">${ss.filter((se) => se.values.some((v) => v !== null)).map((se) => `<span><i style="background:${se.color}"></i>${esc(se.name)} ${esc(format(se.values.findLast((v) => v !== null) ?? NaN))}</span>`).join('')}</div>` : '';
  return `<div class="chart weekly" data-weekly="${esc(JSON.stringify(payload))}">${s}</div>${key}`;
}

const weekStart = (date) => {
  const t = Date.parse(date);
  return new Date(t - ((new Date(t).getUTCDay() + 6) % 7) * 864e5).toISOString().slice(0, 10);
};

// Hover (and tap) on any week: date, each line's value and weekly change, and that week's price moves.
export function bindWeekly(root, money = (v) => v.toFixed(2)) {
  for (const el of root.querySelectorAll('.chart[data-weekly]')) {
    const cfg = JSON.parse(el.dataset.weekly);
    const svg = el.querySelector('svg');
    const tip = el.querySelector('.tooltip');
    const cursor = svg.querySelector('.cursor');
    const n = cfg.weeks.length;
    const show = (e) => {
      const box = svg.getBoundingClientRect();
      const vx = ((e.clientX - box.left) / box.width) * cfg.width;
      const i = Math.max(0, Math.min(n - 1, Math.round(((vx - cfg.L) / (cfg.width - cfg.L - cfg.R)) * (n - 1))));
      const cx = cfg.L + (n === 1 ? 0 : (i / (n - 1)) * (cfg.width - cfg.L - cfg.R));
      cursor.setAttribute('x1', cx); cursor.setAttribute('x2', cx); cursor.setAttribute('visibility', 'visible');
      const w = cfg.weeks[i];
      const end = new Date(Date.parse(w) + 6 * 864e5).toISOString().slice(5, 10);
      const tag = i === n - 1 && cfg.partialLast ? '本周至今' : cfg.liveFrom && w < cfg.liveFrom ? '回溯数据' : '';
      const fmt = cfg.fmt === 'money' ? money : (v) => v.toFixed(1);
      const rows = cfg.series.filter((s) => s.values[i] !== null).map((s) => {
        const wow = s.wow?.[i];
        return `<span style="color:${s.color}">●</span> ${esc(s.name)}：${esc(fmt(s.values[i]))}${wow ? ` <span class="${wow < 0 ? 'down' : 'up'}">周${wow > 0 ? '+' : ''}${wow.toFixed(1)}%</span>` : ''}`;
      });
      const evs = cfg.events[w] ?? [];
      tip.innerHTML = `<b>${esc(w)} 至 ${esc(end)}</b>${tag ? ` · ${tag}` : ''}<br>${rows.join('<br>') || '没有数据'}` +
        (evs.length ? `<div class="tip-ev">当周调价：<br>${evs.slice(0, 5).map(esc).join('<br>')}${evs.length > 5 ? `<br>另有 ${evs.length - 5} 条` : ''}</div>` : '');
      tip.hidden = false;
      const left = (cx / cfg.width) * box.width;
      tip.style.left = `${Math.max(0, Math.min(left + 12, box.width - tip.offsetWidth - 4))}px`;
      tip.style.top = '4px';
    };
    svg.addEventListener('pointermove', show);
    svg.addEventListener('pointerdown', show);
    svg.addEventListener('pointerleave', () => { tip.hidden = true; cursor.setAttribute('visibility', 'hidden'); });
  }
}

// Week-by-week change grid: a row per group, a cell per week, green for cuts and orange for hikes.
export function weekHeatmap(weeks, rows, { range = 0, liveFrom = null } = {}) {
  const from = range && weeks.length > range ? weeks.length - range : 0;
  const ws = weeks.slice(from);
  const color = (v) => {
    if (v === null || v === undefined) return 'var(--heat-none)';
    if (Math.abs(v) < 0.05) return 'var(--heat-zero)';
    const a = Math.min(1, 0.3 + Math.abs(v) / 20).toFixed(2);
    return v < 0 ? `color-mix(in srgb, var(--down) ${a * 100}%, transparent)` : `color-mix(in srgb, var(--up) ${a * 100}%, transparent)`;
  };
  let lastMonth = '', lastAt = -99;
  const gap = narrow() ? 8 : 4;
  const head = ws.map((w, i) => {
    const m = w.slice(0, 7);
    let lab = '';
    if (m !== lastMonth && i - lastAt >= gap) { lab = `${+m.slice(5)}月`; lastAt = i; }
    lastMonth = m;
    return `<th class="hm-m">${lab}</th>`;
  }).join('');
  const lw = liveFrom ? weekStart(liveFrom) : null;
  const body = rows.map((r) => `<tr><th class="hm-name">${esc(r.name)}${r.note ? `<span class="hm-note">${esc(r.note)}</span>` : ''}</th>${ws.map((w, i) => {
    const v = r.wow[from + i];
    const label = `${r.name} · ${w} 当周：${v === null || v === undefined ? '无数据' : `${v > 0 ? '+' : ''}${v.toFixed(1)}%`}${lw && w < lw ? '（回溯）' : ''}`;
    return `<td title="${esc(label)}" style="background:${color(v)}"></td>`;
  }).join('')}</tr>`).join('');
  return `<div class="hmwrap"><table class="heat"><thead><tr><th></th>${head}</tr></thead><tbody>${body}</tbody></table></div>`;
}
