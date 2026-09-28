const express = require('express');
const { pool, query } = require('../db.cjs');
const { requireRole } = require('../middleware/auth.cjs');
const { audit } = require('../lib/audit.cjs');
const { logError } = require('../lib/logger.cjs');

const router = express.Router();

const allowedStatuses = new Set([
  'draft',
  'ai_generated',
  'teacher_reviewed',
  'native_reviewed',
  'approved',
  'published',
  'rejected',
]);

const allowedTransitions = {
  draft: new Set(['ai_generated', 'teacher_reviewed', 'rejected']),
  ai_generated: new Set(['teacher_reviewed', 'rejected']),
  teacher_reviewed: new Set(['native_reviewed', 'rejected']),
  native_reviewed: new Set(['approved', 'rejected']),
  approved: new Set(['published']),
  published: new Set(),
  rejected: new Set(['draft']),
};
const reviewerTransitions = {
  draft: new Set(['teacher_reviewed', 'rejected']),
  ai_generated: new Set(['teacher_reviewed', 'rejected']),
  teacher_reviewed: new Set(['native_reviewed', 'rejected']),
  native_reviewed: new Set(['rejected']),
};

async function reviewQueueHandler(req, res) {
  const status = typeof req.query.status === 'string' ? req.query.status : null;
  const lessonId = req.query.lesson_id === undefined ? null : parsePositiveInteger(req.query.lesson_id);
  const grade = req.query.grade === undefined ? null : parsePositiveInteger(req.query.grade);
  const source = typeof req.query.source === 'string' ? req.query.source : null;

  if ((status && !allowedStatuses.has(status)) || (req.query.lesson_id !== undefined && !lessonId) || (req.query.grade !== undefined && !grade) || (source && !['manual', 'ai'].includes(source))) {
    return res.status(400).json({ success: false, message: 'Invalid translation status' });
  }

  try {
    const result = await query(
      `SELECT t.id,
              t.lesson_id,
              l.title AS lesson_title,
              l.grade,
              t.hindi_text,
              t.mundari_text,
              t.source,
              t.status,
              t.reviewer_notes,
              t.created_at,
              t.updated_at
       FROM translations t
       LEFT JOIN lessons l ON l.id = t.lesson_id
       WHERE CASE
               WHEN $1::varchar IS NULL THEN t.status IN ('ai_generated', 'teacher_reviewed', 'native_reviewed')
               ELSE t.status = $1
         END
         AND ($2::integer IS NULL OR t.lesson_id = $2)
         AND ($3::integer IS NULL OR l.grade = $3)
         AND ($4::varchar IS NULL OR t.source = $4)
       ORDER BY t.updated_at DESC, t.id DESC`,
      [status, lessonId, grade, source]
    );

    return res.status(200).json({ success: true, translations: result.rows });
  } catch (error) {
    logError('GET /api/review/translations error:', error);
    return res.status(500).json({ success: false, message: 'Failed to load review queue' });
  }
}

router.get('/api/review/translations', requireRole('reviewer', 'admin'), reviewQueueHandler);
router.get('/api/review/queue', requireRole('reviewer', 'admin'), reviewQueueHandler);

function parsePositiveInteger(value) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

router.get('/api/translations', requireRole('teacher', 'reviewer', 'admin'), async (req, res) => {
  try {
    const result = await query(
      `SELECT t.id, t.lesson_id, t.hindi_text, t.mundari_text, t.source, t.status,
              t.teacher_notes, t.reviewer_notes, t.reviewer_id, t.model_version,
              t.created_at, t.updated_at
       FROM translations t
       LEFT JOIN lessons l ON l.id = t.lesson_id
       WHERE $1::text <> 'teacher'
          OR t.created_by = $2
          OR l.created_by = $2
       ORDER BY t.updated_at DESC, t.id DESC`,
      [req.auth.role, req.auth.id],
    );
    return res.status(200).json({ success: true, translations: result.rows });
  } catch (error) {
    logError('GET /api/translations error:', error);
    return res.status(500).json({ success: false, message: 'Failed to fetch translations' });
  }
});

