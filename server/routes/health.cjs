const express = require('express');
const { logError } = require('../lib/logger.cjs');

const router = express.Router();

router.get('/api/test-db', async (req, res) => {
  try {
    const { query } = require('../db.cjs');
    const result = await query('SELECT NOW() AS current_time');

    return res.status(200).json({
      success: true,
      message: 'PostgreSQL connection successful',
      current_time: result.rows[0].current_time,
    });
  } catch (error) {
    logError('Database test error:', error);
    return res.status(500).json({
      success: false,
      message: 'Database connection failed',
    });
  }
});

module.exports = router;
