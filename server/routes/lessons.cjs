const express = require('express');
const { query } = require('../db.cjs');
const { requireRole } = require('../middleware/auth.cjs');
const { audit } = require('../lib/audit.cjs');
const { logError } = require('../lib/logger.cjs');

const router = express.Router();
const lessonStatuses = new Set([
  'draft',
  'ai_generated',
  'teacher_reviewed',
  'native_reviewed',
  'approved',
  'published',
  'rejected',
]);

router.get('/api/lessons/:id', async (req, res) => {
  const lessonId = Number(req.params.id);

  if (!Number.isInteger(lessonId) || lessonId <= 0) {
    return res.status(400).json({
      success: false,
      message: 'Lesson ID must be a positive integer',
    });
  }

  try {
    const lessonResult = await query(
      `SELECT id,
              title,
              grade,
              subject,
              topic,
              learning_outcome_hindi,
              learning_outcome_mundari,
              status,
              version,
              created_at,
              updated_at,
              created_by
       FROM lessons
       WHERE id = $1`,
      [lessonId]
    );

    if (lessonResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Lesson not found',
      });
    }
    if (req.auth.role === 'teacher' && lessonResult.rows[0].created_by !== null && lessonResult.rows[0].created_by !== req.auth.id) {
      return res.status(404).json({ success: false, message: 'Lesson not found' });
    }

    const [activitiesResult, assessmentsResult] = await Promise.all([
      query(
        `SELECT id,
                activity_name,
                hindi_guide,
                mundari_guide,
                created_at
         FROM lesson_activities
         WHERE lesson_id = $1
         ORDER BY id`,
        [lessonId]
      ),
      query(
        `SELECT id,
                question_no,
                hindi_question,
                mundari_question,
                expected_answer,
                created_at
         FROM lesson_assessments
         WHERE lesson_id = $1
         ORDER BY question_no, id`,
        [lessonId]
      ),
    ]);

    return res.status(200).json({
      success: true,
      lesson: {
        ...lessonResult.rows[0],
        activities: activitiesResult.rows,
        assessments: assessmentsResult.rows,
      },
    });
  } catch (error) {
    logError('GET /api/lessons/:id error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch lesson details',
    });
  }
});

router.put('/api/lessons/:id', requireRole('teacher', 'reviewer', 'admin'), async (req, res) => {
  const lessonId = Number(req.params.id);
  const { title, grade, subject, topic, learning_outcome_hindi, learning_outcome_mundari, status, version } = req.body || {};

  if (
    !Number.isInteger(lessonId) ||
    lessonId <= 0 ||
    typeof title !== 'string' ||
    !title.trim() ||
    !Number.isInteger(grade) ||
    typeof subject !== 'string' ||
    !subject.trim() ||
    (status !== undefined && !lessonStatuses.has(status)) ||
    (version !== undefined && (!Number.isInteger(version) || version < 1))
  ) {
    return res.status(400).json({ success: false, message: 'Invalid lesson fields' });
  }

  try {
    const existing = await query('SELECT created_by, status FROM lessons WHERE id = $1', [lessonId]);
    if (!existing.rows[0]) return res.status(404).json({ success: false, message: 'Lesson not found' });
    if (req.auth.role === 'teacher' && (existing.rows[0].created_by !== req.auth.id || existing.rows[0].status !== 'draft' || (status && status !== 'draft'))) {
      return res.status(403).json({ success: false, message: 'Teachers may edit only their own draft lessons' });
    }

    const result = await query(
      `UPDATE lessons
       SET title = $1,
           grade = $2,
           subject = $3,
           topic = $4,
           learning_outcome_hindi = $5,
           learning_outcome_mundari = $6,
           status = COALESCE($7, status),
           version = COALESCE($8, version + 1),
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $9
       RETURNING id, title, grade, subject, topic, learning_outcome_hindi, learning_outcome_mundari, status, version, created_at, updated_at`,
      [title.trim(), grade, subject.trim(), topic?.trim() || null, learning_outcome_hindi?.trim() || null, learning_outcome_mundari?.trim() || null, status || null, version || null, lessonId]
    );

    if (result.rows.length === 0) return res.status(404).json({ success: false, message: 'Lesson not found' });
    return res.status(200).json({ success: true, lesson: result.rows[0] });
  } catch (error) {
    logError('PUT /api/lessons/:id error:', error);
    return res.status(500).json({ success: false, message: 'Failed to update lesson' });
  }
});

