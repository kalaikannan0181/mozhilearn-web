const express = require('express');
const { query } = require('../db.cjs');
const { requireRole } = require('../middleware/auth.cjs');
const { audit } = require('../lib/audit.cjs');
const { logError } = require('../lib/logger.cjs');

const router = express.Router();
const roles = new Set(['teacher', 'reviewer', 'admin']);

router.get('/api/admin/users', requireRole('admin'), async (_req, res) => {
  try {
    const result = await query('SELECT id, email, full_name, role, created_at, updated_at FROM users ORDER BY created_at DESC');
    return res.status(200).json({ success: true, data: result.rows });
  } catch (error) {
    logError('GET /api/admin/users error:', error);
    return res.status(500).json({ success: false, message: 'Failed to fetch users' });
  }
});

router.put('/api/admin/users/:id', requireRole('admin'), async (req, res) => {
  const userId = Number(req.params.id);
  const { full_name: fullName, role } = req.body || {};
  if (!Number.isInteger(userId) || userId <= 0 || (fullName !== undefined && (typeof fullName !== 'string' || !fullName.trim())) || (role !== undefined && !roles.has(role))) {
    return res.status(400).json({ success: false, message: 'Valid user fields are required' });
  }
  try {
    const result = await query('UPDATE users SET full_name = COALESCE($1, full_name), role = COALESCE($2, role), updated_at = CURRENT_TIMESTAMP WHERE id = $3 RETURNING id, email, full_name, role, created_at, updated_at', [fullName?.trim() || null, role || null, userId]);
    if (!result.rows[0]) return res.status(404).json({ success: false, message: 'User not found' });
    await audit({ userId: req.auth.id, action: 'user_updated', entityType: 'user', entityId: userId, metadata: { role } });
    return res.status(200).json({ success: true, data: result.rows[0] });
  } catch (error) {
    logError('PUT /api/admin/users/:id error:', error);
    return res.status(500).json({ success: false, message: 'Failed to update user' });
  }
});

router.delete('/api/admin/users/:id', requireRole('admin'), async (req, res) => {
  const userId = Number(req.params.id);
  if (!Number.isInteger(userId) || userId <= 0) return res.status(400).json({ success: false, message: 'User ID must be a positive integer' });
  if (userId === req.auth.id) return res.status(409).json({ success: false, message: 'You cannot delete your own account' });
  try {
    const result = await query('DELETE FROM users WHERE id = $1 RETURNING id', [userId]);
    if (!result.rows[0]) return res.status(404).json({ success: false, message: 'User not found' });
    await audit({ userId: req.auth.id, action: 'user_deleted', entityType: 'user', entityId: userId });
    return res.status(200).json({ success: true, message: 'User deleted successfully' });
  } catch (error) {
    logError('DELETE /api/admin/users/:id error:', error);
    return res.status(500).json({ success: false, message: 'Failed to delete user' });
  }
});

module.exports = router;
