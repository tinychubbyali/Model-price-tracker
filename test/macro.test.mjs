import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  benchmarkIndex, calendarQuarter, parseAlphaVantage, priceMoves, quarterly, segmentOf, segmentOfSlug, sumByQuarter,
  tokenPriceIndex, weeklyUsage,
} from '../scripts/macro.mjs';

test('quarterly recovers single quarters from year-to-date cash-flow facts', () => {
  const facts = [
    { start: '2025-01-01', end: '2025-03-31', val: 10, form: '10-Q', filed: '2025-04-30' },
    { start: '2025-01-01', end: '2025-06-30', val: 25, form: '10-Q', filed: '2025-07-30' },
    { start: '2025-01-01', end: '2025-09-30', val: 45, form: '10-Q', filed: '2025-10-30' },
    { start: '2025-01-01', end: '2025-12-31', val: 70, form: '10-K', filed: '2026-02-01' },
    // A later restatement of Q1 wins over the original filing.
    { start: '2025-01-01', end: '2025-03-31', val: 11, form: '10-K', filed: '2026-02-01' },
    { start: '2025-01-01', end: '2025-03-31', val: 99, form: '8-K', filed: '2026-03-01' },
  ];
  assert.deepEqual(quarterly(facts), [
    { date: '2025-03-31', value: 11 },
    { date: '2025-06-30', value: 14 },
    { date: '2025-09-30', value: 20 },
    { date: '2025-12-31', value: 25 },
  ]);
});

test('sumByQuarter aligns fiscal quarters and drops incomplete ones', () => {
  assert.equal(calendarQuarter('2025-08-31'), '2025Q3');
  const a = { points: [{ date: '2025-06-30', value: 1 }, { date: '2025-09-30', value: 2 }] };
  const b = { points: [{ date: '2025-08-31', value: 10 }] };
  assert.deepEqual(sumByQuarter([a, b]), [{ date: '2025Q3', value: 12 }]);
});

test('parseAlphaVantage reads weekly closes oldest first and ignores junk', () => {
  const body = { 'Weekly Time Series': {
    '2026-11-13': { '4. close': '190.5' },
    '2026-11-06': { '4. close': '180.25' },
    '2026-10-30': { '4. close': 'n/a' },
  } };
  assert.deepEqual(parseAlphaVantage(body), [{ date: '2026-11-06', value: 180.25 }, { date: '2026-11-13', value: 190.5 }]);
  assert.deepEqual(parseAlphaVantage({ Note: 'rate limited' }), []);
});

test('segmentOf splits specialised variants before grouping by vendor', () => {
  assert.equal(segmentOf({ provider: 'openai', model: 'gpt-5' }), 'frontier');
  assert.equal(segmentOf({ provider: 'deepseek', model: 'deepseek-v4-pro' }), 'china');
  assert.equal(segmentOf({ provider: 'openai', model: 'gpt-audio' }), 'multimodal');
  assert.equal(segmentOf({ provider: 'dashscope', model: 'qwen3-vl-32b-instruct' }), 'multimodal');
  assert.equal(segmentOf({ provider: 'mistral', model: 'codestral-latest' }), 'niche');
});

test('tokenPriceIndex follows listings, removals and price changes', () => {
  const models = {
    a: { firstSeen: '2026-01-01', history: [{ date: '2026-01-01', input: 1, output: 5 }, { date: '2026-01-03', input: 1, output: 1 }] },
    b: { firstSeen: '2026-01-02', removed: '2026-01-03', history: [{ date: '2026-01-02', input: 3, output: 9 }] },
  };
  assert.deepEqual(tokenPriceIndex(models, '2026-01-03'), [
    { date: '2026-01-01', value: 2 },
    { date: '2026-01-02', value: 3.25 },
    { date: '2026-01-03', value: 1 },
  ]);
});

test('priceMoves counts cuts and hikes per month', () => {
  const p = (input, output) => ({ input, output, cacheRead: null });
  const changes = [
    { date: '2026-11-02', type: 'changed', before: p(2, 8), after: p(1, 4) },
    { date: '2026-11-09', type: 'changed', before: p(1, 4), after: p(1, 5) },
    { date: '2026-11-09', type: 'added', after: p(1, 1) },
  ];
  assert.deepEqual(priceMoves(changes), [{ date: '2026-11', cuts: 1, hikes: 1 }]);
  const tagged = changes.map((c, i) => ({ ...c, id: i ? 'deepseek/deepseek-chat' : 'openai/gpt-5' }));
  const models = {
    'openai/gpt-5': { provider: 'openai', model: 'gpt-5' },
    'deepseek/deepseek-chat': { provider: 'deepseek', model: 'deepseek-chat' },
  };
  assert.deepEqual(priceMoves(tagged, models, 'china'), [{ date: '2026-11', cuts: 0, hikes: 1 }]);
});

test('segmentOfSlug sorts OpenRouter slugs by vendor and variant', () => {
  assert.equal(segmentOfSlug('anthropic/claude-sonnet-4.5'), 'frontier');
  assert.equal(segmentOfSlug('deepseek/deepseek-v3.2:free'), 'china');
  assert.equal(segmentOfSlug('meta-llama/llama-4-maverick'), 'open');
  assert.equal(segmentOfSlug('openai/gpt-oss-120b'), 'open');
  assert.equal(segmentOfSlug('qwen/qwen3-coder'), 'niche');
  assert.equal(segmentOfSlug('other'), null);
});

test('weeklyUsage totals by week and segment, other counts only in the total', () => {
  const rows = [
    { date: '2026-11-02', model_permaslug: 'openai/gpt-5', total_tokens: '100' },
    { date: '2026-11-02', model_permaslug: 'other', total_tokens: '50' },
    { date: '2026-11-09', model_permaslug: 'openai/gpt-5', total_tokens: '120' },
    { date: '2026-11-09', model_permaslug: 'deepseek/deepseek-v3.2', total_tokens: '80' },
  ];
  const u = weeklyUsage(rows);
  assert.deepEqual(u.total, [{ date: '2026-11-02', value: 150 }, { date: '2026-11-09', value: 200 }]);
  assert.deepEqual(u.bySegment.china, [{ date: '2026-11-09', value: 80 }]);
  assert.deepEqual(u.top.map((t) => t.slug), ['openai/gpt-5', 'deepseek/deepseek-v3.2']);
});

test('benchmarkIndex keys Artificial Analysis scores by a loose model name', () => {
  const idx = benchmarkIndex([
    { source: 'artificial-analysis', model_permaslug: 'anthropic/claude-sonnet-4.5', display_name: 'Claude Sonnet 4.5', intelligence_index: 63 },
    { source: 'design-arena', model_permaslug: 'x/y', elo: 1200 },
  ]);
  assert.deepEqual(Object.keys(idx), ['claude-sonnet-4-5']);
  assert.equal(idx['claude-sonnet-4-5'].scores.intelligence, 63);
});
