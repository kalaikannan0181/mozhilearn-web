const express = require('express');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const { pool } = require('../db.cjs');
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
const RESET_TOKEN_MINUTES = 20;
const isProduction = process.env.NODE_ENV === 'production';
const registrationLimit = createRateLimiter({ windowMs: 60 * 60 * 1000, max: isProduction ? 5 : 500, message: 'Too many registration attempts. Try again later.' });
const loginLimit = createRateLimiter({ windowMs: 15 * 60 * 1000, max: isProduction ? 10 : 500, message: 'Too many login attempts. Try again later.' });
const resetRequestLimit = createRateLimiter({ windowMs: 60 * 60 * 1000, max: isProduction ? 5 : 30, message: 'Too many password reset requests. Try again later.' });
const resetCompletionLimit = createRateLimiter({ windowMs: 15 * 60 * 1000, max: isProduction ? 10 : 60, message: 'Too many password reset attempts. Try again later.' });
const PASSWORD_RESET_MESSAGE = 'If an account exists for that email, a password reset link will be sent.';

function publicUser(row) {
  return {
    id: row.id,
    email: row.email,
    user_metadata: { full_name: row.full_name },
    role: row.role,
  };
}

function maskEmail(email) {
  const [localPart, domain] = email.split('@');
  return domain ? `${localPart.slice(0, 1)}***@${domain}` : 'invalid';
}

function hashFormat(hash) {
  if (typeof hash !== 'string' || !hash) return 'missing';
  if (/^\$2[aby]\$\d{2}\$/.test(hash)) return 'bcrypt';
  if (/^\$argon2(?:id|i|d)\$/.test(hash)) return 'argon2';
  return 'other';
}

function safeFailureCode(error) {
  const code = typeof error?.code === 'string' ? error.code : error?.name;
  return typeof code === 'string' && /^[A-Z0-9_]{1,32}$/.test(code) ? code : 'INTERNAL_ERROR';
}

function logAuthDiagnostic(event, details) {
  console.info('[auth-diagnostic]', JSON.stringify({ event, ...details }));
}

function passwordResetConfiguration() {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.PASSWORD_RESET_FROM;
  const appUrl = process.env.PASSWORD_RESET_URL;
  if (!apiKey || !from || !appUrl) {
    const error = new Error('Password reset email is not configured.');
    error.code = 'RESET_EMAIL_NOT_CONFIGURED';
    throw error;
  }

  let resetUrl;
  try {
    resetUrl = new URL('/reset-password', appUrl);
  } catch {
    const error = new Error('Password reset URL configuration is invalid.');
    error.code = 'RESET_URL_INVALID';
    throw error;
  }
  if ((isProduction && resetUrl.protocol !== 'https:') || !['https:', 'http:'].includes(resetUrl.protocol)) {
    const error = new Error('Password reset URL must use HTTPS in production.');
    error.code = 'RESET_URL_INVALID';
    throw error;
  }
  return { apiKey, from, resetUrl };
}

async function sendPasswordResetEmail(email, token) {
  const { apiKey, from, resetUrl } = passwordResetConfiguration();
  resetUrl.hash = new URLSearchParams({ token }).toString();
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from,
      to: [email],
      subject: 'Reset your MozhiLearn password',
      text: `A password reset was requested for your MozhiLearn account. This link expires in ${RESET_TOKEN_MINUTES} minutes and can only be used once:\n\n${resetUrl.toString()}\n\nIf you did not request this, you can ignore this email.`,
    }),
  });
  if (!response.ok) {
    const error = new Error('Password reset email delivery failed.');
    error.code = `RESET_EMAIL_HTTP_${response.status}`;
    throw error;
  }
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

function isDbError(error) {
  if (!error) return false;
  const code = String(error.code || '');
  const msg = String(error.message || '').toLowerCase();
  return (
    code.startsWith('08') ||
    code.startsWith('57P') ||
    code === 'ECONNREFUSED' ||
    code === 'ENOTFOUND' ||
    code === 'ETIMEDOUT' ||
    code === '28P01' ||
    code === '3D000' ||
    code === '42P01' ||
    msg.includes('connection') ||
    msg.includes('ssl') ||
    msg.includes('connect') ||
    msg.includes('timeout')
  );
}

router.get('/api/auth/csrf', (_request, response) => {
  const token = createCsrfToken();
  setCsrfCookie(response, token);
  return response.status(200).json({ success: true, csrf_token: token });
});

