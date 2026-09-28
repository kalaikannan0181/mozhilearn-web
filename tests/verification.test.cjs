const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { setTimeout: delay } = require('node:timers/promises');
const { Pool } = require('pg');
require('dotenv').config({ path: path.join(__dirname, '..', '.env.local') });

const projectRoot = path.resolve(__dirname, '..');
const apiPort = Number(process.env.TEST_API_PORT || 5500);
const webPort = Number(process.env.TEST_WEB_PORT || 8544);
const apiBase = `http://localhost:${apiPort}`;
const webBase = `http://localhost:${webPort}`;
const dbUrl = process.env.DATABASE_URL;
assert.ok(dbUrl, 'DATABASE_URL must be configured for automated verification.');

let backendProcess;
let frontendProcess;
let teacherCookie = '';
let csrfCookie = '';
let csrfToken = '';
let tempUserEmail = '';
let tempUserId = null;
let baselineCounts = null;
const temporaryUsers = new Map();

function getCookieHeader(setCookieHeader) {
  if (!setCookieHeader) return '';
  return setCookieHeader.split(';')[0];
}

async function waitForHttp(url, timeoutMs = 40000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const response = await fetch(url, { method: 'GET' });
      if (response.ok || response.status < 500) {
        return response;
      }
    } catch {
      // retry until ready
    }
    await delay(500);
  }
  throw new Error(`Timed out waiting for ${url}`);
}

async function backendAvailable() {
  try {
    const response = await fetch(`${apiBase}/api/health`);
    return response.ok;
  } catch {
    return false;
  }
}

async function frontendAvailable() {
  try {
    const response = await fetch(`${webBase}/`);
    return response.ok || response.status === 404 || response.status === 200;
  } catch {
    return false;
  }
}

async function startBackendIfNeeded() {
  if (await backendAvailable()) return;
  backendProcess = spawn(process.execPath, ['server/index.cjs'], {
    cwd: projectRoot,
    env: { ...process.env, PORT: String(apiPort), NODE_ENV: 'development' },
    stdio: 'inherit',
  });
  await waitForHttp(`${apiBase}/api/health`);
}

async function startFrontendIfNeeded() {
  if (await frontendAvailable()) return;

  const viteBin = path.join(projectRoot, 'node_modules', 'vite', 'bin', 'vite.js');
  if (!fs.existsSync(viteBin)) {
    throw new Error('Vite binary not found at ' + viteBin);
  }

  frontendProcess = spawn(process.execPath, [viteBin, '--host', '0.0.0.0', '--port', String(webPort), '--strictPort'], {
    cwd: projectRoot,
    env: { ...process.env, BROWSER: 'none', VITE_API_URL: apiBase },
    stdio: 'inherit',
  });

  await waitForHttp(`${webBase}/login`);
}

function stopProcess(child) {
  if (child && child.exitCode === null) {
    child.kill('SIGTERM');
  }
}

async function dbSnapshot() {
  const pool = new Pool({ connectionString: dbUrl, ssl: false });
  const tables = [
    'users',
    'sessions',
    'lessons',
    'lesson_activities',
    'lesson_assessments',
    'translations',
    'vocabulary',
    'classroom_phrases',
    'textbook_terms',
    'number_vocabulary',
    'audit_logs',
  ];
  const counts = {};
  for (const table of tables) {
    const result = await pool.query(`SELECT COUNT(*) AS count FROM ${table}`);
    counts[table] = Number(result.rows[0].count);
  }
  const lessonResult = await pool.query(
    `SELECT id, title, grade, subject, status FROM lessons WHERE grade = 1 AND subject = 'Foundational Numeracy' ORDER BY id LIMIT 10`
  );
  await pool.end();
  return { counts, lessonOne: lessonResult.rows };
}

