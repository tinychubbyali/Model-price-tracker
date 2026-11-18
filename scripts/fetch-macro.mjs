// Fetches macro indicators along the AI value chain into docs/data/macro.json.
// A source that fails keeps its previously stored points, so one outage never blanks the page.
// Env: SEC_CONTACT_EMAIL (SEC asks automated clients to identify themselves),
//      ALPHAVANTAGE_API_KEY (weekly stock prices). A missing one skips its series.
import { readFile, writeFile } from 'node:fs/promises';
import {
  LAYERS, SEGMENTS, parseAlphaVantage, priceMoves, quarterly, sumByQuarter, tokenPriceIndex,
} from './macro.mjs';

const DATA_DIR = new URL('../docs/data/', import.meta.url);
const MACRO = new URL('macro.json', DATA_DIR);
const QUARTERS_KEPT = 12;
const WEEKS_KEPT = 104;

const CAPEX_COMPANIES = [
  { id: 'msft', name: '微软', cik: '0000789019' },
  { id: 'googl', name: '谷歌', cik: '0001652044' },
  { id: 'amzn', name: '亚马逊', cik: '0001018724' },
  { id: 'meta', name: 'Meta', cik: '0001326801' },
  { id: 'orcl', name: '甲骨文', cik: '0001341439' },
];
const CAPEX_TAGS = ['PaymentsToAcquirePropertyPlantAndEquipment', 'PaymentsToAcquireProductiveAssets'];
const REVENUE_TAGS = ['Revenues', 'RevenueFromContractWithCustomerExcludingAssessedTax'];
const CHIPMAKERS = [
  { id: 'nvda', name: '英伟达', cik: '0001045810', note: '英伟达营收的大头来自数据中心 GPU，是 AI 算力需求最直接的晴雨表。' },
  { id: 'amd', name: 'AMD', cik: '0000002488', note: '英伟达之外的第二大 GPU 供应商，看算力供给是否在分散。' },
];
const STOCKS = [
  { id: 'nvda', name: '英伟达', symbol: 'NVDA' },
  { id: 'tsm', name: '台积电 (ADR)', symbol: 'TSM' },
  { id: 'avgo', name: '博通', symbol: 'AVGO' },
  { id: 'smh', name: '半导体 ETF (SMH)', symbol: 'SMH' },
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

const secEmail = process.env.SEC_CONTACT_EMAIL?.trim();
const avKey = process.env.ALPHAVANTAGE_API_KEY?.trim();

// Tries each XBRL tag and keeps the one whose quarterly data is most recent.
async function secQuarterly(cik, tags) {
  if (!secEmail) throw new Error('SEC_CONTACT_EMAIL not set');
  const headers = { 'User-Agent': `model-price-tracker ${secEmail}` };
  let best = null;
  for (const tag of tags) {
    const url = `https://data.sec.gov/api/xbrl/companyconcept/CIK${cik}/us-gaap/${tag}.json`;
    let points;
    try {
      points = quarterly((await getJson(url, headers)).units?.USD ?? []);
    } catch (err) {
      if (err.message === 'HTTP 404') continue;
      throw err;
    }
    if (points.length && (!best || points.at(-1).date > best.points.at(-1).date)) best = { tag, points };
  }
  if (!best) throw new Error('no quarterly data under any tag');
  return best.points.slice(-QUARTERS_KEPT);
}

async function weeklyCloses(symbol) {
  if (!avKey) throw new Error('ALPHAVANTAGE_API_KEY not set');
  const url = `https://www.alphavantage.co/query?function=TIME_SERIES_WEEKLY&symbol=${symbol}&apikey=${avKey}`;
  const body = await getJson(url);
  const points = parseAlphaVantage(body);
  // Rate-limit and error replies come back as HTTP 200 with a message instead of data.
  if (!points.length) throw new Error(body?.Note || body?.Information || body?.['Error Message'] || 'no data');
  return points.slice(-WEEKS_KEPT);
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

  for (const c of CHIPMAKERS) {
    await add(
      { id: `revenue-${c.id}`, layer: 'compute', name: `${c.name}季度营收`, unit: 'USD', freq: 'quarter',
        note: c.note, source: 'SEC EDGAR', sourceUrl: edgarUrl(c.cik) },
      () => secQuarterly(c.cik, REVENUE_TAGS),
    );
  }

  for (const c of CAPEX_COMPANIES) {
    await add(
      { id: `capex-${c.id}`, layer: 'capex', name: `${c.name}资本开支`, unit: 'USD', freq: 'quarter',
        group: 'capex', source: 'SEC EDGAR', sourceUrl: edgarUrl(c.cik) },
      () => secQuarterly(c.cik, CAPEX_TAGS),
    );
  }

  for (const s of STOCKS) {
    await add(
      { id: `stock-${s.id}`, layer: 'markets', name: `${s.name}股价`, unit: 'USD', freq: 'week',
        group: 'stocks', source: 'Alpha Vantage', sourceUrl: `https://www.alphavantage.co/` },
      () => weeklyCloses(s.symbol),
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

for (const seg of SEGMENTS) {
  const points = tokenPriceIndex(prices.models, today, seg.id);
  series.push({
    id: `token-index-${seg.id}`, layer: 'tokens', segment: seg.id, name: `${seg.name}：Token 价格中位数`,
    unit: 'USD/MTok', freq: 'day', note: `驱动因素：${seg.driver}。混合价格（输入:输出 = 3:1）取中位数。`,
    source: '本站价格数据', sourceUrl: null, points,
  });
}
for (const seg of SEGMENTS) {
  series.push({
    id: `token-moves-${seg.id}`, layer: 'tokens', segment: seg.id, kind: 'moves', name: `${seg.name}：每月调价次数`,
    unit: 'count', freq: 'month', source: '本站价格数据', sourceUrl: null,
    points: priceMoves(changes, prices.models, seg.id),
  });
}

await writeFile(
  MACRO,
  JSON.stringify({ updatedAt: new Date().toISOString(), layers: LAYERS, segments: SEGMENTS, series }, null, 1) + '\n',
);
const stale = series.filter((s) => s.stale).map((s) => s.id);
report(stale.length ? 'warning' : 'notice',
  `${series.length} series written${stale.length ? `; kept previous data for ${stale.join(', ')}` : ''}`);
