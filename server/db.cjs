const { Pool } = require('pg');
const { logError } = require('./lib/logger.cjs');
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env.local') });
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

function isSslNegotiationError(err) {
  if (!err) return false;
  const msg = String(err.message || '').toLowerCase();
  return (
    msg.includes('no encryption') ||
    msg.includes('ssl is required') ||
    msg.includes('ssl required') ||
    msg.includes('no pg_hba.conf entry') ||
    msg.includes('server does not support ssl') ||
    msg.includes('self-signed certificate') ||
    msg.includes('unable to verify the first certificate')
  );
}

function resolveSsl(allowSsl) {
  if (!allowSsl) return false;
  const rejectUnauthorized = process.env.DATABASE_SSL_REJECT_UNAUTHORIZED === 'true';
  return { rejectUnauthorized };
}

function determineInitialSsl() {
  const connectionString = process.env.DATABASE_URL || '';
  const isLocal = /localhost|127\.0\.0\.1/i.test(connectionString);
  if (isLocal) {
    return process.env.DATABASE_SSL === 'true';
  }
  if (process.env.DATABASE_SSL === 'false') {
    return false;
  }
  return true;
}

let currentSsl = determineInitialSsl();

function createInternalPool(useSsl) {
  const p = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: resolveSsl(useSsl),
    max: 10,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 10000,
  });
  p.on('error', (err) => {
    logError('Unexpected idle PostgreSQL client error:', err);
  });
  return p;
}

let activePool = createInternalPool(currentSsl);

async function connectWithRetry() {
  try {
    return await activePool.connect();
  } catch (err) {
    if (isSslNegotiationError(err)) {
      const newSsl = !currentSsl;
      logError(`PostgreSQL connection failed with SSL=${currentSsl}. Retrying with SSL=${newSsl}... Error: ${err.message}`);
      const fallbackPool = createInternalPool(newSsl);
      try {
        const client = await fallbackPool.connect();
        const oldPool = activePool;
        activePool = fallbackPool;
        currentSsl = newSsl;
        oldPool.end().catch(() => {});
        return client;
      } catch (fallbackErr) {
        fallbackPool.end().catch(() => {});
        throw fallbackErr;
      }
    }
    throw err;
  }
}

async function query(text, params = []) {
  const client = await connectWithRetry();
  try {
    return await client.query(text, params);
  } finally {
    client.release();
  }
}

const pool = new Proxy({}, {
  get(target, prop) {
    if (prop === 'connect') {
      return connectWithRetry;
    }
    if (prop === 'query') {
      return query;
    }
    const val = activePool[prop];
    return typeof val === 'function' ? val.bind(activePool) : val;
  },
});

module.exports = { pool, query };

