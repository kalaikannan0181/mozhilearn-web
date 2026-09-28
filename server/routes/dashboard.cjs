const express = require('express');
const { query } = require('../db.cjs');
const { logError } = require('../lib/logger.cjs');

const router = express.Router();

router.get('/api/dashboard/summary', async (_req, res) => {
  try {
    const [lessonCounts, translationCounts, packCounts] = await Promise.all([
      query(`SELECT COUNT(*)::int AS total,
                    COUNT(*) FILTER (WHERE status = 'draft')::int AS draft,
                    COUNT(*) FILTER (WHERE status IN ('teacher_reviewed', 'native_reviewed'))::int AS review_pending,
                    COUNT(*) FILTER (WHERE status = 'approved')::int AS approved,
                    COUNT(*) FILTER (WHERE status = 'published')::int AS published
             FROM lessons`),
      query('SELECT COUNT(*)::int AS total FROM translations'),
      query("SELECT COUNT(*)::int AS published FROM offline_packs WHERE status = 'published'"),
    ]);

    return res.status(200).json({
      success: true,
      data: {
        lessons: lessonCounts.rows[0],
        translations: translationCounts.rows[0],
        published_packs: packCounts.rows[0].published,
      },
    });
  } catch (error) {
    logError('GET /api/dashboard/summary error:', error);
    return res.status(500).json({ success: false, message: 'Failed to load dashboard summary' });
  }
});

module.exports = router;
