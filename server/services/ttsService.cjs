const fs = require('fs');
const path = require('path');

const AUDIO_ROOT = path.join(__dirname, '..', '..', 'public', 'audio');
const MODEL_ROOT = path.resolve(process.env.TTS_MODEL_DIR || path.join(__dirname, '..', '..', 'tts-main', 'tts-main', 'TTS'));
const AUDIO_EXTENSIONS = new Set(['.mp3', '.wav', '.ogg', '.m4a', '.aac', '.webm']);

function hasModelWeights() {
  if (!fs.existsSync(MODEL_ROOT)) return false;
  return fs.readdirSync(MODEL_ROOT).some((name) => /^(model\.safetensors|pytorch_model\.bin|model\..+\.safetensors|pytorch_model\..+\.bin)$/.test(name));
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
  const weightsPresent = hasModelWeights();
  const serviceConfigured = Boolean(process.env.TTS_SERVICE_URL);
  return {
    success: true,
    mode: audioUrl ? 'prerecorded' : weightsPresent && serviceConfigured ? 'model-service' : 'unavailable',
    language: normalizedLanguage,
    available: Boolean(audioUrl),
    audioUrl: audioUrl || null,
    modelAvailable: weightsPresent && serviceConfigured,
    weightsPresent,
    message: audioUrl
      ? 'Verified prerecorded audio is available.'
      : !weightsPresent
        ? 'Mundari TTS model weights are missing.'
        : !serviceConfigured
          ? 'Mundari model weights are present, but the TTS service is not configured.'
          : 'Mundari TTS service is configured, but no verified audio is available for this text.',
    serviceConfigured,
  };
}

async function synthesize({ ttsInput, language = 'mundari', audioUrl, voice } = {}) {
  const normalizedLanguage = normalizeLanguage(language);
  const trimmedText = typeof ttsInput === 'string' ? ttsInput.trim() : '';

  if (!trimmedText) {
    return {
      success: false,
      mode: 'unavailable',
      language: normalizedLanguage,
      available: false,
      message: 'Empty text provided for TTS.',
    };
  }

  const prerecordedAudioUrl = findPreRecordedAudio({ text: trimmedText, language: normalizedLanguage, audioUrl });
  if (prerecordedAudioUrl) {
    return {
      success: true,
      mode: 'prerecorded',
      language: normalizedLanguage,
      available: true,
      audioUrl: prerecordedAudioUrl,
      message: 'Verified prerecorded audio is available.',
    };
  }

  if (process.env.TTS_SERVICE_URL) {
    try {
      const response = await fetch(`${process.env.TTS_SERVICE_URL.replace(/\/+$/, '')}/synthesize`, {
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
        mode: 'unavailable',
        language: normalizedLanguage,
        available: false,
        audioUrl: null,
        weightsPresent: hasModelWeights(),
        message: payload.message || 'Mundari TTS service did not return verified audio.',
      };
    } catch {
      return {
        success: false,
        mode: 'unavailable',
        language: normalizedLanguage,
        available: false,
        audioUrl: null,
        weightsPresent: hasModelWeights(),
        message: 'Mundari TTS service is unavailable.',
      };
    }
  }

  return {
    success: false,
    mode: 'unavailable',
    language: normalizedLanguage,
    available: false,
    audioUrl: null,
    weightsPresent: hasModelWeights(),
    message: hasModelWeights()
      ? 'Mundari TTS service is not configured or did not return verified audio.'
      : 'Mundari TTS model weights are missing.',
  };
}

module.exports = {
  AUDIO_ROOT,
  MODEL_ROOT,
  findPreRecordedAudio,
  getAudioStatus,
  hasModelWeights,
  normalizeLanguage,
  synthesize,
};
