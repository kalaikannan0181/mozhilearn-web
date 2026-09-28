const fs = require('fs');
const path = require('path');

const AUDIO_ROOT = path.join(__dirname, '..', '..', 'public', 'audio');
const MODEL_ROOT = path.resolve(process.env.TTS_MODEL_DIR || path.join(__dirname, '..', '..', 'tts-main', 'tts-main', 'TTS'));
const DEFAULT_MODEL_ID = 'facebook/mms-tts-unr';
const REQUIRED_PYTHON_PACKAGES = ['torch', 'transformers', 'scipy', 'numpy'];
const AUDIO_EXTENSIONS = new Set(['.mp3', '.wav', '.ogg', '.m4a', '.aac', '.webm']);

function listModelFiles() {
  if (!fs.existsSync(MODEL_ROOT)) return [];
  return fs.readdirSync(MODEL_ROOT).sort();
}

function hasModelWeights() {
  return listModelFiles().some((name) => /^(model\.safetensors|pytorch_model\.bin|model\..+\.safetensors|pytorch_model\..+\.bin)$/.test(name));
}

function hasTokenizerFiles() {
  const files = listModelFiles();
  return files.some((name) => /^(tokenizer_config\.json|tokenizer\.json|tokenizer\.jsonl|vocab\.json|merges\.txt|sentencepiece\.model|spiece\.model)$/.test(name));
}

function getMissingPythonPackages() {
  const missing = [];
  for (const pkg of REQUIRED_PYTHON_PACKAGES) {
    try {
      require.resolve(pkg);
    } catch {
      missing.push(pkg);
    }
  }
  return missing;
}

