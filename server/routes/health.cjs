const express = require('express');
const { query } = require('../db.cjs');
const { logError } = require('../lib/logger.cjs');
const packageMetadata = require('../../package.json');

const router = express.Router();

router.get('/api/health', (req, res) => {
  return res.status(200).json({
    ok: true,
    service: 'mozilearn-api',
    status: 'running',
    version: packageMetadata.version,
  });
});

router.get('/api/test-db', async (req, res) => {
  try {
    const result = await query('SELECT 1 AS connected, NOW() AS current_time');
    if (result.rows && result.rows.length > 0) {
      let tables = [];
      try {
        const tableCheck = await query(
          `SELECT table_name
           FROM information_schema.tables
           WHERE table_schema = ANY(current_schemas(false))
             AND table_name = ANY($1::text[])`,
          [['users', 'sessions', 'audit_logs']]
        );
        tables = tableCheck.rows.map((row) => row.table_name);
      } catch {
        // Non-fatal if table check has issues
      }

      return res.status(200).json({
        ok: true,
        database: 'connected',
        success: true,
        message: 'PostgreSQL connection successful',
        current_time: result.rows[0].current_time,
        tables,
      });
    }
    return res.status(503).json({
      ok: false,
      database: 'unavailable',
      success: false,
      message: 'Database connection failed',
      code: 'DATABASE_UNAVAILABLE',
      error: 'Database connection failed',
    });
  } catch (error) {
    logError('Database test error:', error);
    const safeError = String(error.message || 'Database connection failed')
      .replace(/postgres(ql)?:\/\/[^\s@]+@/gi, 'postgresql://***:***@')
      .replace(/[A-Za-z0-9_-]{32,}/g, '***');

    return res.status(503).json({
      ok: false,
      database: 'unavailable',
      success: false,
      message: 'Database connection failed',
      code: error.code || 'DATABASE_UNAVAILABLE',
      error: safeError,
    });
  }
});


module.exports = router;
