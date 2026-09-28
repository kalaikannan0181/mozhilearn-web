const { query } = require('../db.cjs');
const { logError } = require('./logger.cjs');

async function audit({ userId = null, action, entityType, entityId = null, metadata = {} }) {
  try {
    await query(
      `INSERT INTO audit_logs (user_id, action, entity_type, entity_id, metadata)
       VALUES ($1, $2, $3, $4, $5::jsonb)`,
      [userId, action, entityType, entityId, JSON.stringify(metadata)]
    );
  } catch (error) {
    logError('Audit log error:', error);
  }
}

module.exports = { audit };
