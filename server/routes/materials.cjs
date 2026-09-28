const express = require('express');
const { query } = require('../db.cjs');
const { requireRole } = require('../middleware/roles.cjs');
const { audit } = require('../lib/audit.cjs');
const { logError } = require('../lib/logger.cjs');
const {
  generateWorksheet,
  generateFlashcards,
  createWorksheetPdfDocument,
  createFlashcardsPdfDocument,
} = require('../services/materialGenerationService.cjs');

const router = express.Router();

const VALID_STATUSES = ['ai_generated', 'teacher_reviewed', 'approved', 'published'];

// ==========================================
// WORKSHEET ENDPOINTS
// ==========================================

// 1. Generate Worksheet
router.post('/api/materials/worksheet/generate', requireRole('teacher', 'reviewer', 'admin'), async (req, res) => {
  const lessonId = Number(req.body?.lesson_id);
  if (!Number.isInteger(lessonId) || lessonId <= 0) {
    return res.status(400).json({ success: false, message: 'lesson_id must be a positive integer' });
  }

  try {
    const worksheet = await generateWorksheet(lessonId, req.auth?.id);
    await audit({ userId: req.auth.id, action: 'worksheet_created', entityType: 'worksheet', entityId: worksheet.id });
    return res.status(201).json({ success: true, data: worksheet });
  } catch (error) {
    if (error.message === 'Lesson not found') {
      return res.status(404).json({ success: false, message: 'Lesson not found' });
    }
    logError('POST /api/materials/worksheet/generate error:', error);
    return res.status(500).json({ success: false, message: 'Failed to generate worksheet', error: error.message });
  }
});

// 2. List Worksheets (filter by lesson_id if provided)
router.get('/api/materials/worksheets', async (req, res) => {
  try {
    const lessonId = req.query.lesson_id ? Number(req.query.lesson_id) : null;
    let result;
    if (lessonId && Number.isInteger(lessonId) && lessonId > 0) {
      result = await query(
        `SELECT w.*, u.full_name as author_name, l.title as lesson_title
         FROM generated_worksheets w
         LEFT JOIN users u ON u.id = w.created_by
         LEFT JOIN lessons l ON l.id = w.lesson_id
         WHERE w.lesson_id = $1
         ORDER BY w.created_at DESC`,
        [lessonId]
      );
    } else {
      result = await query(
        `SELECT w.*, u.full_name as author_name, l.title as lesson_title
         FROM generated_worksheets w
         LEFT JOIN users u ON u.id = w.created_by
         LEFT JOIN lessons l ON l.id = w.lesson_id
         ORDER BY w.created_at DESC
         LIMIT 50`
      );
    }
    return res.status(200).json({ success: true, data: result.rows });
  } catch (error) {
    logError('GET /api/materials/worksheets error:', error);
    return res.status(500).json({ success: false, message: 'Failed to fetch worksheets' });
  }
});

// 3. Get single Worksheet
router.get('/api/materials/worksheet/:id', async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({ success: false, message: 'Invalid worksheet ID' });
  }

  try {
    const result = await query(
      `SELECT w.*, u.full_name as author_name, l.title as lesson_title
       FROM generated_worksheets w
       LEFT JOIN users u ON u.id = w.created_by
       LEFT JOIN lessons l ON l.id = w.lesson_id
       WHERE w.id = $1`,
      [id]
    );

    if (!result.rows[0]) {
      return res.status(404).json({ success: false, message: 'Worksheet not found' });
    }
    return res.status(200).json({ success: true, data: result.rows[0] });
  } catch (error) {
    logError(`GET /api/materials/worksheet/${id} error:`, error);
    return res.status(500).json({ success: false, message: 'Failed to fetch worksheet' });
  }
});

