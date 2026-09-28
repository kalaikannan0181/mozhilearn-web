const path = require('path');
const { spawn } = require('child_process');
const fs = require('fs/promises');
const os = require('os');
const { transcribeAudioFile } = require('./asrService.cjs');

const MODULE_ROOT = path.resolve(process.env.TRANSLATION_MODULE_ROOT || path.join(__dirname, '..', '..', 'tts-main', 'tts-main'));
const DEFAULT_PYTHON = process.platform === 'win32'
  ? path.join(MODULE_ROOT, '.venv', 'Scripts', 'python.exe')
  : path.join(MODULE_ROOT, '.venv', 'bin', 'python');
const BRIDGE_PATH = path.join(MODULE_ROOT, 'hindi_to_mundari', 'translation_bridge.py');
const REQUEST_TIMEOUT_MS = 10000;

function getPythonExecutable() {
  if (process.env.TRANSLATION_MODULE_PYTHON) return process.env.TRANSLATION_MODULE_PYTHON;
  if (require('fs').existsSync(DEFAULT_PYTHON)) return DEFAULT_PYTHON;
  return process.platform === 'win32' ? 'python' : 'python3';
}

function runTranslationBridge(request) {
  return new Promise((resolve) => {
    const child = spawn(getPythonExecutable(), [BRIDGE_PATH], {
      cwd: MODULE_ROOT,
      env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' },
      windowsHide: true,
    });
    let stdout = '';
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolve(result);
    };
    const timeout = setTimeout(() => {
      child.kill();
      finish(null);
    }, REQUEST_TIMEOUT_MS);

    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.on('error', () => finish(null));
    child.on('close', (code) => {
      if (code !== 0) return finish(null);
      try {
        const payload = JSON.parse(stdout.trim());
        finish(payload);
      } catch {
        finish(null);
      }
    });

    child.stdin.end(JSON.stringify(request));
  });
}

async function translateWithUploadedModule(hindiText) {
  const payload = await runTranslationBridge({ hindi_text: hindiText });
  if (!payload?.forms?.mundari_translation) return null;

  return {
    ...payload.forms,
    modelVersion: `tts-main-verified:${payload.translation?.source || 'database'}`,
    translationVerified: payload.translation?.verified === 1,
  };
}

async function prepareMundariForms(mundariTranslation, source = 'ai') {
  const payload = await runTranslationBridge({
    action: 'prepare',
    mundari_translation: mundariTranslation,
    source,
    verified: false,
  });
  return payload?.forms || null;
}

async function prepareMundariTtsInputs(items) {
  const payload = await runTranslationBridge({
    action: 'prepare_batch',
    items: items.map(({ id, mundariRoman }) => ({ id, mundari_translation: mundariRoman })),
  });
  return payload?.items || [];
}

async function transcribeUploadedAudio(audioBuffer, extension) {
  const temporaryDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'mozhi-audio-'));
  const audioPath = path.join(temporaryDirectory, `recording.${extension}`);

  try {
    await fs.writeFile(audioPath, audioBuffer);

    return await transcribeAudioFile(audioPath);
  } finally {
    await fs.rm(temporaryDirectory, { recursive: true, force: true });
  }
}

module.exports = { prepareMundariForms, prepareMundariTtsInputs, transcribeUploadedAudio, translateWithUploadedModule };