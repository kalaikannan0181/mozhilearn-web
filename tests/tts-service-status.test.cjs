const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { getAudioStatus, getTtsDiagnostics, synthesize } = require('../server/services/ttsService.cjs');
const { prepareMundariTtsInputs } = require('../server/services/uploadedTranslationService.cjs');

test('MMS TTS diagnostics reflect actual filesystem state', () => {
  const diagnostics = getTtsDiagnostics();
  assert.equal(diagnostics.modelId, 'facebook/mms-tts-unr');
  assert.equal(diagnostics.checkpointFound, false, 'No model weights checkpoint exists');
  assert.equal(diagnostics.tokenizerFound, true, 'Vocab/tokenizer exists');
  assert.equal(diagnostics.status, 'model_missing');
  assert.ok(diagnostics.modelFiles.includes('vocab.json'));
});

test('MMS TTS status stays unavailable and reports model_weights_missing', async () => {
  const previousServiceUrl = process.env.TTS_SERVICE_URL;
  delete process.env.TTS_SERVICE_URL;

  try {
    const status = await getAudioStatus();
    assert.equal(status.available, false);
    assert.equal(status.reason, 'model_weights_missing');
    assert.equal(status.missingCheckpoint, 'model.safetensors');
    assert.equal(status.modelId, 'facebook/mms-tts-unr');
    assert.equal(status.inputScript, 'Odia');
    assert.match(status.message, /model weights missing/i);
  } finally {
    if (previousServiceUrl === undefined) delete process.env.TTS_SERVICE_URL;
    else process.env.TTS_SERVICE_URL = previousServiceUrl;
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

test('Synthesize returns 503 model_weights_missing for verified Class 1 Odia inputs without faking audio', async () => {
  const previousServiceUrl = process.env.TTS_SERVICE_URL;
  delete process.env.TTS_SERVICE_URL;

  try {
    const verifiedWords = ['ଉଲି', 'କେଲ', 'ମିଯଦ୍', 'ବରିଯ', 'ଅପିଯ', 'ଉପୁନ', 'ମୋରେଯ', 'ଉଲି ଲେକ ମେ'];

    for (const word of verifiedWords) {
      const res = await synthesize({ ttsInput: word, ttsInputScript: 'Odia' });
      assert.equal(res.statusCode, 503);
      assert.equal(res.available, false);
      assert.equal(res.reason, 'model_weights_missing');
      assert.equal(res.success, false);
      assert.equal(typeof res.audioUrl, 'undefined', 'Never return audioUrl for missing weights');
    }
  } finally {
    if (previousServiceUrl === undefined) delete process.env.TTS_SERVICE_URL;
    else process.env.TTS_SERVICE_URL = previousServiceUrl;
  }
});

test('TTS caching prevents duplicate synthesis and reuses audio by hash key', async () => {
  const text = 'ଉଲି';
  const script = 'Odia';
  const modelId = 'facebook/mms-tts-unr';
  const cacheKey = crypto.createHash('sha256').update(`${modelId}|${script}|${text}`).digest('hex');
  const cacheDir = path.resolve(__dirname, '..', 'public', 'audio', 'generated');
  const cacheFile = path.join(cacheDir, `${cacheKey}.wav`);

  // Ensure directory exists
  fs.mkdirSync(cacheDir, { recursive: true });

  // Create a minimal valid WAV buffer (44-byte standard PCM WAV header)
  const wavHeader = Buffer.alloc(44);
  wavHeader.write('RIFF', 0, 'ascii');
  wavHeader.writeUInt32LE(36 + 4, 4); // file size - 8
  wavHeader.write('WAVE', 8, 'ascii');
  wavHeader.write('fmt ', 12, 'ascii');
  wavHeader.writeUInt32LE(16, 16); // SubChunk1Size (16 for PCM)
  wavHeader.writeUInt16LE(1, 20);  // AudioFormat (1 = PCM)
  wavHeader.writeUInt16LE(1, 22);  // NumChannels (1 = Mono)
  wavHeader.writeUInt32LE(16000, 24); // SampleRate (16kHz)
  wavHeader.writeUInt32LE(32000, 28); // ByteRate
  wavHeader.writeUInt16LE(2, 32);  // BlockAlign
  wavHeader.writeUInt16LE(16, 34); // BitsPerSample
  wavHeader.write('data', 36, 'ascii');
  wavHeader.writeUInt32LE(4, 40); // SubChunk2Size
  const testWav = Buffer.concat([wavHeader, Buffer.from([0, 0, 0, 0])]);

  try {
    fs.writeFileSync(cacheFile, testWav);

    // Call synthesize - should hit cache
    const result = await synthesize({ ttsInput: text, ttsInputScript: script });
    assert.equal(result.statusCode, 200);
    assert.equal(result.success, true);
    assert.equal(result.cached, true);
    assert.equal(result.format, 'wav');
    assert.equal(result.audioUrl, `/api/tts/audio/${cacheKey}.wav`);
  } finally {
    // Clean up test cache file
    if (fs.existsSync(cacheFile)) {
      fs.unlinkSync(cacheFile);
    }
  }

  // Confirm that after cache file removal, synthesize returns 503 again
  const afterResult = await synthesize({ ttsInput: text, ttsInputScript: script });
  assert.equal(afterResult.statusCode, 503);
  assert.equal(afterResult.reason, 'model_weights_missing');
});