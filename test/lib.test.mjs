import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseMas } from '../scripts/fx.mjs';
import { applySnapshot, normalize, sanityCheck } from '../scripts/lib.mjs';

const raw = {
  'gpt-4o': { litellm_provider: 'openai', mode: 'chat', input_cost_per_token: 2.5e-6, output_cost_per_token: 1e-5 },
  'gpt-4o-2024-08-06': { litellm_provider: 'openai', mode: 'chat', input_cost_per_token: 2.5e-6, output_cost_per_token: 1e-5 },
  'ft:gpt-4o': { litellm_provider: 'openai', mode: 'chat', input_cost_per_token: 1, output_cost_per_token: 1 },
  'text-embedding-3-small': { litellm_provider: 'openai', mode: 'embedding', input_cost_per_token: 2e-8 },
  'azure/gpt-4o': { litellm_provider: 'azure', mode: 'chat', input_cost_per_token: 1, output_cost_per_token: 1 },
  'dashscope/qwen-max': { litellm_provider: 'dashscope', mode: 'chat', input_cost_per_token: 1.6e-6, output_cost_per_token: 6.4e-6 },
  'dashscope/deepseek-v4-pro': { litellm_provider: 'dashscope', mode: 'chat', input_cost_per_token: 1e-6, output_cost_per_token: 1e-6 },
  'deepseek/deepseek-chat': {
    litellm_provider: 'deepseek', mode: 'chat', input_cost_per_token: 2.8e-7, output_cost_per_token: 4.2e-7,
    cache_read_input_token_cost: 2.8e-8,
  },
};

test('normalize keeps only vendor chat models, priced per million tokens', () => {
  const out = normalize(raw);
  assert.deepEqual(Object.keys(out).sort(), ['dashscope/qwen-max', 'deepseek/deepseek-chat', 'openai/gpt-4o']);
  assert.equal(out['openai/gpt-4o'].input, 2.5);
  assert.equal(out['openai/gpt-4o'].output, 10);
  assert.equal(out['deepseek/deepseek-chat'].input, 0.28);
  assert.equal(out['deepseek/deepseek-chat'].cacheRead, 0.028);
});

test('applySnapshot records changes, removals and restorations', () => {
  const day1 = normalize(raw);
  const s1 = applySnapshot({}, day1, '2026-01-01');
  assert.equal(s1.changes.length, 3);

  const day2 = structuredClone(day1);
  day2['openai/gpt-4o'].input = 2;
  delete day2['dashscope/qwen-max'];
  const s2 = applySnapshot(s1.models, day2, '2026-01-02');
  assert.deepEqual(s2.changes.map((c) => [c.id, c.type]), [
    ['openai/gpt-4o', 'changed'],
    ['dashscope/qwen-max', 'removed'],
  ]);
  assert.equal(s2.models['openai/gpt-4o'].history.length, 2);
  assert.equal(s2.models['dashscope/qwen-max'].removed, '2026-01-02');

  const s3 = applySnapshot(s2.models, day1, '2026-01-03');
  assert.deepEqual(s3.changes.map((c) => c.type), ['changed', 'restored']);
  assert.equal(s3.models['dashscope/qwen-max'].removed, undefined);

  const s4 = applySnapshot(s3.models, day1, '2026-01-04');
  assert.equal(s4.changes.length, 0);
});

test('sanityCheck rejects a snapshot that lost most of a provider', () => {
  const prev = applySnapshot({}, normalize(raw), '2026-01-01').models;
  assert.deepEqual(sanityCheck(prev, normalize(raw)), []);
  const broken = normalize(raw);
  delete broken['openai/gpt-4o'];
  assert.match(sanityCheck(prev, broken)[0], /openai/);
});

test('parseMas converts MAS quotes to units per USD', () => {
  const fx = parseMas({ result: { records: [{ end_of_day: '2026-10-24', usd_sgd: '1.2950', cny_sgd_100: '18.20' }] } });
  assert.equal(fx.date, '2026-10-24');
  assert.equal(fx.rates.SGD, 1.295);
  assert.equal(fx.rates.CNY, 7.1154);
  assert.equal(parseMas({ result: { records: [] } }), null);
  assert.equal(parseMas({ result: { records: [{ end_of_day: '2026-10-24', usd_sgd: null, cny_sgd_100: '18.2' }] } }), null);
});