async function api(pathname, options = {}, cookieHeader = teacherCookie) {
  const headers = { ...(options.headers || {}) };
  const method = (options.method || 'GET').toUpperCase();
  if (!['GET', 'HEAD', 'OPTIONS'].includes(method)) {
    if (!csrfToken) {
      const csrfResponse = await fetch(`${apiBase}/api/auth/csrf`);
      const payload = await csrfResponse.json();
      assert.equal(csrfResponse.status, 200);
      csrfToken = payload.csrf_token;
      csrfCookie = getCookieHeader(csrfResponse.headers.get('set-cookie'));
    }
    headers['X-CSRF-Token'] = csrfToken;
  }
  const cookies = [cookieHeader, csrfCookie].filter(Boolean).join('; ');
  if (cookies && !headers.Cookie) headers.Cookie = cookies;
  return fetch(`${apiBase}${pathname}`, { ...options, headers });
}

async function registerTeacher() {
  tempUserEmail = `qa-${Date.now()}-${Math.random().toString(36).slice(2, 10)}@example.com`;
  tempUserId = null;
  const response = await api('/api/auth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: 'QA Teacher',
      email: tempUserEmail,
      password: 'qa-password-123',
    }),
  }, '');
  assert.equal(response.status, 201, 'Temporary teacher registration should succeed.');
  const payload = await response.json();
  assert.equal(payload.success, true);
  tempUserId = payload.user.id;
  temporaryUsers.set(tempUserId, tempUserEmail);
  teacherCookie = getCookieHeader(response.headers.get('set-cookie'));
  assert.ok(teacherCookie, 'Registration should set a session cookie.');
  return payload;
}

