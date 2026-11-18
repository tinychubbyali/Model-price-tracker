import assert from 'node:assert/strict';
import { test } from 'node:test';
import { applyMultimodal, normalizeManual, normalizeMultimodal, sanityCheckMultimodal, standardPrice, tierOf } from '../scripts/multimodal.mjs';

const raw = {
  'volcengine/doubao-seedance-2-0-260128': {
    litellm_provider: 'volcengine', mode: 'video_generation',
    output_cost_per_second: 0.142, output_cost_per_second_480p: 0.066, output_cost_per_second_720p: 0.142, output_cost_per_second_1080p: 0.354,
  },
  'fal_ai/bytedance/seedance-2.0/text-to-video': { litellm_provider: 'fal_ai', mode: 'video_generation', output_cost_per_second: 0.3 },
  'openai/sora-2': { litellm_provider: 'openai', mode: 'video_generation', output_cost_per_video_per_second: 0.1 },
  'sora-2': { litellm_provider: 'openai', mode: 'video_generation', output_cost_per_video_per_second: 0.1 },
  'gemini/veo-3.1-generate-preview': { litellm_provider: 'gemini', mode: 'video_generation', output_cost_per_second: 0.4 },
  'gemini/veo-3.1-generate-001': { litellm_provider: 'gemini', mode: 'video_generation', output_cost_per_second: 0.4 },
  'elevenlabs/eleven_v3': { litellm_provider: 'elevenlabs', mode: 'audio_speech', input_cost_per_character: 8e-5 },
  'gpt-4o-mini-tts': { litellm_provider: 'openai', mode: 'audio_speech', input_cost_per_token: 6e-7, output_cost_per_second: 0.00025 },
  'gpt-image-2': { litellm_provider: 'openai', mode: 'image_generation', output_cost_per_image_token: 3e-5 },
  '1024-x-1024/gpt-image-1.5': { litellm_provider: 'openai', mode: 'image_generation', input_cost_per_image: 0.009 },
  'gemini/gemini-3-pro-image': { litellm_provider: 'gemini', mode: 'image_generation', output_cost_per_image: 0.134, output_cost_per_image_token: 1.2e-4 },
  'whisper-1': { litellm_provider: 'openai', mode: 'audio_transcription', input_cost_per_second: 1e-4 },
  'deepgram/nova-3': { litellm_provider: 'deepgram', mode: 'audio_transcription', input_cost_per_second: 7.167e-5 },
  'deepgram/nova-3-medical': { litellm_provider: 'deepgram', mode: 'audio_transcription', input_cost_per_second: 8.667e-5 },
  'gemini/lyria-3.5-pro-preview': { litellm_provider: 'gemini', mode: 'chat', output_cost_per_image: 0.08, output_cost_per_token: 0 },
  'gpt-4o': { litellm_provider: 'openai', mode: 'chat', input_cost_per_token: 2.5e-6, output_cost_per_token: 1e-5 },
};

test('normalizeMultimodal keeps first-party models, one entry per model', () => {
  const out = normalizeMultimodal(raw);
  assert.deepEqual(Object.keys(out).sort(), [
    'bytedance/doubao-seedance-2-0', 'deepgram/nova-3', 'elevenlabs/eleven_v3', 'google/gemini-3-pro-image',
    'google/lyria-3.5-pro', 'google/veo-3.1-generate', 'openai/gpt-4o-mini-tts', 'openai/gpt-image-2', 'openai/sora-2', 'openai/whisper-1',
  ]);
  const sd = out['bytedance/doubao-seedance-2-0'];
  assert.equal(sd.modality, 'video');
  assert.equal(sd.std, 0.71); // 720p × 5 seconds
  assert.deepEqual(sd.native, { perSecond: 0.142, '480p': 0.066, '720p': 0.142, '1080p': 0.354 });
  assert.equal(out['openai/sora-2'].std, 0.5);
  assert.equal(out['elevenlabs/eleven_v3'].std, 0.072); // 900 characters
  assert.equal(out['openai/gpt-4o-mini-tts'].std, 0.015);
  assert.equal(out['openai/whisper-1'].std, 0.36);
  assert.equal(out['google/lyria-3.5-pro'].modality, 'music');
  // Per-image price beats the token estimate when both exist.
  assert.equal(out['google/gemini-3-pro-image'].std, 0.134);
  assert.equal(out['google/gemini-3-pro-image'].estimate, false);
  assert.equal(out['openai/gpt-image-2'].estimate, true);
  assert.equal(out['openai/gpt-image-2'].std, 0.1248);
});

test('standardPrice and tierOf', () => {
  assert.deepEqual(standardPrice('video', { perSecond: 0.4 }), { std: 2, estimate: false });
  assert.deepEqual(standardPrice('tts', { perAudioToken: 1e-5 }), { std: 0.0192, estimate: true });
  assert.equal(tierOf('gemini-3-pro-image'), 'flagship'); // "gemini" contains "mini" but is not a light model
  assert.equal(tierOf('veo-3.1-lite-generate'), 'light');
  assert.equal(tierOf('eleven_flash_v2_5'), 'fast');
  assert.equal(tierOf('tts-1'), 'light');
});

test('applyMultimodal records history with native prices', () => {
  const day1 = normalizeMultimodal(raw);
  const s1 = applyMultimodal({}, day1, '2026-11-18');
  assert.equal(s1.models['openai/sora-2'].history.length, 1);

  const day2 = structuredClone(day1);
  day2['openai/sora-2'].std = 0.4;
  day2['openai/sora-2'].native = { perSecond: 0.08 };
  delete day2['openai/whisper-1'];
  const s2 = applyMultimodal(s1.models, day2, '2026-11-19');
  assert.deepEqual(s2.changes.map((c) => [c.id, c.type]), [['openai/sora-2', 'changed'], ['openai/whisper-1', 'removed']]);
  assert.deepEqual(s2.models['openai/sora-2'].history.at(-1), { date: '2026-11-19', std: 0.4, native: { perSecond: 0.08 } });

  const s3 = applyMultimodal(s2.models, day2, '2026-11-20');
  assert.equal(s3.changes.length, 0);
});

test('manual entries are estimates; sanity check catches a broken fetch', () => {
  const manual = normalizeManual({ models: [{ modality: '3d', vendor: 'meshy', vendorName: 'Meshy', model: 'Meshy 7.1', std: 0.6, nativeText: '30 积分', source: 'x', checked: '2026-11-18' }] });
  assert.equal(manual['meshy/Meshy 7.1'].estimate, true);
  assert.equal(manual['meshy/Meshy 7.1'].manual, true);

  const prev = applyMultimodal({}, normalizeMultimodal(raw), '2026-11-18').models;
  assert.deepEqual(sanityCheckMultimodal(prev, normalizeMultimodal(raw)), []);
  // Fewer than four models in a modality never trips the check.
  assert.deepEqual(sanityCheckMultimodal(prev, {}), []);
});
