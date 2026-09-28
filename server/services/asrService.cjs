const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

const MODULE_ROOT = path.resolve(process.env.TRANSLATION_MODULE_ROOT || path.join(__dirname, '..', '..', 'tts-main', 'tts-main'));
const WORKER_PATH = path.join(MODULE_ROOT, 'speech_to_text', 'asr_worker.py');
const DEFAULT_PYTHON = process.platform === 'win32'
  ? path.join(MODULE_ROOT, '.venv', 'Scripts', 'python.exe')
  : path.join(MODULE_ROOT, '.venv', 'bin', 'python');
const STARTUP_TIMEOUT_MS = 5 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 5 * 60 * 1000;

let worker = null;
let workerStatus = 'starting';
let startupPromise = null;
let startupTimer = null;
let nextRequestId = 1;
let stdoutBuffer = '';
const pending = new Map();

function pythonExecutable() {
  if (process.env.TRANSLATION_MODULE_PYTHON) return process.env.TRANSLATION_MODULE_PYTHON;
  if (fs.existsSync(DEFAULT_PYTHON)) return DEFAULT_PYTHON;
  return process.platform === 'win32' ? 'python' : 'python3';
}

function settleStartup(status) {
  workerStatus = status;
  if (startupTimer) clearTimeout(startupTimer);
  startupTimer = null;
}

function handleLine(line) {
  let message;
  try {
    message = JSON.parse(line);
  } catch {
    return;
  }

  if (message.event === 'status') {
    settleStartup(message.status === 'ready' ? 'ready' : 'unavailable');
    return;
  }

  const task = pending.get(message.id);
  if (!task) return;
  pending.delete(message.id);
  clearTimeout(task.timeout);
  if (message.ok && typeof message.hindi_text === 'string' && message.hindi_text.trim()) {
    task.resolve(message.hindi_text.trim());
  } else {
    task.reject(new Error(message.error === 'invalid_audio'
      ? 'No recognizable Hindi speech was found in the uploaded audio.'
      : message.error === 'unavailable'
        ? 'Hindi speech recognition is unavailable.'
        : 'Hindi speech recognition failed.'));
  }
}

function initializeAsr() {
  if (startupPromise) return startupPromise;
  workerStatus = 'starting';
  startupPromise = new Promise((resolve) => {
    try {
      worker = spawn(pythonExecutable(), [WORKER_PATH], {
        cwd: MODULE_ROOT,
        env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' },
        windowsHide: true,
        stdio: ['pipe', 'pipe', 'ignore'],
      });
    } catch {
      workerStatus = 'unavailable';
      resolve(workerStatus);
      return;
    }

    worker.stdout.setEncoding('utf8');
    worker.stdout.on('data', (chunk) => {
      stdoutBuffer += chunk;
      let newline = stdoutBuffer.indexOf('\n');
      while (newline >= 0) {
        handleLine(stdoutBuffer.slice(0, newline).trim());
        stdoutBuffer = stdoutBuffer.slice(newline + 1);
        newline = stdoutBuffer.indexOf('\n');
      }
      if (workerStatus !== 'starting') resolve(workerStatus);
    });
    worker.on('error', () => {
      settleStartup('unavailable');
      resolve(workerStatus);
      failPending();
    });
    worker.on('close', () => {
      settleStartup('unavailable');
      resolve(workerStatus);
      failPending();
      worker = null;
      startupPromise = null;
    });
    startupTimer = setTimeout(() => {
      settleStartup('unavailable');
      resolve(workerStatus);
    }, STARTUP_TIMEOUT_MS);
  });
  return startupPromise;
}

function failPending() {
  for (const [id, task] of pending) {
    clearTimeout(task.timeout);
    task.reject(new Error('Hindi speech recognition is unavailable.'));
    pending.delete(id);
  }
}

async function transcribeAudioFile(audioPath) {
  const status = await initializeAsr();
  if (status !== 'ready' || !worker || workerStatus !== 'ready') {
    throw new Error('Hindi speech recognition is unavailable.');
  }

  const id = nextRequestId++;
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      pending.delete(id);
      reject(new Error('Hindi speech recognition timed out.'));
    }, REQUEST_TIMEOUT_MS);
    pending.set(id, { resolve, reject, timeout });
    worker.stdin.write(`${JSON.stringify({ id, audio_path: audioPath })}\n`, (error) => {
      if (!error) return;
      const task = pending.get(id);
      if (task) {
        pending.delete(id);
        clearTimeout(task.timeout);
        task.reject(new Error('Hindi speech recognition is unavailable.'));
      }
    });
  });
}

function getAsrStatus() {
  return workerStatus;
}

function shutdownAsr() {
  if (worker && !worker.killed) worker.kill();
  worker = null;
  startupPromise = null;
  settleStartup('unavailable');
  failPending();
}

module.exports = { getAsrStatus, initializeAsr, shutdownAsr, transcribeAudioFile };
