const crypto = require('crypto');

const developmentSecret = crypto.randomBytes(32);
const COOKIE_NAME = 'mozhi_csrf';

function secret() {
  return process.env.SESSION_SECRET || developmentSecret;
}

function equal(left, right) {
  const leftBuffer = Buffer.from(String(left || ''));
  const rightBuffer = Buffer.from(String(right || ''));
  return leftBuffer.length === rightBuffer.length && crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function createCsrfToken() {
  const nonce = crypto.randomBytes(32).toString('base64url');
  const signature = crypto.createHmac('sha256', secret()).update(nonce).digest('base64url');
  return `${nonce}.${signature}`;
}

function validateCsrfToken(token) {
  if (typeof token !== 'string') return false;
  const separator = token.indexOf('.');
  if (separator < 1) return false;
  const nonce = token.slice(0, separator);
  const suppliedSignature = token.slice(separator + 1);
  const expectedSignature = crypto.createHmac('sha256', secret()).update(nonce).digest('base64url');
  return equal(suppliedSignature, expectedSignature);
}

function readCookie(request, name) {
  const pair = (request.headers.cookie || '')
    .split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${name}=`));
  return pair ? decodeURIComponent(pair.slice(name.length + 1)) : null;
}

function setCsrfCookie(response, token) {
  const production = process.env.NODE_ENV === 'production';
  const sameSite = production ? 'None' : 'Lax';
  response.append('Set-Cookie', `${COOKIE_NAME}=${encodeURIComponent(token)}; Max-Age=86400; Path=/; HttpOnly; SameSite=${sameSite}${production ? '; Secure' : ''}`);
}

function csrfProtection(allowedOrigins) {
  return (request, response, next) => {
    if (['GET', 'HEAD', 'OPTIONS'].includes(request.method)) return next();
    if (!request.auth && !['/api/auth/login', '/api/auth/register'].includes(request.path)) return next();

    const origin = request.get('origin');
    if ((process.env.NODE_ENV === 'production' && !origin) || (origin && !allowedOrigins.has(origin))) {
      return response.status(403).json({
        success: false,
        code: 'CORS_ERROR',
        error: 'Cross-origin request blocked by CORS policy.',
        message: 'Cross-origin request blocked by CORS policy.',
      });
    }

    const cookieToken = readCookie(request, COOKIE_NAME);
    const headerToken = request.get('x-csrf-token');
    if (!cookieToken || !headerToken || !equal(cookieToken, headerToken) || !validateCsrfToken(headerToken)) {
      return response.status(403).json({
        success: false,
        code: 'INVALID_CSRF_TOKEN',
        error: 'Invalid CSRF token.',
        message: 'Invalid CSRF token.',
      });
    }

    return next();
  };
}

module.exports = { createCsrfToken, csrfProtection, setCsrfCookie };