router.delete('/api/lessons/:id', requireRole('admin'), async (req, res) => {
  const lessonId = Number(req.params.id);
  if (!Number.isInteger(lessonId) || lessonId <= 0) return res.status(400).json({ success: false, message: 'Lesson ID must be a positive integer' });

  try {
    const result = await query('DELETE FROM lessons WHERE id = $1 RETURNING id', [lessonId]);
    if (result.rows.length === 0) return res.status(404).json({ success: false, message: 'Lesson not found' });
    return res.status(200).json({ success: true, message: 'Lesson deleted successfully' });
  } catch (error) {
    logError('DELETE /api/lessons/:id error:', error);
    return res.status(500).json({ success: false, message: 'Failed to delete lesson' });
  }
});

router.get('/api/lessons', async (req, res) => {
  try {
    const filters = [];
    const values = [];
    for (const field of ['grade', 'subject', 'topic', 'status']) {
      const value = req.query[field];
      if (value !== undefined && value !== '') {
        if (field === 'grade') {
          const parsedGrade = Number(value);
          if (!Number.isInteger(parsedGrade) || parsedGrade <= 0) return res.status(400).json({ success: false, message: 'grade must be a positive integer' });
          values.push(parsedGrade);
        } else {
          if (field === 'status' && !lessonStatuses.has(String(value))) return res.status(400).json({ success: false, message: 'Invalid lesson status' });
          values.push(String(value));
        }
        filters.push(`${field} = $${values.length}`);
      }
    }
    const result = await query(
      `SELECT id,
              title,
              grade,
              subject,
              topic,
              learning_outcome_hindi,
              learning_outcome_mundari,
              status,
              version,
              created_at,
              updated_at
       FROM lessons
       ${req.auth.role === 'teacher'
    ? `WHERE (${filters.length ? `${filters.join(' AND ')} AND ` : ''}(created_by = $${values.length + 1} OR created_by IS NULL))`
    : filters.length ? `WHERE ${filters.join(' AND ')}` : ''}
       ORDER BY created_at DESC`
      , req.auth.role === 'teacher' ? [...values, req.auth.id] : values
    );

    res.status(200).json({
      success: true,
      lessons: result.rows,
    });
  } catch (error) {
    logError('GET /api/lessons error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch lessons',
    });
  }
});

router.post('/api/lessons', requireRole('teacher', 'reviewer', 'admin'), async (req, res) => {
  try {
    const {
      title,
      grade,
      subject,
      topic,
      learning_outcome_hindi,
      learning_outcome_mundari,
      status = 'draft',
      version = 1,
    } = req.body || {};

    if (!title || !Number.isInteger(grade) || !subject || !Number.isInteger(version) || (status !== 'draft' && req.auth.role === 'teacher')) {
      return res.status(400).json({
        success: false,
        message: 'Title, numeric grade, subject, numeric version, and an allowed initial status are required',
      });
    }

    const result = await query(
      `INSERT INTO lessons (
         title,
         grade,
         subject,
         topic,
         learning_outcome_hindi,
         learning_outcome_mundari,
         status,
         version,
         created_by
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING id,
                 title,
                 grade,
                 subject,
                 topic,
                 learning_outcome_hindi,
                 learning_outcome_mundari,
                 status,
                 version,
                 created_by,
                 created_at,
                 updated_at`,
      [title.trim(), grade, subject.trim(), topic?.trim() || null, learning_outcome_hindi?.trim() || null, learning_outcome_mundari?.trim() || null, status, version, req.auth.id]
    );

    res.status(201).json({
      success: true,
      message: 'Lesson created successfully',
      lesson: result.rows[0],
    });
    await audit({ userId: req.auth.id, action: 'lesson_created', entityType: 'lesson', entityId: result.rows[0].id });
  } catch (error) {
    logError('POST /api/lessons error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create lesson',
    });
  }
});

module.exports = router;
