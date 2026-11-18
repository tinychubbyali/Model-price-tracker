const STATUS = { pending: '待观察', support: '验证', neutral: '中性', against: '证伪' };
const $ = (sel) => document.querySelector(sel);
let data;

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

function safeUrl(u) {
  return /^https?:\/\//.test(u) ? u : '#';
}

function renderGroups() {
  const q = $('#search').value.trim().toLowerCase();
  const group = $('#group').value;
  let shown = 0;

  $('#groups').innerHTML = data.groups
    .filter((g) => !group || g.id === group)
    .map((g) => {
      const rows = g.indicators.filter((i) =>
        !q || [i.name, i.hypothesis, i.support, i.against].some((t) => t.toLowerCase().includes(q)));
      if (!rows.length) return '';
      shown += rows.length;
      return `
        <section class="card">
          <h2>${esc(g.id)}. ${esc(g.name)} <span class="unit">${esc(g.thesis)}</span></h2>
          <div class="table-scroll">
            <table class="plain macro">
              <thead><tr><th>指标</th><th>待检验的判断</th><th>支持信号</th><th>反向信号</th><th>官方来源</th><th>频率</th><th>状态</th></tr></thead>
              <tbody>${rows.map((i) => `
                <tr>
                  <td><strong>${esc(i.name)}</strong></td>
                  <td>${esc(i.hypothesis)}</td>
                  <td class="down">${esc(i.support)}</td>
                  <td class="up">${esc(i.against)}</td>
                  <td>${i.sources.map((s) => `<a href="${esc(safeUrl(s.url))}" rel="noopener" target="_blank">${esc(s.label)}</a>`).join('<br>')}</td>
                  <td>${esc(i.freq)}</td>
                  <td><span class="status status-${esc(i.status)}">${esc(STATUS[i.status] ?? i.status)}</span>${i.log.length ? `<div class="tag">${esc(i.log.at(-1).date)} ${esc(i.log.at(-1).note)}</div>` : ''}</td>
                </tr>`).join('')}
              </tbody>
            </table>
          </div>
        </section>`;
    })
    .join('');
  $('#noResults').hidden = shown > 0;
}

async function init() {
  data = await (await fetch('data/macro.json')).json();
  const n = data.groups.reduce((a, g) => a + g.indicators.length, 0);
  $('#meta').textContent = `${data.groups.length} 个主题 · ${n} 个指标 · 最后更新 ${data.updatedAt}`;
  $('#group').insertAdjacentHTML('beforeend',
    data.groups.map((g) => `<option value="${esc(g.id)}">${esc(g.id)}. ${esc(g.name)}</option>`).join(''));
  $('#triggers').innerHTML = data.triggers.map((t) => `<li>${esc(t)}</li>`).join('');
  $('#calendar').innerHTML = data.calendar
    .map((r) => `<tr>${r.map((c) => `<td>${esc(c)}</td>`).join('')}</tr>`).join('');
  $('#search').addEventListener('input', renderGroups);
  $('#group').addEventListener('change', renderGroups);
  renderGroups();
}

init().catch((e) => { $('#meta').textContent = `加载失败：${e.message}`; });
