import assert from 'node:assert/strict';
import { test } from 'node:test';
import { calendarQuarter, parseStooq, priceMoves, quarterly, sumByQuarter, tokenPriceIndex } from '../scripts/macro.mjs';

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

test('parseStooq reads close prices and ignores junk', () => {
  const csv = 'Date,Open,High,Low,Close,Volume\n2026-11-06,1,2,0.5,1.5,100\n2026-11-13,1,2,1,N/D,0\n';
  assert.deepEqual(parseStooq(csv), [{ date: '2026-11-06', value: 1.5 }]);
  assert.deepEqual(parseStooq('No data'), []);
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
});