router.get('/api/translations/:id', requireRole('teacher', 'reviewer', 'admin'), async (req, res) => {
  const translationId = parsePositiveInteger(req.params.id);
  if (!translationId) return res.status(400).json({ success: false, message: 'Translation ID must be a positive integer' });

  try {
    const result = await query(
      `SELECT t.id, t.lesson_id, t.hindi_text, t.mundari_text, t.source, t.status,
              t.teacher_notes, t.reviewer_notes, t.reviewer_id, t.model_version,
              t.created_at, t.updated_at, t.created_by, l.created_by AS lesson_created_by
       FROM translations t
       LEFT JOIN lessons l ON l.id = t.lesson_id
       WHERE t.id = $1
         AND ($2::text <> 'teacher' OR t.created_by = $3 OR l.created_by = $3)`,
      [translationId, req.auth.role, req.auth.id],
    );
    if (!result.rows[0]) return res.status(404).json({ success: false, message: 'Translation not found' });
    const { created_by, lesson_created_by, ...translation } = result.rows[0];
    return res.status(200).json({ success: true, translation });
  } catch (error) {
    logError(`GET /api/translations/${translationId} error:`, error);
    return res.status(500).json({ success: false, message: 'Failed to fetch translation' });
  }
});

router.post('/api/translations', requireRole('teacher', 'reviewer', 'admin'), async (req, res) => {
  const {
    lesson_id: lessonId,
    hindi_text: hindiText,
    mundari_text: mundariText,
    source = 'manual',
  } = req.body || {};
  const parsedLessonId = parsePositiveInteger(lessonId);

  if (
    !parsedLessonId ||
    typeof hindiText !== 'string' ||
    !hindiText.trim() ||
    typeof mundariText !== 'string' ||
    !mundariText.trim() ||
    !['manual', 'ai'].includes(source)
  ) {
    return res.status(400).json({
      success: false,
      message: 'lesson_id, hindi_text, mundari_text, and a valid source are required',
    });
  }

  try {
    const lessonResult = await query('SELECT id, created_by, status FROM lessons WHERE id = $1', [parsedLessonId]);

    if (lessonResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Lesson not found',
      });
    }
    if (req.auth.role === 'teacher' && (lessonResult.rows[0].created_by !== req.auth.id || lessonResult.rows[0].status !== 'draft')) {
      return res.status(403).json({ success: false, message: 'Teachers may create translations only for their own draft lessons' });
    }

    const result = await query(
      `INSERT INTO translations (lesson_id, hindi_text, mundari_text, source, created_by)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id,
                 lesson_id,
                 hindi_text,
                 mundari_text,
                 source,
                 status,
                 teacher_notes,
                 reviewer_notes,
                 reviewer_id,
                 model_version,
                 created_at,
                 updated_at`,
      [parsedLessonId, hindiText.trim(), mundariText.trim(), source, req.auth.id]
    );

    return res.status(201).json({
      success: true,
      translation: result.rows[0],
    });
  } catch (error) {
    logError('POST /api/translations error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to create translation',
    });
  }
});

router.get('/api/lessons/:id/translations', async (req, res) => {
  const lessonId = parsePositiveInteger(req.params.id);

  if (!lessonId) {
    return res.status(400).json({
      success: false,
      message: 'Lesson ID must be a positive integer',
    });
  }

  try {
    const lessonResult = await query('SELECT id FROM lessons WHERE id = $1', [lessonId]);

    if (lessonResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Lesson not found',
      });
    }

    const result = await query(
      `SELECT id,
              lesson_id,
              hindi_text,
              mundari_text,
              source,
              status,
              teacher_notes,
              reviewer_notes,
              reviewer_id,
              model_version,
              created_at,
              updated_at
       FROM translations
       WHERE lesson_id = $1
       ORDER BY created_at DESC, id DESC`,
      [lessonId]
    );

    return res.status(200).json({
      success: true,
      translations: result.rows,
    });
  } catch (error) {
    logError('GET /api/lessons/:id/translations error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch translations',
    });
  }
});

