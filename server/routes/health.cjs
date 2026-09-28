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
      return res.status(200).json({
        ok: true,
        database: 'connected',
        success: true,
        message: 'PostgreSQL connection successful',
        current_time: result.rows[0].current_time,
      });
    }
    return res.status(503).json({
      ok: false,
      database: 'unavailable',
      success: false,
      message: 'Database connection failed',
    });
  } catch (error) {
    logError('Database test error:', error);
    return res.status(503).json({
      ok: false,
      database: 'unavailable',
      success: false,
      message: 'Database connection failed',
    });
  }
});

module.exports = router;
