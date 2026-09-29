const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
require('dotenv').config({ path: path.join(__dirname, '..', '.env.local') });
const { getAudioStatus, getTtsDiagnostics, synthesize } = require('../server/services/ttsService.cjs');
const { prepareMundariTtsInputs } = require('../server/services/uploadedTranslationService.cjs');

test('MMS TTS diagnostics reflect authentic checkpoint presence', () => {
  const diagnostics = getTtsDiagnostics();
  assert.equal(diagnostics.modelId, 'facebook/mms-tts-unr');
  assert.equal(diagnostics.checkpointFound, true, 'Authentic model.safetensors checkpoint exists');
  assert.equal(diagnostics.tokenizerFound, true, 'Vocab/tokenizer exists');
  assert.ok(diagnostics.modelFiles.includes('model.safetensors'), 'model.safetensors must be in model files');
  assert.ok(diagnostics.modelFiles.includes('vocab.json'), 'vocab.json must be in model files');
});

test('MMS TTS status is ready when service is configured and model loaded', async () => {
  const status = await getAudioStatus();
  if (process.env.TTS_SERVICE_URL && status.status === 'ready') {
    assert.equal(status.available, true);
    assert.equal(status.status, 'ready');
    assert.equal(status.mode, 'model-service');
    assert.equal(status.model, 'facebook/mms-tts-unr');
    assert.equal(status.weightsPresent, true);
    assert.equal(status.tokenizerFound, true);
    assert.match(status.message, /ready/i);
  } else if (process.env.TTS_SERVICE_URL) {
    assert.equal(status.serviceConfigured, true);
    assert.equal(status.mode, 'unavailable');
  } else {
    assert.equal(status.weightsPresent, true);
    assert.equal(status.tokenizerFound, true);
  }
});

test('TTS rejects Roman text and empty inputs', async () => {
  // Empty input
  const emptyRes = await synthesize({ ttsInput: '', ttsInputScript: 'Odia' });
  assert.equal(emptyRes.statusCode, 400);
  assert.equal(emptyRes.status, 'invalid_input');
  assert.equal(emptyRes.available, false);

  // Roman text passed as model input
  const romanRes = await synthesize({ ttsInput: 'Uli', ttsInputScript: 'Latin' });
  assert.equal(romanRes.statusCode, 400);
  assert.equal(romanRes.status, 'invalid_input');
  assert.equal(romanRes.available, false);
});

test('Verified Class 1 Roman words transliterate into model-native Odia script', async () => {
  const class1Items = [
    { id: '1', mundariRoman: 'Uli' },
    { id: '2', mundariRoman: 'Kela' },
    { id: '3', mundariRoman: 'Miyad' },
    { id: '4', mundariRoman: 'Bariya' },
    { id: '5', mundariRoman: 'Apiya' },
    { id: '6', mundariRoman: 'Upuna' },
    { id: '7', mundariRoman: 'Moreya' },
    { id: '8', mundariRoman: 'Uli leka me' },
  ];

  const prepared = await prepareMundariTtsInputs(class1Items);
  assert.equal(prepared.length, 8);

  for (const item of prepared) {
    assert.equal(item.tts_input_script, 'Odia');
    assert.ok(typeof item.tts_input === 'string' && item.tts_input.trim().length > 0);
    // Odia Unicode block: \u0B00 - \u0B7F
    assert.ok(
      /[\u0B00-\u0B7F]/.test(item.tts_input),
      `Item ${item.mundariRoman} must transliterate to Odia script, got: ${item.tts_input}`
    );
  }

  // Check specific expected Odia outputs
  assert.equal(prepared[0].tts_input, 'ଉଲି'); // Uli
  assert.equal(prepared[1].tts_input, 'କେଲ'); // Kela
  assert.equal(prepared[2].tts_input, 'ମିଯଦ୍'); // Miyad
  assert.equal(prepared[3].tts_input, 'ବରିଯ'); // Bariya
  assert.equal(prepared[4].tts_input, 'ଅପିଯ'); // Apiya
  assert.equal(prepared[5].tts_input, 'ଉପୁନ'); // Upuna
  assert.equal(prepared[6].tts_input, 'ମୋରେଯ'); // Moreya
  assert.equal(prepared[7].tts_input, 'ଉଲି ଲେକ ମେ'); // Uli leka me
});

test('Synthesize produces real WAV audio for Class 1 Uli and reuses cached audio', async () => {
  const res = await synthesize({ ttsInput: 'ଉଲି', ttsInputScript: 'Odia' });
  assert.equal(res.statusCode, 200);
  assert.equal(res.available, true);
  assert.equal(res.success, true);
  assert.equal(res.format, 'wav');
  assert.ok(res.audioUrl && res.audioUrl.startsWith('/api/tts/audio/'));

  // Verify file on disk
  const filename = path.basename(res.audioUrl);
  const audioPath = path.resolve(__dirname, '..', 'public', 'audio', 'generated', filename);
  assert.ok(fs.existsSync(audioPath), 'Audio file must exist on disk');
  const buffer = fs.readFileSync(audioPath);
  assert.ok(buffer.length > 1000, 'Audio file must have valid size');
  assert.equal(buffer.toString('ascii', 0, 4), 'RIFF');
  assert.equal(buffer.toString('ascii', 8, 12), 'WAVE');

  // Verify cache hit on second call
  const cachedRes = await synthesize({ ttsInput: 'ଉଲି', ttsInputScript: 'Odia' });
  assert.equal(cachedRes.statusCode, 200);
  assert.equal(cachedRes.cached, true);
  assert.equal(cachedRes.audioUrl, res.audioUrl);
});

test('Missing model weights safety contract: returns 503 model_weights_missing without fake audio', async () => {
  const previousModelDir = process.env.TTS_MODEL_DIR;
  const previousServiceUrl = process.env.TTS_SERVICE_URL;
  const tempEmptyDir = path.resolve(__dirname, '..', 'scratch_empty_model_test');
  fs.mkdirSync(tempEmptyDir, { recursive: true });

  try {
    process.env.TTS_MODEL_DIR = tempEmptyDir;
    delete process.env.TTS_SERVICE_URL;

    const emptyDiagnostics = getTtsDiagnostics();
    assert.equal(emptyDiagnostics.checkpointFound, false);
    assert.equal(emptyDiagnostics.status, 'model_missing');

    const result = await synthesize({ ttsInput: 'ଅଜ୍ଞାତ', ttsInputScript: 'Odia' });
    assert.equal(result.statusCode, 503);
    assert.equal(result.available, false);
    assert.equal(result.reason, 'model_weights_missing');
    assert.equal(typeof result.audioUrl, 'undefined', 'Never return audioUrl when weights are missing');
  } finally {
    if (previousModelDir === undefined) delete process.env.TTS_MODEL_DIR;
    else process.env.TTS_MODEL_DIR = previousModelDir;
    if (previousServiceUrl === undefined) delete process.env.TTS_SERVICE_URL;
    else process.env.TTS_SERVICE_URL = previousServiceUrl;
    if (fs.existsSync(tempEmptyDir)) fs.rmdirSync(tempEmptyDir);
  }
});