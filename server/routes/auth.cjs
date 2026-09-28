const express = require('express');
const bcrypt = require('bcryptjs');
const { query } = require('../db.cjs');
const {
  clearSessionCookie,
  createSessionToken,
  hashSessionToken,
  setSessionCookie,
} = require('../middleware/auth.cjs');
const { audit } = require('../lib/audit.cjs');
const { logError } = require('../lib/logger.cjs');
const { createCsrfToken, setCsrfCookie } = require('../middleware/csrf.cjs');
const { createRateLimiter } = require('../middleware/rateLimit.cjs');

const router = express.Router();
const SESSION_DAYS = 7;
const registrationLimit = createRateLimiter({ windowMs: 60 * 60 * 1000, max: 5, message: 'Too many registration attempts. Try again later.' });
const loginLimit = createRateLimiter({ windowMs: 15 * 60 * 1000, max: 10, message: 'Too many login attempts. Try again later.' });

function publicUser(row) {
  return {
    id: row.id,
    email: row.email,
    user_metadata: { full_name: row.full_name },
    role: row.role,
  };
}

async function createSession(userId, response) {
  const token = createSessionToken();
  await query(
    `INSERT INTO sessions (token_hash, user_id, expires_at)
     VALUES ($1, $2, CURRENT_TIMESTAMP + ($3 * INTERVAL '1 day'))`,
    [hashSessionToken(token), userId, SESSION_DAYS]
  );
  setSessionCookie(response, token);
}

router.get('/api/auth/csrf', (_request, response) => {
  const token = createCsrfToken();
  setCsrfCookie(response, token);
  return response.status(200).json({ success: true, csrf_token: token });
});

router.post('/api/auth/register', registrationLimit, async (request, response) => {
  const { name, email, password } = request.body || {};
  const trimmedName = typeof name === 'string' ? name.trim() : '';
  const normalizedEmail = typeof email === 'string' ? email.trim().toLowerCase() : '';

  if (!trimmedName || trimmedName.length > 200 || !normalizedEmail || normalizedEmail.length > 320 || !normalizedEmail.includes('@') || typeof password !== 'string' || password.length < 12 || password.length > 128) {
    return response.status(400).json({
      success: false,
      message: 'Name, valid email, and a password between 12 and 128 characters are required',
    });
  }

  try {
    const passwordHash = await bcrypt.hash(password, 12);
    const result = await query(
      `INSERT INTO users (email, password_hash, full_name, role)
       VALUES ($1, $2, $3, 'teacher')
       RETURNING id, email, full_name, role`,
      [normalizedEmail, passwordHash, trimmedName]
    );

    await createSession(result.rows[0].id, response);
    await audit({ userId: result.rows[0].id, action: 'user_registered', entityType: 'user', entityId: result.rows[0].id });
    return response.status(201).json({ success: true, user: publicUser(result.rows[0]) });
  } catch (error) {
    if (error.code === '23505') {
      return response.status(409).json({ success: false, message: 'An account with this email already exists' });
    }

    logError('POST /api/auth/register error:', error);
    return response.status(500).json({ success: false, message: 'Failed to create account' });
  }
});

router.post('/api/auth/login', loginLimit, async (request, response) => {
  const { email, password } = request.body || {};
  const normalizedEmail = typeof email === 'string' ? email.trim().toLowerCase() : '';

  if (!normalizedEmail || typeof password !== 'string' || !password) {
    return response.status(400).json({ success: false, message: 'Email and password are required' });
  }

  try {
    const result = await query(
      `SELECT id, email, full_name, role, password_hash
       FROM users
       WHERE email = $1`,
      [normalizedEmail]
    );
    const user = result.rows[0];
    const validPassword = user ? await bcrypt.compare(password, user.password_hash) : false;

    if (!user || !validPassword) {
      return response.status(401).json({ success: false, message: 'Invalid login credentials' });
    }

    await createSession(user.id, response);
    await audit({ userId: user.id, action: 'login', entityType: 'user', entityId: user.id });
    return response.status(200).json({ success: true, user: publicUser(user) });
  } catch (error) {
    logError('POST /api/auth/login error:', error);
    return response.status(500).json({ success: false, message: 'Failed to sign in' });
  }
});

router.post('/api/auth/logout', async (request, response) => {
  const cookie = request.headers.cookie || '';
  const tokenPair = cookie.split(';').map((part) => part.trim()).find((part) => part.startsWith('mozhi_session='));

  try {
    if (tokenPair) {
      const token = decodeURIComponent(tokenPair.slice('mozhi_session='.length));
      await query('DELETE FROM sessions WHERE token_hash = $1', [hashSessionToken(token)]);
    }

    clearSessionCookie(response);
    return response.status(200).json({ success: true });
  } catch (error) {
    logError('POST /api/auth/logout error:', error);
    return response.status(500).json({ success: false, message: 'Failed to sign out' });
  }
});

router.get('/api/auth/me', (request, response) => {
  if (!request.auth) {
    return response.status(401).json({ success: false, message: 'Authentication required' });
  }

  return response.status(200).json({ success: true, user: publicUser(request.auth) });
});

module.exports = router;