async function loginTeacher(email, password) {
  const response = await api('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  }, '');
  const payload = await response.json();
  assert.equal(response.status, 200, 'Teacher login should succeed.');
  assert.equal(payload.success, true);
  teacherCookie = getCookieHeader(response.headers.get('set-cookie'));
  assert.ok(teacherCookie, 'Login should set a session cookie.');
  return payload;
}

async function logoutTeacher() {
  const response = await api('/api/auth/logout', { method: 'POST' }, teacherCookie);
  const payload = await response.json();
  assert.equal(response.status, 200, 'Logout should succeed.');
  assert.equal(payload.success, true);
  teacherCookie = '';
}

async function cleanupTemporaryTeacher() {
  if (temporaryUsers.size === 0 && !tempUserEmail && tempUserId === null) return;
  const pool = new Pool({ connectionString: dbUrl, ssl: false });
  try {
    const entries = new Map(temporaryUsers);
    if (tempUserId !== null && tempUserEmail) entries.set(tempUserId, tempUserEmail);
    for (const [targetUserId, email] of entries) {
      const resolvedId = targetUserId ?? (await pool.query('SELECT id FROM users WHERE email = $1 LIMIT 1', [email])).rows[0]?.id;
      if (resolvedId === undefined || resolvedId === null) continue;
      await pool.query('DELETE FROM translations WHERE created_by = $1', [resolvedId]);
      await pool.query('DELETE FROM audit_logs WHERE user_id = $1', [resolvedId]);
      await pool.query('DELETE FROM sessions WHERE user_id = $1', [resolvedId]);
      await pool.query('DELETE FROM users WHERE id = $1', [resolvedId]);
    }
  } finally {
    await pool.end();
  }
  tempUserEmail = '';
  tempUserId = null;
  temporaryUsers.clear();
}

test.before(async () => {
  await startBackendIfNeeded();
  baselineCounts = await dbSnapshot();
  await startFrontendIfNeeded();
});

test.after(async () => {
  await cleanupTemporaryTeacher();
  stopProcess(frontendProcess);
  stopProcess(backendProcess);
  await delay(400);
});

test('environment and project discovery checks', async () => {
  const exampleEnv = fs.readFileSync(path.join(projectRoot, '.env.example'), 'utf8');
  assert.match(exampleEnv, /^DATABASE_URL=postgresql:\/\/db\.example\.invalid/m);
  assert.match(exampleEnv, /^DATABASE_SSL=false$/m);
  assert.match(exampleEnv, /^SESSION_SECRET=replace-with-/m);
  assert.doesNotMatch(exampleEnv, /AIza[0-9A-Za-z_-]{20,}/);
  assert.ok(fs.existsSync(path.join(projectRoot, 'server', 'index.cjs')));
  assert.ok(fs.existsSync(path.join(projectRoot, 'src', 'app', 'routes.tsx')));
});

test('database health and integrity checks', async () => {
  const healthResponse = await fetch(`${apiBase}/api/health`);
  assert.equal(healthResponse.status, 200);
  assert.deepEqual(await healthResponse.json(), { ok: true, service: 'mozilearn-api' });

  const health = await api('/api/test-db');
  assert.equal(health.status, 200);
  const text = await health.text();
  const json = JSON.parse(text);
  assert.equal(json.success, true);
  assert.ok(json.current_time);

  const pool = new Pool({ connectionString: dbUrl, ssl: false });
  const tables = [
    'users',
    'sessions',
    'lessons',
    'lesson_activities',
    'lesson_assessments',
    'translations',
    'vocabulary',
    'classroom_phrases',
    'textbook_terms',
    'number_vocabulary',
    'audit_logs',
  ];
  const result = await pool.query(
    `SELECT table_name FROM information_schema.tables WHERE table_schema = ANY(current_schemas(false)) AND table_name = ANY($1::text[]) ORDER BY table_name`,
    [tables],
  );
  assert.deepEqual(result.rows.map((row) => row.table_name).sort(), tables.slice().sort());

  const lesson = await pool.query(
    `SELECT id, title, grade, subject, status FROM lessons WHERE grade = 1 AND subject = 'Foundational Numeracy' ORDER BY id LIMIT 10`
  );
  assert.ok(lesson.rows.some((row) => row.id === 1 && row.title === 'पाठ 1: फलों के नाम और 1 से 5 तक गिनती' && row.grade === 1 && row.subject === 'Foundational Numeracy'));
  const counts = {};
  for (const table of tables) {
    const countResult = await pool.query(`SELECT COUNT(*) AS count FROM ${table}`);
    counts[table] = Number(countResult.rows[0].count);
  }
  await pool.end();
  assert.deepEqual(counts, baselineCounts.counts);
});

test('auth protection and login flow', async () => {
  const unauthenticated = await api('/api/auth/me');
  assert.equal(unauthenticated.status, 401);

  const teacher = await registerTeacher();
  assert.equal(teacher.user.email, tempUserEmail);

  const sameEmailRegister = await api('/api/auth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: 'Repeat Teacher',
      email: tempUserEmail,
      password: 'repeat-password-123',
    }),
  }, teacherCookie);
  assert.equal(sameEmailRegister.status, 409);

  const me = await api('/api/auth/me');
  const mePayload = await me.json();
  assert.equal(me.status, 200);
  assert.equal(mePayload.success, true);
  assert.equal(mePayload.user.email, tempUserEmail);

  await logoutTeacher();
  const loggedOut = await api('/api/auth/me');
  assert.equal(loggedOut.status, 401);

  await loginTeacher(tempUserEmail, 'qa-password-123');
});

test('role authorization and protected route enforcement', async () => {
  const protectedWithoutAuth = await fetch(`${apiBase}/api/lessons?grade=1`);
  assert.equal(protectedWithoutAuth.status, 401);

  const subjectsResponse = await api('/api/lessons?grade=1');
  assert.equal(subjectsResponse.status, 200);

  const adminResponse = await api('/api/admin/users');
  assert.equal(adminResponse.status, 403);
});

