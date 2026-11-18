// Fetches macro indicators along the AI value chain into docs/data/macro.json.
// A source that fails keeps its previously stored points, so one outage never blanks the page.
import { readFile, writeFile } from 'node:fs/promises';
import {
  LAYERS, parseStooq, priceMoves, quarterly, sumByQuarter, tokenPriceIndex,
} from './macro.mjs';

const DATA_DIR = new URL('../docs/data/', import.meta.url);
const MACRO = new URL('macro.json', DATA_DIR);
// SEC asks automated clients to identify themselves in the User-Agent.
const SEC_HEADERS = { 'User-Agent': 'model-price-tracker github.com/tinychubbyali/Model-price-tracker' };
const QUARTERS_KEPT = 12;

const CAPEX_COMPANIES = [
  { id: 'msft', name: '微软', cik: '0000789019' },
  { id: 'googl', name: '谷歌', cik: '0001652044' },
  { id: 'amzn', name: '亚马逊', cik: '0001018724' },
  { id: 'meta', name: 'Meta', cik: '0001326801' },
  { id: 'orcl', name: '甲骨文', cik: '0001341439' },
];
const CAPEX_TAGS = ['PaymentsToAcquirePropertyPlantAndEquipment', 'PaymentsToAcquireProductiveAssets'];
const REVENUE_TAGS = ['Revenues', 'RevenueFromContractWithCustomerExcludingAssessedTax'];
const STOCKS = [
  { id: 'nvda', name: '英伟达', symbol: 'nvda.us' },
  { id: 'tsm', name: '台积电 (ADR)', symbol: 'tsm.us' },
  { id: 'avgo', name: '博通', symbol: 'avgo.us' },
  { id: 'smh', name: '半导体 ETF (SMH)', symbol: 'smh.us' },
];

function report(level, msg) {
  (level === 'warning' ? console.warn : console.log)(msg);
  if (process.env.GITHUB_ACTIONS) console.log(`::${level} title=Macro::${msg}`);
}

async function readJson(url, fallback) {
  try {
    return JSON.parse(await readFile(url, 'utf8'));
  } catch (err) {
    if (err.code === 'ENOENT') return fallback;
    throw err;
  }
}

async function getJson(url, headers) {
  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

// Tries each XBRL tag and keeps the one whose quarterly data is most recent.
async function secQuarterly(cik, tags) {
  let best = null;
  for (const tag of tags) {
    const url = `https://data.sec.gov/api/xbrl/companyconcept/CIK${cik}/us-gaap/${tag}.json`;
    let points;
    try {
      points = quarterly((await getJson(url, SEC_HEADERS)).units?.USD ?? []);
    } catch (err) {
      if (err.message === 'HTTP 404') continue;
      throw err;
    }
    if (points.length && (!best || points.at(-1).date > best.points.at(-1).date)) best = { tag, points };
  }
  if (!best) throw new Error('no quarterly data under any tag');
  return best.points.slice(-QUARTERS_KEPT);
}

const edgarUrl = (cik) => `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${cik}&type=10-Q`;

async function buildSeries() {
  const series = [];
  const add = async (meta, load) => {
    try {
      series.push({ ...meta, points: await load() });
    } catch (err) {
      report('warning', `${meta.id} failed: ${err.cause?.code ?? err.message}`);
      series.push({ ...meta, points: null });
    }
  };

  await add(
    { id: 'nvda-revenue', layer: 'compute', name: '英伟达季度营收', unit: 'USD', freq: 'quarter',
      note: '英伟达营收的大头来自数据中心 GPU，是 AI 算力需求最直接的晴雨表。',
      source: 'SEC EDGAR', sourceUrl: edgarUrl('0001045810') },
    () => secQuarterly('0001045810', REVENUE_TAGS),
  );

  for (const c of CAPEX_COMPANIES) {
    await add(
      { id: `capex-${c.id}`, layer: 'capex', name: `${c.name}资本开支`, unit: 'USD', freq: 'quarter',
        group: 'capex', source: 'SEC EDGAR', sourceUrl: edgarUrl(c.cik) },
      () => secQuarterly(c.cik, CAPEX_TAGS),
    );
  }

  const twoYearsAgo = new Date(Date.now() - 2 * 365 * 864e5).toISOString().slice(0, 10).replaceAll('-', '');
  for (const s of STOCKS) {
    await add(
      { id: `stock-${s.id}`, layer: 'markets', name: `${s.name}股价`, unit: 'USD', freq: 'week',
        group: 'stocks', source: 'Stooq', sourceUrl: `https://stooq.com/q/?s=${s.symbol}` },
      async () => {
        const res = await fetch(`https://stooq.com/q/d/l/?s=${s.symbol}&i=w&d1=${twoYearsAgo}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const points = parseStooq(await res.text());
        if (!points.length) throw new Error('empty or unexpected CSV');
        return points;
      },
    );
  }
  return series;
}

const previous = await readJson(MACRO, { series: [] });
const prices = await readJson(new URL('prices.json', DATA_DIR), { models: {} });
const changes = await readJson(new URL('changes.json', DATA_DIR), []);
const today = new Date().toISOString().slice(0, 10);

const series = await buildSeries();
for (const s of series) {
  if (s.points) continue;
  s.points = previous.series.find((p) => p.id === s.id)?.points ?? [];
  s.stale = true;
}

const capex = series.filter((s) => s.group === 'capex');
if (capex.every((s) => s.points.length)) {
  series.splice(series.indexOf(capex[0]), 0, {
    id: 'capex-total', layer: 'capex', name: '五大云厂商资本开支合计', unit: 'USD', freq: 'quarter',
    note: '微软、谷歌、亚马逊、Meta、甲骨文合计，按财季结束月份归入日历季度。',
    source: 'SEC EDGAR（汇总计算）', sourceUrl: null,
    points: sumByQuarter(capex).slice(-QUARTERS_KEPT),
  });
}

series.push(
  { id: 'token-index', layer: 'tokens', name: 'Token 价格中位数', unit: 'USD/MTok', freq: 'day',
    note: '所有在售模型的混合价格（输入:输出 = 3:1）取中位数，每百万 tokens。',
    source: '本站价格数据', sourceUrl: null, points: tokenPriceIndex(prices.models, today) },
  { id: 'token-moves', layer: 'tokens', name: '每月调价次数', unit: 'count', freq: 'month', kind: 'moves',
    note: '降价和涨价分开统计，只计已有模型的价格变动。',
    source: '本站价格数据', sourceUrl: null, points: priceMoves(changes) },
);

await writeFile(MACRO, JSON.stringify({ updatedAt: new Date().toISOString(), layers: LAYERS, series }, null, 1) + '\n');
const stale = series.filter((s) => s.stale).map((s) => s.id);
report(stale.length ? 'warning' : 'notice',
  `${series.length} series written${stale.length ? `; kept previous data for ${stale.join(', ')}` : ''}`);
