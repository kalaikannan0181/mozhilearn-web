const express = require('express');
const { query } = require('../db.cjs');
const { requireRole } = require('../middleware/auth.cjs');
const { logError } = require('../lib/logger.cjs');

const router = express.Router();
const idOf = (value) => (Number.isInteger(Number(value)) && Number(value) > 0 ? Number(value) : null);

router.get('/api/lessons/:id/activities', async (req, res) => {
  const lessonId = idOf(req.params.id);
  if (!lessonId) return res.status(400).json({ success: false, message: 'Lesson ID must be a positive integer' });
  try {
    const result = await query('SELECT id, lesson_id, activity_name, hindi_guide, mundari_guide, created_at FROM lesson_activities WHERE lesson_id = $1 ORDER BY id', [lessonId]);
    return res.status(200).json({ success: true, activities: result.rows });
  } catch (error) {
    logError('GET activities error:', error);
    return res.status(500).json({ success: false, message: 'Failed to fetch activities' });
  }
});

router.post('/api/lessons/:id/activities', requireRole('teacher', 'reviewer', 'admin'), async (req, res) => {
  const lessonId = idOf(req.params.id);
  const { activity_name: activityName, hindi_guide: hindiGuide, mundari_guide: mundariGuide } = req.body || {};
  if (!lessonId || typeof activityName !== 'string' || !activityName.trim()) return res.status(400).json({ success: false, message: 'activity_name is required' });
  try {
    const lesson = await query('SELECT id, status, created_by FROM lessons WHERE id = $1', [lessonId]);
    if (!lesson.rows[0]) return res.status(404).json({ success: false, message: 'Lesson not found' });
    if (req.auth.role === 'teacher' && (lesson.rows[0].created_by !== req.auth.id || lesson.rows[0].status !== 'draft')) return res.status(403).json({ success: false, message: 'Teachers may edit content only in their own draft lessons' });
    const result = await query('INSERT INTO lesson_activities (lesson_id, activity_name, hindi_guide, mundari_guide) VALUES ($1, $2, $3, $4) RETURNING id, lesson_id, activity_name, hindi_guide, mundari_guide, created_at', [lessonId, activityName.trim(), hindiGuide?.trim() || null, mundariGuide?.trim() || null]);
    return res.status(201).json({ success: true, activity: result.rows[0] });
  } catch (error) {
    logError('POST activity error:', error);
    return res.status(500).json({ success: false, message: 'Failed to create activity' });
  }
});

router.put('/api/activities/:id', requireRole('teacher', 'reviewer', 'admin'), async (req, res) => {
  const activityId = idOf(req.params.id);
  const { activity_name: activityName, hindi_guide: hindiGuide, mundari_guide: mundariGuide } = req.body || {};
  if (!activityId || typeof activityName !== 'string' || !activityName.trim()) return res.status(400).json({ success: false, message: 'activity_name is required' });
  try {
    const owner = await query('SELECT l.created_by, l.status FROM lesson_activities a JOIN lessons l ON l.id = a.lesson_id WHERE a.id = $1', [activityId]);
    if (!owner.rows[0]) return res.status(404).json({ success: false, message: 'Activity not found' });
    if (req.auth.role === 'teacher' && (owner.rows[0].created_by !== req.auth.id || owner.rows[0].status !== 'draft')) return res.status(403).json({ success: false, message: 'Teachers may edit content only in their own draft lessons' });
    const result = await query('UPDATE lesson_activities SET activity_name = $1, hindi_guide = $2, mundari_guide = $3 WHERE id = $4 RETURNING id, lesson_id, activity_name, hindi_guide, mundari_guide, created_at', [activityName.trim(), hindiGuide?.trim() || null, mundariGuide?.trim() || null, activityId]);
    if (!result.rows[0]) return res.status(404).json({ success: false, message: 'Activity not found' });
    return res.status(200).json({ success: true, activity: result.rows[0] });
  } catch (error) {
    logError('PUT activity error:', error);
    return res.status(500).json({ success: false, message: 'Failed to update activity' });
  }
});

router.delete('/api/activities/:id', requireRole('teacher', 'reviewer', 'admin'), async (req, res) => {
  const activityId = idOf(req.params.id);
  if (!activityId) return res.status(400).json({ success: false, message: 'Activity ID must be a positive integer' });
  try {
    const owner = await query('SELECT l.created_by, l.status FROM lesson_activities a JOIN lessons l ON l.id = a.lesson_id WHERE a.id = $1', [activityId]);
    if (!owner.rows[0]) return res.status(404).json({ success: false, message: 'Activity not found' });
    if (req.auth.role === 'teacher' && (owner.rows[0].created_by !== req.auth.id || owner.rows[0].status !== 'draft')) return res.status(403).json({ success: false, message: 'Teachers may edit content only in their own draft lessons' });
    const result = await query('DELETE FROM lesson_activities WHERE id = $1 RETURNING id', [activityId]);
    if (!result.rows[0]) return res.status(404).json({ success: false, message: 'Activity not found' });
    return res.status(200).json({ success: true, message: 'Activity deleted successfully' });
  } catch (error) {
    logError('DELETE activity error:', error);
    return res.status(500).json({ success: false, message: 'Failed to delete activity' });
  }
});

module.exports = router;