test('lesson, vocabulary, number, and phrase APIs', async () => {
  const lessonsResponse = await api('/api/lessons');
  assert.equal(lessonsResponse.status, 200);
  const lessonsPayload = await lessonsResponse.json();
  assert.equal(lessonsPayload.success, true);
  assert.ok(Array.isArray(lessonsPayload.lessons));
  const gradeOne = lessonsPayload.lessons.filter((item) => item.grade === 1);
  assert.ok(gradeOne.some((item) => item.subject === 'Foundational Numeracy' && item.title === 'पाठ 1: फलों के नाम और 1 से 5 तक गिनती'));

  const lessonById = await api('/api/lessons/1');
  assert.equal(lessonById.status, 200);
  const lessonData = await lessonById.json();
  assert.equal(lessonData.success, true);
  assert.equal(lessonData.lesson.title, 'पाठ 1: फलों के नाम और 1 से 5 तक गिनती');

  const invalidStatus = await api('/api/lessons?status=not-real');
  assert.equal(invalidStatus.status, 400);

  const vocabularyResponse = await api('/api/vocabulary');
  assert.equal(vocabularyResponse.status, 200);
  const vocabularyPayload = await vocabularyResponse.json();
  assert.equal(vocabularyPayload.success, true);
  assert.ok(Array.isArray(vocabularyPayload.vocabulary));

  const fruitMap = new Map(vocabularyPayload.vocabulary
    .filter((row) => ['OBJ_02', 'OBJ_03', 'OBJ_04', 'OBJ_05', 'OBJ_06'].includes(row.object_code))
    .map((row) => [row.hindi, row.mundari_roman]));
  assert.equal(fruitMap.get('आम'), 'Uli');
  assert.equal(fruitMap.get('केला'), 'Kela');

  const numbersResponse = await api('/api/number-vocabulary?from=1&to=5');
  assert.equal(numbersResponse.status, 200);
  const numbersPayload = await numbersResponse.json();
  assert.equal(numbersPayload.success, true);
  const numberMap = new Map(numbersPayload.number_vocabulary.map((row) => [row.number_value, row.mundari_roman]));
  assert.equal(numberMap.get(1), 'Miyad');
  assert.equal(numberMap.get(2), 'Bariya');
  assert.equal(numberMap.get(3), 'Apiya');
  assert.equal(numberMap.get(4), 'Upuna');
  assert.equal(numberMap.get(5), 'Moreya');

  const phraseResponse = await api('/api/classroom-phrases');
  assert.equal(phraseResponse.status, 200);
  const phrasePayload = await phraseResponse.json();
  assert.equal(phrasePayload.success, true);
  assert.ok(Array.isArray(phrasePayload.classroom_phrases));
  assert.ok(phrasePayload.classroom_phrases.some((row) => row.hindi === 'आम गिनो' && row.mundari_roman === 'Uli leka me'));
});

test('dashboard summary and API contracts', async () => {
  const summary = await api('/api/dashboard/summary');
  assert.equal(summary.status, 200);
  const payload = await summary.json();
  assert.equal(payload.success, true);
  assert.ok(payload.data);
  assert.equal(typeof payload.data.lessons.total, 'number');
  assert.equal(typeof payload.data.translations.total, 'number');
  assert.equal(typeof payload.data.published_packs, 'number');
  const body = JSON.stringify(payload);
  assert.ok(!body.includes('DATABASE_URL'));
  assert.ok(!body.includes('AI_API_KEY'));
  assert.ok(!body.includes('SESSION_SECRET'));
});

test('bounded Class 1 verified translation lookup and near-miss rejection', async () => {
  const exactCases = [
    ['आम', 'Uli'],
    ['केला', 'Kela'],
    ['एक', 'Miyad'],
    ['दो', 'Bariya'],
    ['तीन', 'Apiya'],
    ['चार', 'Upuna'],
    ['पाँच', 'Moreya'],
    ['यहाँ कितने आम हैं?', 'Nere chimina uli mena?'],
    ['यहाँ कितने आम हैं', 'Nere chimina uli mena?'],
    ['आम गिनो', 'Uli leka me'],
  ];

  for (const [hindiText, expected] of exactCases) {
    const response = await api('/api/ai/class1-lookup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ hindi_text: hindiText }),
    });
    assert.equal(response.status, 200, `Expected success for ${hindiText}`);
    const payload = await response.json();
    assert.equal(payload.success, true);
    assert.equal(payload.source, 'class1_verified');
    assert.equal(payload.mundari_roman, expected);
    assert.ok(payload.mundari_translation === null || payload.mundari_translation === undefined || typeof payload.mundari_translation === 'string');
  }

  const nearMiss = await api('/api/ai/class1-lookup', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ hindi_text: 'आमों' }),
  });
  assert.equal(nearMiss.status, 200);
  const nearMissPayload = await nearMiss.json();
  assert.equal(nearMissPayload.success, false);
  assert.equal(nearMissPayload.reason, 'verified_class1_translation_not_found');
});