router.post('/api/auth/password-reset/request', resetRequestLimit, async (request, response) => {
  const email = typeof request.body?.email === 'string' ? request.body.email.trim().toLowerCase() : '';
  if (!email || email.length > 320 || !email.includes('@')) {
    return response.status(400).json({ success: false, code: 'VALIDATION_ERROR', error: 'Enter a valid email address.' });
  }

  try {
    passwordResetConfiguration();
    const result = await query('SELECT id FROM users WHERE email = $1', [email]);
    if (result.rows[0]) {
      const token = crypto.randomBytes(32).toString('hex');
      const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
      await query(
        `INSERT INTO password_reset_tokens (token_hash, user_id, expires_at)
         VALUES ($1, $2, CURRENT_TIMESTAMP + ($3 * INTERVAL '1 minute'))
         ON CONFLICT (user_id) DO UPDATE
         SET token_hash = EXCLUDED.token_hash,
             expires_at = EXCLUDED.expires_at,
             created_at = CURRENT_TIMESTAMP`,
        [tokenHash, result.rows[0].id, RESET_TOKEN_MINUTES]
      );

      try {
        await sendPasswordResetEmail(email, token);
      } catch (error) {
        await query('DELETE FROM password_reset_tokens WHERE token_hash = $1', [tokenHash]).catch(() => {});
        logError('Password reset email delivery error:', error);
      }
    }

    return response.status(200).json({ success: true, message: PASSWORD_RESET_MESSAGE });
  } catch (error) {
    logError('POST /api/auth/password-reset/request error:', error);
    const isDb = isDbError(error);
    const isConfigurationError = ['RESET_EMAIL_NOT_CONFIGURED', 'RESET_URL_INVALID'].includes(error.code);
    return response.status(isDb || isConfigurationError ? 503 : 500).json({
      success: false,
      code: isDb ? 'DATABASE_UNAVAILABLE' : isConfigurationError ? 'RESET_EMAIL_UNAVAILABLE' : 'RESET_REQUEST_ERROR',
      error: isDb || isConfigurationError ? 'Password reset is temporarily unavailable.' : 'Server error. Please try again.',
    });
  }
});

router.post('/api/auth/password-reset/complete', resetCompletionLimit, async (request, response) => {
  const { token, password } = request.body || {};
  if (typeof token !== 'string' || !/^[a-f0-9]{64}$/.test(token) || typeof password !== 'string' || password.length < 8 || password.length > 128) {
    return response.status(400).json({
      success: false,
      code: 'VALIDATION_ERROR',
      error: 'A valid reset link and a password between 8 and 128 characters are required.',
    });
  }

  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  const client = await pool.connect().catch((error) => {
    logError('POST /api/auth/password-reset/complete connection error:', error);
    return null;
  });
  if (!client) {
    return response.status(503).json({ success: false, code: 'DATABASE_UNAVAILABLE', error: 'Password reset is temporarily unavailable.' });
  }

  try {
    await client.query('BEGIN');
    const reset = await client.query(
      `SELECT user_id FROM password_reset_tokens
       WHERE token_hash = $1 AND expires_at > CURRENT_TIMESTAMP
       FOR UPDATE`,
      [tokenHash]
    );
    if (!reset.rows[0]) {
      await client.query('ROLLBACK');
      return response.status(400).json({ success: false, code: 'INVALID_OR_EXPIRED_RESET_TOKEN', error: 'This reset link is invalid or expired. Request a new one.' });
    }

    const passwordHash = await bcrypt.hash(password, 12);
    await client.query(
      'UPDATE users SET password_hash = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
      [passwordHash, reset.rows[0].user_id]
    );
    await client.query('DELETE FROM password_reset_tokens WHERE token_hash = $1', [tokenHash]);
    await client.query('DELETE FROM sessions WHERE user_id = $1', [reset.rows[0].user_id]);
    await client.query('COMMIT');

    await audit({ userId: reset.rows[0].user_id, action: 'password_reset', entityType: 'user', entityId: reset.rows[0].user_id });
    return response.status(200).json({ success: true, message: 'Password updated. Sign in with your new password.' });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    logError('POST /api/auth/password-reset/complete error:', error);
    const isDb = isDbError(error);
    return response.status(isDb ? 503 : 500).json({
      success: false,
      code: isDb ? 'DATABASE_UNAVAILABLE' : 'RESET_COMPLETION_ERROR',
      error: isDb ? 'Password reset is temporarily unavailable.' : 'Server error. Please try again.',
    });
  } finally {
    client.release();
  }
});

