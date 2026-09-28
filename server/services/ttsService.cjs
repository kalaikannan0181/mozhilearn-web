const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const AUDIO_ROOT = path.resolve(__dirname, '..', '..', 'public', 'audio');
const GENERATED_AUDIO_ROOT = path.join(AUDIO_ROOT, 'generated');
const MODEL_ROOT = path.resolve(process.env.TTS_MODEL_DIR || path.join(__dirname, '..', '..', 'tts-main', 'tts-main', 'TTS'));
const DEFAULT_MODEL_ID = 'facebook/mms-tts-unr';
const REQUIRED_PYTHON_PACKAGES = ['torch', 'transformers', 'scipy', 'numpy'];

function getModelRoot() {
  return path.resolve(process.env.TTS_MODEL_DIR || path.join(__dirname, '..', '..', 'tts-main', 'tts-main', 'TTS'));
}

function listModelFiles() {
  const root = getModelRoot();
  if (!fs.existsSync(root)) return [];
  return fs.readdirSync(root).sort();
}

function hasModelWeights() {
  return listModelFiles().some((name) => /^(model\.safetensors|pytorch_model\.bin|model\..+\.safetensors|pytorch_model\..+\.bin)$/.test(name));
}

function getTtsDiagnostics() {
  const modelFiles = listModelFiles();
  const checkpointFiles = modelFiles.filter((name) => /^(model\.safetensors|pytorch_model\.bin|model\..+\.safetensors|pytorch_model\..+\.bin)$/.test(name));
  const tokenizerFiles = modelFiles.filter((name) => /^(tokenizer_config\.json|tokenizer\.json|tokenizer\.jsonl|vocab\.json|merges\.txt|sentencepiece\.model|spiece\.model)$/.test(name));
  const status = checkpointFiles.length === 0 ? 'model_missing' : tokenizerFiles.length === 0 ? 'model_load_failed' : 'loading_model';

  return {
    status,
    available: false,
    modelId: DEFAULT_MODEL_ID,
    modelFiles,
    checkpointFound: checkpointFiles.length > 0,
    tokenizerFound: tokenizerFiles.length > 0,
    requiredPythonPackages: [...REQUIRED_PYTHON_PACKAGES],
    currentTtsEntryPoint: 'tts-main/tts-main/tts_service.py',
    currentExpressEndpoint: '/api/tts',
    currentFrontendEntryPoint: 'src/main.tsx -> src/App.tsx',
    hardCodedPaths: [],
    message: checkpointFiles.length === 0
      ? 'Mundari TTS unavailable: model weights missing.'
      : tokenizerFiles.length === 0
        ? 'Mundari TTS unavailable: tokenizer missing.'
        : 'Mundari TTS model status must be confirmed by the Python service.',
  };
}

function normalizeLanguage(language) {
  const normalized = String(language || 'mundari').trim().toLowerCase();
  if (['mundari', 'mundari-roman', 'mundari_roman', 'mundari-roman-script'].includes(normalized)) {
    return 'mundari';
  }

  if (['hindi', 'hi', 'hi-in'].includes(normalized)) {
    return 'hindi';
  }

  return normalized || 'mundari';
}