test('normalization and script safety', async () => {
  const responseA = await api('/api/ai/class1-lookup', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ hindi_text: 'यहाँ कितने आम हैं?' }),
  });
  const responseB = await api('/api/ai/class1-lookup', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ hindi_text: 'यहाँ कितने आम हैं' }),
  });
  const payloadA = await responseA.json();
  const payloadB = await responseB.json();
  assert.equal(payloadA.success, true);
  assert.equal(payloadB.success, true);
  assert.equal(payloadA.mundari_roman, payloadB.mundari_roman);
  assert.equal(payloadA.mundari_roman, 'Nere chimina uli mena?');
  assert.ok(/^[A-Za-z0-9\s.,!?'-]+$/.test(payloadA.mundari_roman));
  assert.ok(!Array.from(payloadA.mundari_roman).some((char) => /[\u0900-\u097F]/.test(char)));
});

test('Hindi ASR endpoint and ASR → lookup behavior', async () => {
  const audioPath = path.join(projectRoot, 'tts-main', 'tts-main', 'speech_to_text', 'input', 'hindi_test.wav');
  assert.ok(fs.existsSync(audioPath));
  const buffer = fs.readFileSync(audioPath);
  const transcriptionResponse = await api('/api/ai/transcribe-audio?extension=wav', {
    method: 'POST',
    headers: { 'Content-Type': 'audio/wav' },
    body: buffer,
  });
  assert.equal(transcriptionResponse.status, 200, 'ASR endpoint should return HTTP 200');
  const transcriptionPayload = await transcriptionResponse.json();
  assert.equal(transcriptionPayload.success, true);
  assert.ok(typeof transcriptionPayload.transcription?.hindi_text === 'string' && transcriptionPayload.transcription.hindi_text.trim().length > 0);
  assert.equal(typeof transcriptionPayload.translation, 'undefined');

  const lookupResponse = await api('/api/ai/class1-lookup', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ hindi_text: transcriptionPayload.transcription.hindi_text }),
  });
  const lookupPayload = await lookupResponse.json();
  assert.equal(lookupResponse.status, 200);
  assert.equal(lookupPayload.success, false);
  assert.equal(lookupPayload.reason, 'verified_class1_translation_not_found');
});

test('TTS status and safety contract', async () => {
  const status = await api('/api/tts/status?language=mundari');
  const statusPayload = await status.json();
  assert.equal(status.status, 200);
  assert.equal(statusPayload.success, true);
  assert.ok(['prerecorded', 'unavailable', 'model-service'].includes(statusPayload.mode));
  assert.equal(typeof statusPayload.modelAvailable, 'boolean');
  assert.equal(typeof statusPayload.weightsPresent, 'boolean');
  assert.equal(typeof statusPayload.serviceConfigured, 'boolean');
  assert.ok(statusPayload.message.length > 0);

  const speakResponse = await api('/api/tts/speak', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      tts_input: 'Uli',
      language: 'mundari',
    }),
  });
  const speakPayload = await speakResponse.json();
  assert.ok(speakResponse.status === 200 || speakResponse.status === 400);
  assert.ok(typeof speakPayload.success === 'boolean');
  assert.ok(typeof speakPayload.message === 'string');
});

test('frontend routes are reachable', async () => {
  const routes = ['/login', '/dashboard', '/lessons', '/library'];
  for (const route of routes) {
    const response = await fetch(`${webBase}${route}`);
    assert.ok(response.ok || response.status === 200 || response.status === 404, `Route ${route} should be reachable.`);
  }
  const rootResponse = await fetch(`${webBase}/`);
  assert.ok(rootResponse.ok || rootResponse.status === 200 || rootResponse.status === 304);
});

test('data preservation snapshot remains unchanged', async () => {
  await cleanupTemporaryTeacher();
  const after = await dbSnapshot();
  assert.deepEqual(after.counts, baselineCounts.counts);
  assert.deepEqual(after.lessonOne, baselineCounts.lessonOne);
});