router.post('/api/auth/register', registrationLimit, async (request, response) => {
  const { name, email, password } = request.body || {};
  const trimmedName = typeof name === 'string' ? name.trim() : '';
  const normalizedEmail = typeof email === 'string' ? email.trim().toLowerCase() : '';

  if (!trimmedName || trimmedName.length > 200 || !normalizedEmail || normalizedEmail.length > 320 || !normalizedEmail.includes('@') || typeof password !== 'string' || password.length < 8 || password.length > 128) {
    return response.status(400).json({
      success: false,
      code: 'VALIDATION_ERROR',
      error: 'Name, valid email, and a password between 8 and 128 characters are required.',
      message: 'Name, valid email, and a password between 8 and 128 characters are required.',
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
      return response.status(409).json({
        success: false,
        code: 'EMAIL_ALREADY_EXISTS',
        error: 'An account with this email already exists.',
        message: 'An account with this email already exists.',
      });
    }

    logError('POST /api/auth/register error:', error);
    const isDb = isDbError(error);
    return response.status(isDb ? 503 : 500).json({
      success: false,
      code: isDb ? 'DATABASE_UNAVAILABLE' : 'REGISTRATION_ERROR',
      error: isDb ? 'Backend service is temporarily unavailable.' : 'Server error. Please try again.',
      message: isDb ? 'Backend service is temporarily unavailable.' : 'Server error. Please try again.',
    });
  }
});

router.post('/api/auth/login', loginLimit, async (request, response) => {
  const { email, password } = request.body || {};
  const normalizedEmail = typeof email === 'string' ? email.trim().toLowerCase() : '';

  if (!normalizedEmail || typeof password !== 'string' || !password) {
    return response.status(400).json({
      success: false,
      code: 'VALIDATION_ERROR',
      error: 'Email and password are required.',
      message: 'Email and password are required.',
    });
  }

  const maskedEmail = maskEmail(normalizedEmail);
  let stage = 'user_lookup';
  logAuthDiagnostic('login_attempt', { email: maskedEmail });

  try {
    const result = await query(
      `SELECT id, email, full_name, role, password_hash
       FROM users
       WHERE email = $1`,
      [normalizedEmail]
    );
    const user = result.rows[0];
    logAuthDiagnostic('login_user_lookup', {
      email: maskedEmail,
      userFound: Boolean(user),
      hashFormat: hashFormat(user?.password_hash),
    });

    stage = 'password_comparison';
    const validPassword = user ? await bcrypt.compare(password, user.password_hash) : false;
    logAuthDiagnostic('login_password_comparison', { email: maskedEmail, passwordMatch: validPassword });

    if (!user || !validPassword) {
      logAuthDiagnostic('login_rejected', {
        email: maskedEmail,
        failureStage: user ? 'password_comparison' : 'user_lookup',
        failureCode: user ? 'PASSWORD_MISMATCH' : 'USER_NOT_FOUND',
      });
      return response.status(401).json({
        success: false,
        code: 'INVALID_CREDENTIALS',
        error: 'Invalid email or password.',
        message: 'Invalid email or password.',
      });
    }

    stage = 'session_creation';
    await createSession(user.id, response);
    logAuthDiagnostic('login_session_created', { email: maskedEmail });

    stage = 'audit_write';
    await audit({ userId: user.id, action: 'login', entityType: 'user', entityId: user.id });
    logAuthDiagnostic('login_success', { email: maskedEmail });
    return response.status(200).json({ success: true, user: publicUser(user) });
  } catch (error) {
    logAuthDiagnostic('login_error', {
      email: maskedEmail,
      failureStage: stage,
      failureCode: safeFailureCode(error),
    });
    logError('POST /api/auth/login error:', error);
    const isDb = isDbError(error);
    return response.status(isDb ? 503 : 500).json({
      success: false,
      code: isDb ? 'DATABASE_UNAVAILABLE' : 'LOGIN_ERROR',
      error: isDb ? 'Backend service is temporarily unavailable.' : 'Server error. Please try again.',
      message: isDb ? 'Backend service is temporarily unavailable.' : 'Server error. Please try again.',
    });
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
    return response.status(200).json({ success: true, message: 'Logged out successfully' });
  } catch (error) {
    logError('POST /api/auth/logout error:', error);
    return response.status(500).json({ success: false, message: 'Failed to sign out' });
  }
});

router.get('/api/auth/me', (request, response) => {
  if (!request.auth) {
    return response.status(401).json({
      success: false,
      code: 'UNAUTHORIZED',
      error: 'Authentication required',
      message: 'Authentication required',
    });
  }

  return response.status(200).json({ success: true, user: publicUser(request.auth) });
});

module.exports = router;

