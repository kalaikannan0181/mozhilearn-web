const express = require('express');
const { pool, query } = require('../db.cjs');
const { requireRole } = require('../middleware/auth.cjs');
const { audit } = require('../lib/audit.cjs');
const { logError } = require('../lib/logger.cjs');

const router = express.Router();
const statuses = new Set(['draft', 'published', 'archived']);
const idOf = (value) => (Number.isInteger(Number(value)) && Number(value) > 0 ? Number(value) : null);

router.get('/api/packs', async (_req, res) => {
  try {
    const result = await query('SELECT id, name, language, grade, version, status, created_at, updated_at FROM offline_packs ORDER BY created_at DESC, id DESC');
    return res.status(200).json({ success: true, data: result.rows });
  } catch (error) {
    logError('GET /api/packs error:', error);
    return res.status(500).json({ success: false, message: 'Failed to fetch offline packs' });
  }
});

router.get('/api/packs/:id', async (req, res) => {
  const packId = idOf(req.params.id);
  if (!packId) return res.status(400).json({ success: false, message: 'Pack ID must be a positive integer' });
  try {
    const result = await query('SELECT id, name, language, grade, version, status, created_at, updated_at FROM offline_packs WHERE id = $1', [packId]);
    if (!result.rows[0]) return res.status(404).json({ success: false, message: 'Offline pack not found' });
    const lessons = await query(`SELECT l.id, l.title, l.grade, l.subject, l.topic, l.status FROM offline_pack_lessons opl JOIN lessons l ON l.id = opl.lesson_id WHERE opl.pack_id = $1 ORDER BY l.id`, [packId]);
    return res.status(200).json({ success: true, data: { ...result.rows[0], lessons: lessons.rows } });
  } catch (error) {
    logError('GET /api/packs/:id error:', error);
    return res.status(500).json({ success: false, message: 'Failed to fetch offline pack' });
  }
});

router.put('/api/packs/:id', requireRole('teacher', 'reviewer', 'admin'), async (req, res) => {
  const packId = idOf(req.params.id);
  const { name, status } = req.body || {};
  if (!packId || (name !== undefined && (typeof name !== 'string' || !name.trim())) || (status !== undefined && (!statuses.has(status) || status !== 'draft'))) {
    return res.status(400).json({ success: false, message: 'Valid pack fields are required' });
  }
  try {
    const existing = await query('SELECT created_by, status FROM offline_packs WHERE id = $1', [packId]);
    if (!existing.rows[0]) return res.status(404).json({ success: false, message: 'Offline pack not found' });
    if (req.auth.role === 'teacher' && (existing.rows[0].created_by !== req.auth.id || existing.rows[0].status !== 'draft')) return res.status(403).json({ success: false, message: 'Teachers may update only their own draft packs' });
    const result = await query(`UPDATE offline_packs SET name = COALESCE($1, name), updated_at = CURRENT_TIMESTAMP WHERE id = $2 RETURNING id, name, language, grade, version, status, created_at, updated_at`, [name?.trim() || null, packId]);
    if (!result.rows[0]) return res.status(404).json({ success: false, message: 'Offline pack not found' });
    await audit({ userId: req.auth.id, action: 'pack_updated', entityType: 'offline_pack', entityId: packId, metadata: { status } });
    return res.status(200).json({ success: true, data: result.rows[0] });
  } catch (error) {
    logError('PUT /api/packs/:id error:', error);
    return res.status(500).json({ success: false, message: 'Failed to update offline pack' });
  }
});

router.post('/api/packs/:id/publish', requireRole('reviewer', 'admin'), async (req, res) => {
  const packId = idOf(req.params.id);
  if (!packId) return res.status(400).json({ success: false, message: 'Pack ID must be a positive integer' });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const pack = await client.query('SELECT id, status FROM offline_packs WHERE id = $1 FOR UPDATE', [packId]);
    if (!pack.rows[0]) { await client.query('ROLLBACK'); return res.status(404).json({ success: false, message: 'Offline pack not found' }); }
    const invalid = await client.query(`SELECT opl.lesson_id FROM offline_pack_lessons opl JOIN lessons l ON l.id = opl.lesson_id WHERE opl.pack_id = $1 AND l.status NOT IN ('approved', 'published') LIMIT 1`, [packId]);
    if (invalid.rows[0]) { await client.query('ROLLBACK'); return res.status(409).json({ success: false, message: 'Pack contains lessons that are not approved or published' }); }
    const updated = await client.query(`UPDATE offline_packs SET status = 'published', updated_at = CURRENT_TIMESTAMP WHERE id = $1 RETURNING id, name, language, grade, version, status, created_at, updated_at`, [packId]);
    await client.query('COMMIT');
    await audit({ userId: req.auth.id, action: 'pack_published', entityType: 'offline_pack', entityId: packId });
    return res.status(200).json({ success: true, data: updated.rows[0] });
  } catch (error) {
    await client.query('ROLLBACK');
    logError('POST /api/packs/:id/publish error:', error);
    return res.status(500).json({ success: false, message: 'Failed to publish offline pack' });
  } finally { client.release(); }
});

router.post('/api/packs/:id/archive', requireRole('reviewer', 'admin'), async (req, res) => {
  const packId = idOf(req.params.id);
  if (!packId) return res.status(400).json({ success: false, message: 'Pack ID must be a positive integer' });
  try {
    const result = await query(`UPDATE offline_packs SET status = 'archived', updated_at = CURRENT_TIMESTAMP WHERE id = $1 RETURNING id, name, language, grade, version, status, created_at, updated_at`, [packId]);
    if (!result.rows[0]) return res.status(404).json({ success: false, message: 'Offline pack not found' });
    await audit({ userId: req.auth.id, action: 'pack_archived', entityType: 'offline_pack', entityId: packId });
    return res.status(200).json({ success: true, data: result.rows[0] });
  } catch (error) {
    logError('POST /api/packs/:id/archive error:', error);
    return res.status(500).json({ success: false, message: 'Failed to archive offline pack' });
  }
});

module.exports = router;