// 4. Update / Edit Worksheet (Teacher Review)
router.put('/api/materials/worksheet/:id', requireRole('teacher', 'reviewer', 'admin'), async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({ success: false, message: 'Invalid worksheet ID' });
  }

  const { title, content_json, status } = req.body;
  if (!title && !content_json && !status) {
    return res.status(400).json({ success: false, message: 'Nothing to update' });
  }

  const targetStatus = status || 'teacher_reviewed';
  if (!VALID_STATUSES.includes(targetStatus)) {
    return res.status(400).json({ success: false, message: `Invalid status. Must be one of: ${VALID_STATUSES.join(', ')}` });
  }

  try {
    const current = await query('SELECT * FROM generated_worksheets WHERE id = $1', [id]);
    if (!current.rows[0]) {
      return res.status(404).json({ success: false, message: 'Worksheet not found' });
    }
    if (req.auth.role === 'teacher' && (current.rows[0].created_by !== req.auth.id || !['ai_generated', 'teacher_reviewed'].includes(current.rows[0].status))) {
      return res.status(403).json({ success: false, message: 'Teachers may edit only their own unapproved worksheets' });
    }
    if (req.auth.role === 'teacher' && !['ai_generated', 'teacher_reviewed'].includes(targetStatus)) {
      return res.status(403).json({ success: false, message: 'Teachers cannot approve or publish worksheets' });
    }
    if (req.auth.role === 'reviewer' && !['ai_generated', 'teacher_reviewed'].includes(targetStatus)) {
      return res.status(403).json({ success: false, message: 'Reviewers cannot approve or publish worksheets' });
    }

    const updatedTitle = title !== undefined ? title : current.rows[0].title;
    const updatedContent = content_json !== undefined ? JSON.stringify(content_json) : current.rows[0].content_json;

    const result = await query(
      `UPDATE generated_worksheets
       SET title = $1, content_json = $2, status = $3, updated_at = NOW()
       WHERE id = $4
       RETURNING *`,
      [updatedTitle, updatedContent, targetStatus, id]
    );
    await audit({ userId: req.auth.id, action: 'worksheet_updated', entityType: 'worksheet', entityId: id, metadata: { status: targetStatus } });

    return res.status(200).json({ success: true, data: result.rows[0] });
  } catch (error) {
    logError(`PUT /api/materials/worksheet/${id} error:`, error);
    return res.status(500).json({ success: false, message: 'Failed to update worksheet' });
  }
});

// 5. Approve Worksheet
router.post('/api/materials/worksheet/:id/approve', requireRole('admin'), async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({ success: false, message: 'Invalid worksheet ID' });
  }

  try {
    const result = await query(
      `UPDATE generated_worksheets
       SET status = 'approved', updated_at = NOW()
       WHERE id = $1
       RETURNING *`,
      [id]
    );

    if (!result.rows[0]) {
      return res.status(404).json({ success: false, message: 'Worksheet not found' });
    }
    await audit({ userId: req.auth.id, action: 'worksheet_approved', entityType: 'worksheet', entityId: id });

    return res.status(200).json({ success: true, data: result.rows[0] });
  } catch (error) {
    logError(`POST /api/materials/worksheet/${id}/approve error:`, error);
    return res.status(500).json({ success: false, message: 'Failed to approve worksheet' });
  }
});

// 6. Publish Worksheet
router.post('/api/materials/worksheet/:id/publish', requireRole('admin'), async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({ success: false, message: 'Invalid worksheet ID' });
  }

  try {
    const check = await query('SELECT status FROM generated_worksheets WHERE id = $1', [id]);
    if (!check.rows[0]) {
      return res.status(404).json({ success: false, message: 'Worksheet not found' });
    }

    // Must be approved first
    if (check.rows[0].status !== 'approved') {
      return res.status(400).json({
        success: false,
        message: 'Worksheet must be in approved status before publishing',
        current_status: check.rows[0].status,
      });
    }

    const result = await query(
      `UPDATE generated_worksheets
       SET status = 'published', updated_at = NOW()
       WHERE id = $1
       RETURNING *`,
      [id]
    );
    await audit({ userId: req.auth.id, action: 'worksheet_published', entityType: 'worksheet', entityId: id });

    return res.status(200).json({ success: true, data: result.rows[0] });
  } catch (error) {
    logError(`POST /api/materials/worksheet/${id}/publish error:`, error);
    return res.status(500).json({ success: false, message: 'Failed to publish worksheet' });
  }
});

// 7. Delete Worksheet (Reject / Remove)
router.delete('/api/materials/worksheet/:id', requireRole('admin'), async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({ success: false, message: 'Invalid worksheet ID' });
  }

  try {
    const result = await query('DELETE FROM generated_worksheets WHERE id = $1 RETURNING id', [id]);
    if (!result.rows[0]) {
      return res.status(404).json({ success: false, message: 'Worksheet not found' });
    }
    return res.status(200).json({ success: true, message: 'Worksheet removed successfully' });
  } catch (error) {
    logError(`DELETE /api/materials/worksheet/${id} error:`, error);
    return res.status(500).json({ success: false, message: 'Failed to delete worksheet' });
  }
});