router.put('/api/translations/:id', requireRole('teacher', 'reviewer', 'admin'), async (req, res) => {
  const translationId = parsePositiveInteger(req.params.id);
  const { hindi_text: hindiText, mundari_text: mundariText, teacher_notes: teacherNotes } = req.body || {};
  if (!translationId || typeof hindiText !== 'string' || !hindiText.trim() || typeof mundariText !== 'string' || !mundariText.trim()) {
    return res.status(400).json({ success: false, message: 'Valid Hindi and Mundari text are required' });
  }

  try {
    const existing = await query('SELECT status, created_by FROM translations WHERE id = $1', [translationId]);
    if (!existing.rows[0]) return res.status(404).json({ success: false, message: 'Translation not found' });
    if (req.auth.role === 'teacher' && (existing.rows[0].status !== 'draft' || existing.rows[0].created_by !== req.auth.id)) {
      return res.status(403).json({ success: false, message: 'Teachers may edit only their own draft translations' });
    }

    const result = await query(
      `UPDATE translations
       SET hindi_text = $1,
           mundari_text = $2,
           teacher_notes = $3,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $4
       RETURNING id, lesson_id, hindi_text, mundari_text, source, status, teacher_notes, reviewer_notes, reviewer_id, model_version, created_at, updated_at`,
      [hindiText.trim(), mundariText.trim(), teacherNotes?.trim() || null, translationId]
    );
    if (!result.rows[0]) return res.status(404).json({ success: false, message: 'Translation not found' });
    await audit({ userId: req.auth.id, action: 'translation_updated', entityType: 'translation', entityId: translationId });
    return res.status(200).json({ success: true, translation: result.rows[0] });
  } catch (error) {
    logError('PUT /api/translations/:id error:', error);
    return res.status(500).json({ success: false, message: 'Failed to update translation' });
  }
});

router.put('/api/translations/:id/review', requireRole('reviewer', 'admin'), async (req, res) => {
  const translationId = parsePositiveInteger(req.params.id);
  const { status, reviewer_notes: reviewerNotes } = req.body || {};

  if (!translationId || !allowedStatuses.has(status)) {
    return res.status(400).json({
      success: false,
      message: 'A valid translation ID and workflow status are required',
    });
  }

  if (reviewerNotes !== undefined && typeof reviewerNotes !== 'string') {
    return res.status(400).json({
      success: false,
      message: 'reviewer_notes must be a string',
    });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const existingResult = await client.query(
      'SELECT id, status, created_by FROM translations WHERE id = $1 FOR UPDATE',
      [translationId],
    );

    if (existingResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({
        success: false,
        message: 'Translation not found',
      });
    }

    const currentStatus = existingResult.rows[0].status;
    const roleTransitions = req.auth.role === 'admin' ? allowedTransitions : reviewerTransitions;
    if (!roleTransitions[currentStatus]?.has(status)) {
      await client.query('ROLLBACK');
      return res.status(400).json({
        success: false,
        message: `Invalid workflow transition from ${currentStatus} to ${status}`,
      });
    }
    if (['approved', 'published'].includes(status) && existingResult.rows[0].created_by === req.auth.id) {
      await client.query('ROLLBACK');
      return res.status(403).json({ success: false, message: 'Users cannot approve or publish their own translation' });
    }

    const result = await client.query(
      `UPDATE translations
       SET status = $1,
           reviewer_notes = COALESCE($2, reviewer_notes),
           reviewer_id = $4,
           updated_at = CURRENT_TIMESTAMP
         WHERE id = $3
       RETURNING id,
                 lesson_id,
                 hindi_text,
                 mundari_text,
                 source,
                 status,
                 teacher_notes,
                 reviewer_notes,
                 reviewer_id,
                 model_version,
                 created_at,
                 updated_at`,
      [status, reviewerNotes?.trim() || null, translationId, req.auth.id]
    );

    await client.query(
      `INSERT INTO audit_logs (user_id, action, entity_type, entity_id, metadata)
       VALUES ($1, $2, 'translation', $3, $4::jsonb)`,
      [req.auth.id, `translation_${status}`, translationId, JSON.stringify({ old_status: currentStatus, new_status: status, role: req.auth.role })],
    );
    await client.query('COMMIT');

    return res.status(200).json({
      success: true,
      translation: result.rows[0],
    });
  } catch (error) {
    await client.query('ROLLBACK');
    logError('PUT /api/translations/:id/review error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to update translation review status',
    });
  } finally {
    client.release();
  }
});

module.exports = router;
