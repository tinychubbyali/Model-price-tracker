// Exchange rates for displaying USD list prices in other currencies.
// Primary source is the Monetary Authority of Singapore (MAS) daily end-of-period rates;
// a public aggregator is used only if MAS is unreachable.

export const MAS_URL =
  'https://eservices.mas.gov.sg/api/action/datastore/search.json' +
  '?resource_id=95932927-c8bc-4e7a-b484-68a66a24edfe&limit=1&sort=end_of_day%20desc' +
  '&fields=end_of_day,usd_sgd,cny_sgd_100';
export const MAS_PAGE = 'https://eservices.mas.gov.sg/statistics/msb/ExchangeRates.aspx';
const FALLBACK_URL = 'https://open.er-api.com/v6/latest/USD';

const positive = (v) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
};

// MAS quotes SGD per 1 USD and SGD per 100 CNY; convert both to "units per 1 USD".
export function parseMas(body) {
  const r = body?.result?.records?.[0];
  const sgd = positive(r?.usd_sgd);
  const sgdPer100Cny = positive(r?.cny_sgd_100);
  if (!r?.end_of_day || !sgd || !sgdPer100Cny) return null;
  return {
    date: r.end_of_day,
    source: MAS_PAGE,
    rates: { SGD: sgd, CNY: Math.round((sgd / (sgdPer100Cny / 100)) * 1e4) / 1e4 },
  };
}

async function fromMas() {
  const res = await fetch(MAS_URL, { headers: { 'User-Agent': 'model-price-tracker' } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const fx = parseMas(await res.json());
  if (!fx) throw new Error('unexpected response shape');
  return fx;
}

async function fromFallback() {
  const res = await fetch(FALLBACK_URL);
  const body = await res.json();
  const SGD = positive(body?.rates?.SGD);
  const CNY = positive(body?.rates?.CNY);
  if (!SGD || !CNY) throw new Error('unexpected response shape');
  return { date: new Date().toISOString().slice(0, 10), source: 'https://open.er-api.com', rates: { SGD, CNY } };
}

// Returns fresh rates, or the previously stored ones if every source fails.
export async function loadFx(previous) {
  for (const [name, load] of [['MAS', fromMas], ['fallback', fromFallback]]) {
    try {
      const fx = await load();
      console.log(`FX from ${name}:`, fx.date, fx.rates);
      return fx;
    } catch (err) {
      console.warn(`FX source ${name} failed: ${err.message}`);
    }
  }
  console.warn('All FX sources failed; keeping previous rates.');
  return previous;
}