async function getAudioStatus({ language = 'mundari' } = {}) {
  const normalizedLanguage = normalizeLanguage(language);
  const serviceUrl = process.env.TTS_SERVICE_URL?.replace(/\/+$/, '');
  if (!serviceUrl) {
    const diagnostics = getTtsDiagnostics();
    return {
      success: true,
      status: diagnostics.status,
      mode: 'unavailable',
      language: normalizedLanguage,
      available: false,
      model: DEFAULT_MODEL_ID,
      modelId: DEFAULT_MODEL_ID,
      modelAvailable: false,
      weightsPresent: diagnostics.checkpointFound,
      tokenizerFound: diagnostics.tokenizerFound,
      serviceConfigured: false,
      reason: diagnostics.checkpointFound ? 'tts_service_not_configured' : 'model_weights_missing',
      missingCheckpoint: diagnostics.checkpointFound ? undefined : 'model.safetensors',
      inputScript: 'Odia',
      message: diagnostics.checkpointFound ? 'Mundari TTS service is not configured.' : diagnostics.message,
    };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 3000);
  try {
    const response = await fetch(`${serviceUrl}/status`, { signal: controller.signal });
    const payload = await response.json();
    const available = response.ok && payload.available === true && payload.status === 'ready';
    return {
      success: true,
      status: payload.status || 'model_load_failed',
      mode: available ? 'model-service' : 'unavailable',
      language: normalizedLanguage,
      available,
      model: DEFAULT_MODEL_ID,
      modelAvailable: available,
      weightsPresent: Boolean(payload.checkpointFound),
      tokenizerFound: Boolean(payload.tokenizerFound),
      serviceConfigured: true,
      reason: available ? undefined : payload.status || 'model_load_failed',
      message: payload.message || (available ? 'Mundari TTS model is ready.' : 'Mundari TTS is unavailable.'),
    };
  } catch {
    return {
      success: true,
      status: 'model_load_failed',
      mode: 'unavailable',
      language: normalizedLanguage,
      available: false,
      model: DEFAULT_MODEL_ID,
      modelAvailable: false,
      weightsPresent: false,
      tokenizerFound: false,
      serviceConfigured: true,
      reason: 'tts_service_unavailable',
      message: 'Mundari TTS service is unavailable.',
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function synthesize({ ttsInput, ttsInputScript, language = 'mundari' } = {}) {
  const normalizedLanguage = normalizeLanguage(language);
  const trimmedText = typeof ttsInput === 'string' ? ttsInput.trim() : '';

  if (!trimmedText || trimmedText.length > 2000 || ttsInputScript !== 'Odia') {
    return {
      success: false,
      status: 'invalid_input',
      mode: 'unavailable',
      language: normalizedLanguage,
      available: false,
      statusCode: 400,
      message: 'Odia model-compatible tts_input of at most 2000 characters is required.',
    };
  }

  const cacheKey = crypto.createHash('sha256').update(`${DEFAULT_MODEL_ID}|${ttsInputScript}|${trimmedText}`).digest('hex');
  const cachedAudioPath = path.join(GENERATED_AUDIO_ROOT, `${cacheKey}.wav`);
  if (fs.existsSync(cachedAudioPath)) {
    return {
      success: true,
      status: 'success',
      mode: 'model',
      available: true,
      statusCode: 200,
      audioUrl: `/api/tts/audio/${cacheKey}.wav`,
      format: 'wav',
      model: DEFAULT_MODEL_ID,
      cached: true,
    };
  }

  if (process.env.TTS_SERVICE_URL) {
    try {
      const response = await fetch(`${process.env.TTS_SERVICE_URL.replace(/\/+$/, '')}/tts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tts_input: trimmedText, tts_input_script: ttsInputScript, language: normalizedLanguage }),
        signal: AbortSignal.timeout(30000),
      });
      const payload = await response.json();
      if (response.ok && payload.success && typeof payload.audio_base64 === 'string' && payload.format === 'wav') {
        const audio = Buffer.from(payload.audio_base64, 'base64');
        if (audio.length < 44 || audio.toString('ascii', 0, 4) !== 'RIFF' || audio.toString('ascii', 8, 12) !== 'WAVE') {
          return { success: false, status: 'synthesis_failed', available: false, statusCode: 500, message: 'Mundari TTS service returned invalid audio.' };
        }
        const cacheKey = crypto.createHash('sha256').update(`${DEFAULT_MODEL_ID}|${ttsInputScript}|${trimmedText}`).digest('hex');
        fs.mkdirSync(GENERATED_AUDIO_ROOT, { recursive: true });
        const audioPath = path.join(GENERATED_AUDIO_ROOT, `${cacheKey}.wav`);
        if (!fs.existsSync(audioPath)) fs.writeFileSync(audioPath, audio, { flag: 'wx' });
        return { success: true, status: 'success', mode: 'model', available: true, statusCode: 200, audioUrl: `/api/tts/audio/${cacheKey}.wav`, format: 'wav', model: DEFAULT_MODEL_ID };
      }
      return {
        success: false,
        status: payload.status || 'model_load_failed',
        mode: 'unavailable',
        language: normalizedLanguage,
        available: false,
        statusCode: response.status || 503,
        reason: payload.reason || payload.status || 'tts_service_unavailable',
        message: payload.message || 'Mundari TTS service did not return verified audio.',
      };
    } catch {
      return {
        success: false,
        status: 'model_load_failed',
        mode: 'unavailable',
        language: normalizedLanguage,
        available: false,
        statusCode: 503,
        reason: 'tts_service_unavailable',
        message: 'Mundari TTS service is unavailable.',
      };
    }
  }

  const diagnostics = getTtsDiagnostics();
  const modelMissing = !diagnostics.checkpointFound;
  return {
    success: false,
    status: modelMissing ? 'model_missing' : 'model_load_failed',
    mode: 'unavailable',
    language: normalizedLanguage,
    available: false,
    statusCode: 503,
    reason: modelMissing ? 'model_weights_missing' : 'tts_service_not_configured',
    message: modelMissing ? 'Mundari TTS unavailable: model weights missing.' : 'Mundari TTS service is not configured.',
  };
}

module.exports = {
  AUDIO_ROOT,
  MODEL_ROOT,
  getAudioStatus,
  getTtsDiagnostics,
  hasModelWeights,
  normalizeLanguage,
  synthesize,
};
