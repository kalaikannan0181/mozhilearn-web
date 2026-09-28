const express = require('express');
const { query } = require('../db.cjs');
const { requireRole } = require('../middleware/auth.cjs');
const { logError } = require('../lib/logger.cjs');

const router = express.Router();
const idOf = (value) => (Number.isInteger(Number(value)) && Number(value) > 0 ? Number(value) : null);

router.get('/api/lessons/:id/assessments', async (req, res) => {
  const lessonId = idOf(req.params.id);
  if (!lessonId) return res.status(400).json({ success: false, message: 'Lesson ID must be a positive integer' });
  try {
    const result = await query('SELECT id, lesson_id, question_no, hindi_question, mundari_question, expected_answer, created_at FROM lesson_assessments WHERE lesson_id = $1 ORDER BY question_no, id', [lessonId]);
    return res.status(200).json({ success: true, assessments: result.rows });
  } catch (error) {
    logError('GET assessments error:', error);
    return res.status(500).json({ success: false, message: 'Failed to fetch assessments' });
  }
});

router.post('/api/lessons/:id/assessments', requireRole('teacher', 'reviewer', 'admin'), async (req, res) => {
  const lessonId = idOf(req.params.id);
  const { question_no: questionNo, hindi_question: hindiQuestion, mundari_question: mundariQuestion, expected_answer: expectedAnswer } = req.body || {};
  if (!lessonId || !Number.isInteger(questionNo) || questionNo < 1 || typeof hindiQuestion !== 'string' || !hindiQuestion.trim()) return res.status(400).json({ success: false, message: 'question_no and hindi_question are required' });
  try {
    const lesson = await query('SELECT id, status, created_by FROM lessons WHERE id = $1', [lessonId]);
    if (!lesson.rows[0]) return res.status(404).json({ success: false, message: 'Lesson not found' });
    if (req.auth.role === 'teacher' && (lesson.rows[0].created_by !== req.auth.id || lesson.rows[0].status !== 'draft')) return res.status(403).json({ success: false, message: 'Teachers may edit content only in their own draft lessons' });
    const result = await query('INSERT INTO lesson_assessments (lesson_id, question_no, hindi_question, mundari_question, expected_answer) VALUES ($1, $2, $3, $4, $5) RETURNING id, lesson_id, question_no, hindi_question, mundari_question, expected_answer, created_at', [lessonId, questionNo, hindiQuestion.trim(), mundariQuestion?.trim() || null, expectedAnswer?.trim() || null]);
    return res.status(201).json({ success: true, assessment: result.rows[0] });
  } catch (error) {
    logError('POST assessment error:', error);
    return res.status(500).json({ success: false, message: 'Failed to create assessment' });
  }
});

router.put('/api/assessments/:id', requireRole('teacher', 'reviewer', 'admin'), async (req, res) => {
  const assessmentId = idOf(req.params.id);
  const { question_no: questionNo, hindi_question: hindiQuestion, mundari_question: mundariQuestion, expected_answer: expectedAnswer } = req.body || {};
  if (!assessmentId || !Number.isInteger(questionNo) || questionNo < 1 || typeof hindiQuestion !== 'string' || !hindiQuestion.trim()) return res.status(400).json({ success: false, message: 'question_no and hindi_question are required' });
  try {
    const owner = await query('SELECT l.created_by, l.status FROM lesson_assessments a JOIN lessons l ON l.id = a.lesson_id WHERE a.id = $1', [assessmentId]);
    if (!owner.rows[0]) return res.status(404).json({ success: false, message: 'Assessment not found' });
    if (req.auth.role === 'teacher' && (owner.rows[0].created_by !== req.auth.id || owner.rows[0].status !== 'draft')) return res.status(403).json({ success: false, message: 'Teachers may edit content only in their own draft lessons' });
    const result = await query('UPDATE lesson_assessments SET question_no = $1, hindi_question = $2, mundari_question = $3, expected_answer = $4 WHERE id = $5 RETURNING id, lesson_id, question_no, hindi_question, mundari_question, expected_answer, created_at', [questionNo, hindiQuestion.trim(), mundariQuestion?.trim() || null, expectedAnswer?.trim() || null, assessmentId]);
    if (!result.rows[0]) return res.status(404).json({ success: false, message: 'Assessment not found' });
    return res.status(200).json({ success: true, assessment: result.rows[0] });
  } catch (error) {
    logError('PUT assessment error:', error);
    return res.status(500).json({ success: false, message: 'Failed to update assessment' });
  }
});

router.delete('/api/assessments/:id', requireRole('teacher', 'reviewer', 'admin'), async (req, res) => {
  const assessmentId = idOf(req.params.id);
  if (!assessmentId) return res.status(400).json({ success: false, message: 'Assessment ID must be a positive integer' });
  try {
    const owner = await query('SELECT l.created_by, l.status FROM lesson_assessments a JOIN lessons l ON l.id = a.lesson_id WHERE a.id = $1', [assessmentId]);
    if (!owner.rows[0]) return res.status(404).json({ success: false, message: 'Assessment not found' });
    if (req.auth.role === 'teacher' && (owner.rows[0].created_by !== req.auth.id || owner.rows[0].status !== 'draft')) return res.status(403).json({ success: false, message: 'Teachers may edit content only in their own draft lessons' });
    const result = await query('DELETE FROM lesson_assessments WHERE id = $1 RETURNING id', [assessmentId]);
    if (!result.rows[0]) return res.status(404).json({ success: false, message: 'Assessment not found' });
    return res.status(200).json({ success: true, message: 'Assessment deleted successfully' });
  } catch (error) {
    logError('DELETE assessment error:', error);
    return res.status(500).json({ success: false, message: 'Failed to delete assessment' });
  }
});

module.exports = router;
