const test = require('node:test');
const assert = require('node:assert/strict');
const { getAudioStatus, getTtsDiagnostics, synthesize } = require('../server/services/ttsService.cjs');

test('MMS TTS stays unavailable without a real checkpoint', async () => {
  const previousServiceUrl = process.env.TTS_SERVICE_URL;
  delete process.env.TTS_SERVICE_URL;

  try {
    const diagnostics = getTtsDiagnostics();
    assert.equal(diagnostics.modelId, 'facebook/mms-tts-unr');
    assert.equal(diagnostics.checkpointFound, false);
    assert.equal(diagnostics.tokenizerFound, true);
    assert.equal(diagnostics.status, 'model_missing');

    const status = await getAudioStatus();
    assert.equal(status.available, false);
    assert.equal(status.reason, 'model_missing');
    assert.match(status.message, /model weights missing/i);

    const result = await synthesize({ ttsInput: 'ଉଲି', ttsInputScript: 'Odia' });
    assert.equal(result.statusCode, 503);
    assert.equal(result.available, false);
    assert.equal(result.reason, 'model_missing');
  } finally {
    if (previousServiceUrl === undefined) delete process.env.TTS_SERVICE_URL;
    else process.env.TTS_SERVICE_URL = previousServiceUrl;
  }
});

test('TTS rejects Roman text sent as model input', async () => {
  const result = await synthesize({ ttsInput: 'Uli', ttsInputScript: 'Latin' });
  assert.equal(result.statusCode, 400);
  assert.equal(result.status, 'invalid_input');
  assert.equal(result.available, false);
});