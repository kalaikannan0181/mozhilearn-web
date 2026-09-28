const crypto = require('crypto');
const { query } = require('../db.cjs');
const { requireRole } = require('./roles.cjs');

const SESSION_COOKIE = 'mozhi_session';

function hashSessionToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function readCookie(request, name) {
  const header = request.headers.cookie || '';
  const pair = header.split(';').map((part) => part.trim()).find((part) => part.startsWith(`${name}=`));
  return pair ? decodeURIComponent(pair.slice(name.length + 1)) : null;
}

async function attachAuth(request, _response, next) {
  try {
    const token = readCookie(request, SESSION_COOKIE);
    if (!token) {
      return next();
    }

    const result = await query(
      `SELECT u.id, u.email, u.full_name, u.role
       FROM sessions s
       JOIN users u ON u.id = s.user_id
       WHERE s.token_hash = $1 AND s.expires_at > CURRENT_TIMESTAMP`,
      [hashSessionToken(token)]
    );

    if (result.rows[0]) {
      request.auth = result.rows[0];
    }

    return next();
  } catch (error) {
    return next(error);
  }
}

function requireAuth(request, response, next) {
  if (!request.auth) {
    return response.status(401).json({ success: false, message: 'Authentication required' });
  }

  return next();
}

function setSessionCookie(response, token) {
  const isProduction = process.env.NODE_ENV === 'production';
  const cookiePolicy = `HttpOnly; SameSite=${isProduction ? 'None' : 'Lax'}${isProduction ? '; Secure' : ''}`;
  response.append('Set-Cookie', `${SESSION_COOKIE}=${encodeURIComponent(token)}; Max-Age=604800; Path=/; ${cookiePolicy}`);
}

function clearSessionCookie(response) {
  const isProduction = process.env.NODE_ENV === 'production';
  const cookiePolicy = `HttpOnly; SameSite=${isProduction ? 'None' : 'Lax'}${isProduction ? '; Secure' : ''}`;
  response.append('Set-Cookie', `${SESSION_COOKIE}=; Max-Age=0; Path=/; ${cookiePolicy}`);
}

function createSessionToken() {
  return crypto.randomBytes(32).toString('hex');
}

module.exports = {
  SESSION_COOKIE,
  attachAuth,
  clearSessionCookie,
  createSessionToken,
  hashSessionToken,
  requireAuth,
  requireRole,
  setSessionCookie,
};