// 8. Stream Worksheet PDF
router.get('/api/materials/worksheet/:id/pdf', async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({ success: false, message: 'Invalid worksheet ID' });
  }

  try {
    const result = await query('SELECT * FROM generated_worksheets WHERE id = $1', [id]);
    if (!result.rows[0]) {
      return res.status(404).json({ success: false, message: 'Worksheet not found' });
    }

    const worksheet = result.rows[0];
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="worksheet-${id}.pdf"`);

    const doc = createWorksheetPdfDocument(worksheet);
    doc.pipe(res);
  } catch (error) {
    logError(`GET /api/materials/worksheet/${id}/pdf error:`, error);
    return res.status(500).json({ success: false, message: 'Failed to generate worksheet PDF' });
  }
});

// ==========================================
// FLASHCARD ENDPOINTS
// ==========================================

// 1. Generate Flashcards
router.post('/api/materials/flashcards/generate', requireRole('teacher', 'reviewer', 'admin'), async (req, res) => {
  const lessonId = Number(req.body?.lesson_id);
  if (!Number.isInteger(lessonId) || lessonId <= 0) {
    return res.status(400).json({ success: false, message: 'lesson_id must be a positive integer' });
  }

  try {
    const flashcards = await generateFlashcards(lessonId, req.auth?.id);
    await audit({ userId: req.auth.id, action: 'flashcards_created', entityType: 'flashcards', entityId: flashcards.id });
    return res.status(201).json({ success: true, data: flashcards });
  } catch (error) {
    if (error.message === 'Lesson not found') {
      return res.status(404).json({ success: false, message: 'Lesson not found' });
    }
    logError('POST /api/materials/flashcards/generate error:', error);
    return res.status(500).json({ success: false, message: 'Failed to generate flashcards', error: error.message });
  }
});

// 2. List Flashcards (filter by lesson_id if provided)
router.get('/api/materials/flashcards', async (req, res) => {
  try {
    const lessonId = req.query.lesson_id ? Number(req.query.lesson_id) : null;
    let result;
    if (lessonId && Number.isInteger(lessonId) && lessonId > 0) {
      result = await query(
        `SELECT f.*, u.full_name as author_name, l.title as lesson_title
         FROM generated_flashcards f
         LEFT JOIN users u ON u.id = f.created_by
         LEFT JOIN lessons l ON l.id = f.lesson_id
         WHERE f.lesson_id = $1
         ORDER BY f.created_at DESC`,
        [lessonId]
      );
    } else {
      result = await query(
        `SELECT f.*, u.full_name as author_name, l.title as lesson_title
         FROM generated_flashcards f
         LEFT JOIN users u ON u.id = f.created_by
         LEFT JOIN lessons l ON l.id = f.lesson_id
         ORDER BY f.created_at DESC
         LIMIT 50`
      );
    }
    return res.status(200).json({ success: true, data: result.rows });
  } catch (error) {
    logError('GET /api/materials/flashcards error:', error);
    return res.status(500).json({ success: false, message: 'Failed to fetch flashcards' });
  }
});

// 3. Get single Flashcards pack
router.get('/api/materials/flashcards/:id', async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({ success: false, message: 'Invalid flashcards ID' });
  }

  try {
    const result = await query(
      `SELECT f.*, u.full_name as author_name, l.title as lesson_title
       FROM generated_flashcards f
       LEFT JOIN users u ON u.id = f.created_by
       LEFT JOIN lessons l ON l.id = f.lesson_id
       WHERE f.id = $1`,
      [id]
    );

    if (!result.rows[0]) {
      return res.status(404).json({ success: false, message: 'Flashcards not found' });
    }
    return res.status(200).json({ success: true, data: result.rows[0] });
  } catch (error) {
    logError(`GET /api/materials/flashcards/${id} error:`, error);
    return res.status(500).json({ success: false, message: 'Failed to fetch flashcards' });
  }
});

// 4. Update / Edit Flashcards (Teacher Review)
router.put('/api/materials/flashcards/:id', requireRole('teacher', 'reviewer', 'admin'), async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({ success: false, message: 'Invalid flashcards ID' });
  }

  const { content_json, status } = req.body;
  if (!content_json && !status) {
    return res.status(400).json({ success: false, message: 'Nothing to update' });
  }

  const targetStatus = status || 'teacher_reviewed';
  if (!VALID_STATUSES.includes(targetStatus)) {
    return res.status(400).json({ success: false, message: `Invalid status. Must be one of: ${VALID_STATUSES.join(', ')}` });
  }

  try {
    const current = await query('SELECT * FROM generated_flashcards WHERE id = $1', [id]);
    if (!current.rows[0]) {
      return res.status(404).json({ success: false, message: 'Flashcards not found' });
    }
    if (req.auth.role === 'teacher' && (current.rows[0].created_by !== req.auth.id || !['ai_generated', 'teacher_reviewed'].includes(current.rows[0].status))) {
      return res.status(403).json({ success: false, message: 'Teachers may edit only their own unapproved flashcards' });
    }
    if (req.auth.role === 'teacher' && !['ai_generated', 'teacher_reviewed'].includes(targetStatus)) {
      return res.status(403).json({ success: false, message: 'Teachers cannot approve or publish flashcards' });
    }
    if (req.auth.role === 'reviewer' && !['ai_generated', 'teacher_reviewed'].includes(targetStatus)) {
      return res.status(403).json({ success: false, message: 'Reviewers cannot approve or publish flashcards' });
    }

    const updatedContent = content_json !== undefined ? JSON.stringify(content_json) : current.rows[0].content_json;

    const result = await query(
      `UPDATE generated_flashcards
       SET content_json = $1, status = $2, updated_at = NOW()
       WHERE id = $3
       RETURNING *`,
      [updatedContent, targetStatus, id]
    );
    await audit({ userId: req.auth.id, action: 'flashcards_updated', entityType: 'flashcards', entityId: id, metadata: { status: targetStatus } });

    return res.status(200).json({ success: true, data: result.rows[0] });
  } catch (error) {
    logError(`PUT /api/materials/flashcards/${id} error:`, error);
    return res.status(500).json({ success: false, message: 'Failed to update flashcards' });
  }
});

// 5. Approve Flashcards
router.post('/api/materials/flashcards/:id/approve', requireRole('admin'), async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({ success: false, message: 'Invalid flashcards ID' });
  }

  try {
    const result = await query(
      `UPDATE generated_flashcards
       SET status = 'approved', updated_at = NOW()
       WHERE id = $1
       RETURNING *`,
      [id]
    );

    if (!result.rows[0]) {
      return res.status(404).json({ success: false, message: 'Flashcards not found' });
    }
    await audit({ userId: req.auth.id, action: 'flashcards_approved', entityType: 'flashcards', entityId: id });

    return res.status(200).json({ success: true, data: result.rows[0] });
  } catch (error) {
    logError(`POST /api/materials/flashcards/${id}/approve error:`, error);
    return res.status(500).json({ success: false, message: 'Failed to approve flashcards' });
  }
});

// 6. Publish Flashcards
router.post('/api/materials/flashcards/:id/publish', requireRole('admin'), async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({ success: false, message: 'Invalid flashcards ID' });
  }

  try {
    const check = await query('SELECT status FROM generated_flashcards WHERE id = $1', [id]);
    if (!check.rows[0]) {
      return res.status(404).json({ success: false, message: 'Flashcards not found' });
    }

    if (check.rows[0].status !== 'approved') {
      return res.status(400).json({
        success: false,
        message: 'Flashcards must be in approved status before publishing',
        current_status: check.rows[0].status,
      });
    }

    const result = await query(
      `UPDATE generated_flashcards
       SET status = 'published', updated_at = NOW()
       WHERE id = $1
       RETURNING *`,
      [id]
    );
    await audit({ userId: req.auth.id, action: 'flashcards_published', entityType: 'flashcards', entityId: id });

    return res.status(200).json({ success: true, data: result.rows[0] });
  } catch (error) {
    logError(`POST /api/materials/flashcards/${id}/publish error:`, error);
    return res.status(500).json({ success: false, message: 'Failed to publish flashcards' });
  }
});

// 7. Delete Flashcards
router.delete('/api/materials/flashcards/:id', requireRole('admin'), async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({ success: false, message: 'Invalid flashcards ID' });
  }

  try {
    const result = await query('DELETE FROM generated_flashcards WHERE id = $1 RETURNING id', [id]);
    if (!result.rows[0]) {
      return res.status(404).json({ success: false, message: 'Flashcards not found' });
    }
    return res.status(200).json({ success: true, message: 'Flashcards removed successfully' });
  } catch (error) {
    logError(`DELETE /api/materials/flashcards/${id} error:`, error);
    return res.status(500).json({ success: false, message: 'Failed to delete flashcards' });
  }
});

// 8. Stream Flashcards PDF
router.get('/api/materials/flashcards/:id/pdf', async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({ success: false, message: 'Invalid flashcards ID' });
  }

  try {
    const result = await query('SELECT * FROM generated_flashcards WHERE id = $1', [id]);
    if (!result.rows[0]) {
      return res.status(404).json({ success: false, message: 'Flashcards not found' });
    }

    const flashcards = result.rows[0];
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="flashcards-${id}.pdf"`);

    const doc = createFlashcardsPdfDocument(flashcards);
    doc.pipe(res);
  } catch (error) {
    logError(`GET /api/materials/flashcards/${id}/pdf error:`, error);
    return res.status(500).json({ success: false, message: 'Failed to generate flashcards PDF' });
  }
});

module.exports = router;
