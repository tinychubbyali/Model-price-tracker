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
export function lineChart(series, { width = 520, height = 200, format = String, step = false, money = false } = {}) {
  const live = series.filter((s) => s.points.length);
  if (!live.length) return '<p class="empty">暂无数据</p>';
  const L = 56, R = 8, T = 10, B = 24;
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
  const lines = live.map((s) => {
    const color = SERIES_COLORS[series.indexOf(s) % SERIES_COLORS.length];
    const lastP = s.points.at(-1);
    return `<path d="${path(s.points)}" fill="none" stroke="${color}" stroke-width="2"/>` +
      `<circle cx="${x(lastP.date)}" cy="${y(lastP.value)}" r="4" fill="${color}" stroke="var(--surface-1)" stroke-width="2"/>`;
  }).join('');
  const payload = esc(JSON.stringify({ L, R, width, t0, t1, money, series: live.map((s) => ({ name: s.name, color: SERIES_COLORS[series.indexOf(s) % SERIES_COLORS.length], points: s.points.map((p) => [toTime(p.date), p.value, label(p.date)]) })) }));
  return `<div class="chart" data-hover="${payload}"><svg class="chart-svg" viewBox="0 0 ${width} ${height}" role="img">
    ${ticks.map((v) => `<line class="grid" x1="${L}" x2="${width - R}" y1="${y(v)}" y2="${y(v)}"/><text x="${L - 6}" y="${y(v) + 4}" text-anchor="end">${esc(format(v))}</text>`).join('')}
    ${lines}
    <text x="${L}" y="${height - 6}">${esc(label(new Date(t0).toISOString()))}</text>
    <text x="${width - R}" y="${height - 6}" text-anchor="end">${esc(label(new Date(t1).toISOString()))}</text>
    <line class="cursor" y1="${T}" y2="${height - B}" visibility="hidden"/>
  </svg><div class="tooltip" hidden></div></div>`;
}

export function legend(series) {
  return `<div class="legend">${series.filter((s) => s.points.length).map((s) =>
    `<span><i style="background:${SERIES_COLORS[series.indexOf(s) % SERIES_COLORS.length]}"></i>${esc(s.name)}</span>`).join('')}</div>`;
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
