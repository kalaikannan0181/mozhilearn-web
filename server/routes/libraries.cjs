const express = require('express');
const { query } = require('../db.cjs');
const { requireRole } = require('../middleware/auth.cjs');
const { logError } = require('../lib/logger.cjs');

const router = express.Router();
const idOf = (value) => (Number.isInteger(Number(value)) && Number(value) > 0 ? Number(value) : null);

const resources = {
  vocabulary: {
    table: 'vocabulary',
    columns: 'id, object_code, english, hindi, mundari_roman, audio_prompt, image_path, created_at',
    fields: ['object_code', 'english', 'hindi', 'mundari_roman', 'audio_prompt', 'image_path'],
  },
  'classroom-phrases': {
    table: 'classroom_phrases',
    columns: 'id, category, hindi, mundari_roman, created_at',
    fields: ['category', 'hindi', 'mundari_roman'],
  },
  'textbook-terms': {
    table: 'textbook_terms',
    columns: 'id, source_book, hindi, mundari_roman, created_at',
    fields: ['source_book', 'hindi', 'mundari_roman'],
  },
};

function valuesFor(resource, body) {
  return resource.fields.map((field) => (typeof body[field] === 'string' ? body[field].trim() || null : body[field] ?? null));
}

function isLatinScript(value) {
  const letters = value.match(/\p{L}/gu) || [];
  return letters.length > 0 && letters.every((letter) => /\p{Script=Latin}/u.test(letter));
}

for (const [pathName, resource] of Object.entries(resources)) {
  router.get(`/api/${pathName}`, async (_req, res) => {
    try {
      const filters = [];
      const values = [];
      if (pathName === 'vocabulary') {
        for (const field of ['english', 'hindi', 'mundari_roman', 'object_code']) {
          if (typeof _req.query[field] === 'string' && _req.query[field].trim()) {
            values.push(`%${_req.query[field].trim()}%`);
            filters.push(`${field} ILIKE $${values.length}`);
          }
        }
      }
      const where = filters.length ? ` WHERE ${filters.join(' AND ')}` : '';
      const result = await query(`SELECT ${resource.columns} FROM ${resource.table}${where} ORDER BY id`, values);
      return res.status(200).json({ success: true, [pathName.replaceAll('-', '_')]: result.rows });
    } catch (error) {
      logError(`GET /api/${pathName} error:`, error);
      return res.status(500).json({ success: false, message: `Failed to fetch ${pathName}` });
    }
  });

  router.post(`/api/${pathName}`, requireRole('reviewer', 'admin'), async (req, res) => {
    const values = valuesFor(resource, req.body || {});
    if (values.some((value, index) => resource.fields[index] !== 'object_code' && (value === null || value === ''))) {
      return res.status(400).json({ success: false, message: 'Required content fields are missing' });
    }
    const romanIndex = resource.fields.indexOf('mundari_roman');
    if (romanIndex >= 0 && !isLatinScript(values[romanIndex])) return res.status(400).json({ success: false, message: 'mundari_roman must contain Latin/Roman-script text' });

    try {
      const placeholders = values.map((_, index) => `$${index + 1}`).join(', ');
      const result = await query(`INSERT INTO ${resource.table} (${resource.fields.join(', ')}) VALUES (${placeholders}) RETURNING ${resource.columns}`, values);
      return res.status(201).json({ success: true, item: result.rows[0] });
    } catch (error) {
      logError(`POST /api/${pathName} error:`, error);
      return res.status(500).json({ success: false, message: `Failed to create ${pathName}` });
    }
  });

  router.put(`/api/${pathName}/:id`, requireRole('reviewer', 'admin'), async (req, res) => {
    const id = idOf(req.params.id);
    const values = valuesFor(resource, req.body || {});
    if (!id || values.some((value, index) => resource.fields[index] !== 'object_code' && (value === null || value === ''))) {
      return res.status(400).json({ success: false, message: 'Valid ID and required content fields are needed' });
    }
    const romanIndex = resource.fields.indexOf('mundari_roman');
    if (romanIndex >= 0 && !isLatinScript(values[romanIndex])) return res.status(400).json({ success: false, message: 'mundari_roman must contain Latin/Roman-script text' });

    try {
      const assignments = resource.fields.map((field, index) => `${field} = $${index + 1}`).join(', ');
      const result = await query(`UPDATE ${resource.table} SET ${assignments} WHERE id = $${values.length + 1} RETURNING ${resource.columns}`, [...values, id]);
      if (!result.rows[0]) return res.status(404).json({ success: false, message: `${pathName} item not found` });
      return res.status(200).json({ success: true, item: result.rows[0] });
    } catch (error) {
      logError(`PUT /api/${pathName}/:id error:`, error);
      return res.status(500).json({ success: false, message: `Failed to update ${pathName}` });
    }
  });

  router.delete(`/api/${pathName}/:id`, requireRole('reviewer', 'admin'), async (req, res) => {
    const id = idOf(req.params.id);
    if (!id) return res.status(400).json({ success: false, message: 'ID must be a positive integer' });
    try {
      const result = await query(`DELETE FROM ${resource.table} WHERE id = $1 RETURNING id`, [id]);
      if (!result.rows[0]) return res.status(404).json({ success: false, message: `${pathName} item not found` });
      return res.status(200).json({ success: true, message: 'Content deleted successfully' });
    } catch (error) {
      logError(`DELETE /api/${pathName}/:id error:`, error);
      return res.status(500).json({ success: false, message: `Failed to delete ${pathName}` });
    }
  });
}

router.get('/api/number-vocabulary', async (_req, res) => {
  try {
    const values = [];
    const filters = [];
    for (const field of ['from', 'to']) {
      if (_req.query[field] !== undefined) {
        const value = Number(_req.query[field]);
        if (!Number.isInteger(value) || value < 1) return res.status(400).json({ success: false, message: `${field} must be a positive integer` });
        values.push(value);
        filters.push(`number_value ${field === 'from' ? '>=' : '<='} $${values.length}`);
      }
    }
    const result = await query(`SELECT id, number_value, hindi, mundari_roman, created_at FROM number_vocabulary ${filters.length ? `WHERE ${filters.join(' AND ')}` : ''} ORDER BY number_value, id`, values);
    return res.status(200).json({ success: true, number_vocabulary: result.rows });
  } catch (error) {
    logError('GET /api/number-vocabulary error:', error);
    return res.status(500).json({ success: false, message: 'Failed to fetch number vocabulary' });
  }
});

module.exports = router;