function getTtsDiagnostics() {
  const modelFiles = listModelFiles();
  const checkpointFiles = modelFiles.filter((name) => /^(model\.safetensors|pytorch_model\.bin|model\..+\.safetensors|pytorch_model\..+\.bin)$/.test(name));
  const tokenizerFiles = modelFiles.filter((name) => /^(tokenizer_config\.json|tokenizer\.json|tokenizer\.jsonl|vocab\.json|merges\.txt|sentencepiece\.model|spiece\.model)$/.test(name));
  const missingDependencies = getMissingPythonPackages();
  const status = checkpointFiles.length > 0 && tokenizerFiles.length > 0 && missingDependencies.length === 0 ? 'ready' : 'unavailable';

  return {
    status,
    available: status === 'ready',
    modelId: DEFAULT_MODEL_ID,
    modelDir: MODEL_ROOT,
    modelFiles,
    checkpointFound: checkpointFiles.length > 0,
    tokenizerFound: tokenizerFiles.length > 0,
    requiredPythonPackages: [...REQUIRED_PYTHON_PACKAGES],
    missingDependencies,
    currentTtsEntryPoint: 'tts-main/tts-main/tts_service.py',
    currentExpressEndpoint: '/api/tts',
    currentFrontendEntryPoint: 'src/main.tsx -> src/App.tsx',
    hardCodedPaths: [],
    message: checkpointFiles.length === 0
      ? 'Mundari TTS unavailable: model weights missing.'
      : tokenizerFiles.length === 0
        ? 'Mundari TTS unavailable: tokenizer missing.'
        : missingDependencies.length > 0
          ? `Mundari TTS unavailable: missing Python packages: ${missingDependencies.join(', ')}.`
          : 'Mundari TTS is ready to serve audio.',
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

function sanitizeSegment(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'item';
}

function resolveFileFromAudioUrl(audioUrl) {
  if (typeof audioUrl !== 'string' || !audioUrl.trim()) {
    return null;
  }

  const cleanAudioUrl = audioUrl.trim();
  if (!cleanAudioUrl.startsWith('/')) {
    return null;
  }

  const relativePath = cleanAudioUrl.replace(/^\/+/, '');
  const filePath = path.join(__dirname, '..', '..', relativePath);

  if (!filePath.startsWith(AUDIO_ROOT) || !fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    return null;
  }

  return { filePath, publicPath: cleanAudioUrl };
}

function findPreRecordedAudio({ text, language, audioUrl }) {
  const resolvedFromUrl = resolveFileFromAudioUrl(audioUrl);
  if (resolvedFromUrl) {
    return resolvedFromUrl.publicPath;
  }

  const safeText = sanitizeSegment(text);
  const normalizedLanguage = normalizeLanguage(language);
  const searchRoots = [path.join(AUDIO_ROOT, normalizedLanguage), AUDIO_ROOT];

  const candidates = new Set();
  for (const root of searchRoots) {
    if (!fs.existsSync(root)) {
      continue;
    }

    const walk = (currentDir) => {
      for (const entry of fs.readdirSync(currentDir, { withFileTypes: true })) {
        const entryPath = path.join(currentDir, entry.name);
        if (entry.isDirectory()) {
          walk(entryPath);
          continue;
        }

        if (!AUDIO_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
          continue;
        }

        const fileName = path.basename(entry.name, path.extname(entry.name)).toLowerCase();
        const fileStem = fileName.replace(/[^a-z0-9]+/g, '-');
        if (fileStem === safeText || fileStem.includes(safeText) || safeText.includes(fileStem)) {
          candidates.add(entryPath);
        }
      }
    };

    walk(root);
  }

  if (candidates.size === 0) {
    return null;
  }

  const selected = [...candidates].sort((a, b) => a.length - b.length)[0];
  const relativePath = path.relative(path.join(__dirname, '..', '..'), selected).split(path.sep).join('/');
  return `/${relativePath}`;
}

function getAudioStatus({ language = 'mundari', text }) {
  const normalizedLanguage = normalizeLanguage(language);
  const audioUrl = findPreRecordedAudio({ text, language: normalizedLanguage });
  const diagnostics = getTtsDiagnostics();
  const serviceConfigured = Boolean(process.env.TTS_SERVICE_URL);
  return {
    success: true,
    status: diagnostics.status,
    mode: audioUrl ? 'prerecorded' : diagnostics.status === 'ready' && serviceConfigured ? 'model-service' : 'unavailable',
    language: normalizedLanguage,
    available: Boolean(audioUrl),
    audioUrl: audioUrl || null,
    modelAvailable: diagnostics.status === 'ready' && serviceConfigured,
    weightsPresent: diagnostics.checkpointFound,
    tokenizerFound: diagnostics.tokenizerFound,
    message: audioUrl
      ? 'Verified prerecorded audio is available.'
      : diagnostics.message,
    serviceConfigured,
    statusCode: diagnostics.status === 'ready' ? 200 : 503,
  };
}

async function synthesize({ ttsInput, language = 'mundari', audioUrl, voice } = {}) {
  const normalizedLanguage = normalizeLanguage(language);
  const trimmedText = typeof ttsInput === 'string' ? ttsInput.trim() : '';

  if (!trimmedText) {
    return {
      success: false,
      status: 'unavailable',
      mode: 'unavailable',
      language: normalizedLanguage,
      available: false,
      statusCode: 400,
      message: 'Empty text provided for TTS.',
    };
  }

  const prerecordedAudioUrl = findPreRecordedAudio({ text: trimmedText, language: normalizedLanguage, audioUrl });
  if (prerecordedAudioUrl) {
    return {
      success: true,
      status: 'ready',
      mode: 'prerecorded',
      language: normalizedLanguage,
      available: true,
      statusCode: 200,
      audioUrl: prerecordedAudioUrl,
      message: 'Verified prerecorded audio is available.',
    };
  }

  const diagnostics = getTtsDiagnostics();
  if (diagnostics.status !== 'ready') {
    return {
      success: false,
      status: 'unavailable',
      mode: 'unavailable',
      language: normalizedLanguage,
      available: false,
      audioUrl: null,
      statusCode: 503,
      weightsPresent: diagnostics.checkpointFound,
      tokenizerFound: diagnostics.tokenizerFound,
      message: diagnostics.message,
    };
  }

  if (process.env.TTS_SERVICE_URL) {
    try {
      const response = await fetch(`${process.env.TTS_SERVICE_URL.replace(/\/+$/, '')}/tts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tts_input: trimmedText, language: normalizedLanguage, voice: voice || null }),
      });
      const payload = await response.json();
      if (response.ok && payload.success && typeof payload.audioUrl === 'string' && payload.audioUrl) {
        return payload;
      }
      return {
        success: false,
        status: 'unavailable',
        mode: 'unavailable',
        language: normalizedLanguage,
        available: false,
        audioUrl: null,
        statusCode: response.status || 503,
        weightsPresent: diagnostics.checkpointFound,
        tokenizerFound: diagnostics.tokenizerFound,
        message: payload.message || 'Mundari TTS service did not return verified audio.',
      };
    } catch {
      return {
        success: false,
        status: 'unavailable',
        mode: 'unavailable',
        language: normalizedLanguage,
        available: false,
        audioUrl: null,
        statusCode: 503,
        weightsPresent: diagnostics.checkpointFound,
        tokenizerFound: diagnostics.tokenizerFound,
        message: 'Mundari TTS service is unavailable.',
      };
    }
  }

  return {
    success: false,
    status: 'unavailable',
    mode: 'unavailable',
    language: normalizedLanguage,
    available: false,
    audioUrl: null,
    statusCode: 503,
    weightsPresent: diagnostics.checkpointFound,
    tokenizerFound: diagnostics.tokenizerFound,
    message: diagnostics.message,
  };
}

module.exports = {
  AUDIO_ROOT,
  MODEL_ROOT,
  findPreRecordedAudio,
  getAudioStatus,
  getTtsDiagnostics,
  hasModelWeights,
  normalizeLanguage,
  synthesize,
};
