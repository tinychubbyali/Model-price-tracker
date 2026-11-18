import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MM, TEXT, anomalies, excluded, mergeBackfill, priceMoves, updateReview, weekOf, weeksBetween, weeklySeries } from '../scripts/history.mjs';

const p = (date, input, output) => ({ date, input, output, cacheRead: null });
const model = (provider, name, history, extra = {}) => ({ provider, model: name, firstSeen: history[0].date, history, ...history.at(-1), ...extra });

test('weeks run Monday to Sunday', () => {
  assert.equal(weekOf('2026-11-18'), '2026-11-16'); // Wednesday
  assert.equal(weekOf('2026-11-16'), '2026-11-16');
  assert.equal(weekOf('2026-11-22'), '2026-11-16'); // Sunday
  assert.deepEqual(weeksBetween('2026-11-01', '2026-11-18'), ['2026-10-26', '2026-11-02', '2026-11-09', '2026-11-16']);
});

test('mergeBackfill joins old history without a fake change at the seam', () => {
  const back = {
    'openai/a': model('openai', 'a', [p('2026-01-01', 2, 8), p('2026-03-01', 1, 4)]),
    'openai/gone': model('openai', 'gone', [p('2026-01-01', 1, 1)]),
    'openai/b': model('openai', 'b', [p('2026-01-01', 3, 9)]),
  };
  const live = {
    'openai/a': model('openai', 'a', [p('2026-10-27', 1, 4)]),
    'openai/b': model('openai', 'b', [p('2026-10-27', 2, 6)]),
  };
  const { models, seam } = mergeBackfill(back, live, '2026-10-27', TEXT);
  assert.deepEqual(models['openai/a'].history.map((h) => h.date), ['2026-01-01', '2026-03-01']);
  assert.equal(models['openai/a'].firstSeen, '2026-01-01');
  assert.equal(models['openai/gone'].removed, '2026-10-27');
  assert.deepEqual(seam.map((c) => `${c.type}:${c.id}`).sort(), ['changed:openai/b', 'removed:openai/gone']);
  assert.ok(seam.every((c) => c.backfill));
});

test('anomalies flag bulk same-price edits, flip-flops and huge jumps', () => {
  const ch = (id, date, b, a) => ({ type: 'changed', id, date, before: { input: b[0], output: b[1], cacheRead: null }, after: { input: a[0], output: a[1], cacheRead: null } });
  const bulk = [1, 2, 3, 4, 5].map((i) => ch(`xai/m${i}`, '2026-08-29', [i, i * 5], [1.25, 2.5]));
  const flip = [ch('openai/x', '2026-01-01', [1, 4], [2, 8]), ch('openai/x', '2026-01-15', [2, 8], [1, 4])];
  const jump = [ch('moonshot/k', '2026-02-01', [30, 30], [0.6, 2.5])];
  const real = [ch('deepseek/chat', '2026-01-17', [0.6, 1.7], [0.28, 0.42])];
  const alias = [ch('gemini/gemini-flash-latest', '2026-01-17', [0.3, 2.5], [0.75, 3.75])];
  const moves = priceMoves([...bulk, ...flip, ...jump, ...real, ...alias], TEXT);
  assert.equal(moves.length, 9); // the alias is not a price move
  const f = anomalies(moves, TEXT);
  assert.deepEqual(f.get('xai/m1@2026-08-29'), ['bulk']);
  assert.deepEqual(f.get('openai/x@2026-01-15'), ['flipflop']);
  assert.ok(f.get('moonshot/k@2026-02-01').includes('magnitude'));
  assert.equal(f.get('deepseek/chat@2026-01-17'), undefined);
});

test('review keeps notes on existing items and adds new ones as pending', () => {
  const c = { type: 'changed', id: 'google/veo', date: '2026-03-13', before: 3.75, after: 2 };
  const prev = { items: { 'google/veo@2026-03-13': { id: 'google/veo', status: 'confirmed', announced: '2026-03-04', flags: [] } } };
  const { review, added } = updateReview(prev, [c, { ...c, date: '2026-09-05', before: 2, after: 1.5 }], new Map(), 'mm', '2026-11-18');
  assert.equal(added, 1);
  assert.equal(review.items['google/veo@2026-03-13'].announced, '2026-03-04');
  assert.equal(review.items['google/veo@2026-09-05'].status, 'pending');
  assert.equal(excluded({ flags: ['bulk'], status: 'pending' }), true);
  assert.equal(excluded({ flags: ['bulk'], status: 'confirmed' }), false);
  assert.equal(excluded({ flags: [], status: 'error' }), true);
});

test('weekly chain index follows same-model moves, ignores new models and flagged edits', () => {
  const mm = (id, modality, history) => ({ modality, vendor: id.split('/')[0], model: id.split('/')[1], firstSeen: history[0].date, history, std: history.at(-1).std });
  const models = {
    'g/v1': mm('g/v1', 'video', [{ date: '2026-01-05', std: 2 }, { date: '2026-01-14', std: 1 }]),
    'g/v2': mm('g/v2', 'video', [{ date: '2026-01-05', std: 1 }]),
    'g/cheap': mm('g/cheap', 'video', [{ date: '2026-01-21', std: 0.1 }]), // new, cheaper model
    'x/bad': mm('x/bad', 'video', [{ date: '2026-01-05', std: 1 }, { date: '2026-01-21', std: 9 }]),
  };
  const review = { 'x/bad@2026-01-21': { flags: ['magnitude'], status: 'pending', date: '2026-01-21' } };
  const weeks = weeksBetween('2026-01-05', '2026-01-25');
  const [video] = weeklySeries(models, [{ id: 'video' }], MM, { weeks, review });
  assert.equal(video.chain[0], 100);
  // Week 2: v1 halves, v2 and bad flat → geometric mean of (0.5, 1, 1).
  assert.equal(video.chain[1], +(100 * Math.cbrt(0.5)).toFixed(2));
  // Week 3: the new model and the flagged jump leave the index unchanged.
  assert.equal(video.chain[2], video.chain[1]);
  assert.deepEqual(video.count, [3, 3, 4]);
  assert.equal(video.median[2], 1);
  // Announced earlier: the v1 cut moves into the first week's comparison… which has no prior week, so it lands as the start level.
  const shifted = weeklySeries(models, [{ id: 'video' }], MM, { weeks, review: { 'g/v1@2026-01-14': { announced: '2026-01-07', flags: [], status: 'confirmed', date: '2026-01-14' } } });
  assert.equal(shifted[0].chain[1], 100);
});
