const express = require('express');
const { pool, query } = require('../db.cjs');
const { requireRole } = require('../middleware/auth.cjs');
const { audit } = require('../lib/audit.cjs');
const { logError } = require('../lib/logger.cjs');

const router = express.Router();
const OFFLINE_LANGUAGE = 'Mundari';

function parsePositiveInteger(value) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

async function findLatestPublishedPack() {
  const result = await query(
    `SELECT id, name, language, grade, version, status, created_at, updated_at
     FROM offline_packs
     WHERE language = $1 AND status = 'published'
     ORDER BY version DESC, created_at DESC
     LIMIT 1`,
    [OFFLINE_LANGUAGE]
  );

  return result.rows[0] || null;
}

async function loadPackContent(pack) {
  const [lessonResult, vocabularyResult, phraseResult, termResult, numberResult] = await Promise.all([
    query(
      `SELECT l.id,
              l.title,
              l.grade,
              l.subject,
              l.topic,
              l.learning_outcome_hindi,
              l.learning_outcome_mundari,
              l.status,
              l.version,
              l.created_at,
              l.updated_at
       FROM offline_pack_lessons opl
       JOIN lessons l ON l.id = opl.lesson_id
       WHERE opl.pack_id = $1
         AND l.status IN ('approved', 'published')
       ORDER BY l.id`,
      [pack.id]
    ),
    query(
      `SELECT v.id, v.object_code, v.english, v.hindi, v.mundari_roman, v.audio_prompt, v.image_path, v.created_at
       FROM offline_pack_vocabulary opv JOIN vocabulary v ON v.id = opv.vocabulary_id
       WHERE opv.pack_id = $1 ORDER BY v.id`, [pack.id]
    ),
    query(
      `SELECT cp.id, cp.category, cp.hindi, cp.mundari_roman, cp.created_at
       FROM offline_pack_classroom_phrases opc JOIN classroom_phrases cp ON cp.id = opc.classroom_phrase_id
       WHERE opc.pack_id = $1 ORDER BY cp.id`, [pack.id]
    ),
    query(
      `SELECT tt.id, tt.source_book, tt.hindi, tt.mundari_roman, tt.created_at
       FROM offline_pack_textbook_terms opt JOIN textbook_terms tt ON tt.id = opt.textbook_term_id
       WHERE opt.pack_id = $1 ORDER BY tt.id`, [pack.id]
    ),
    query(
      `SELECT nv.id, nv.number_value, nv.hindi, nv.mundari_roman, nv.created_at
       FROM offline_pack_number_vocabulary opn JOIN number_vocabulary nv ON nv.id = opn.number_vocabulary_id
       WHERE opn.pack_id = $1 ORDER BY nv.number_value, nv.id`, [pack.id]
    ),
  ]);

  const lessonIds = lessonResult.rows.map((lesson) => lesson.id);
  let activities = [];
  let assessments = [];
  let translations = [];

  if (lessonIds.length > 0) {
    const [activityResult, assessmentResult, translationResult] = await Promise.all([
      query(
        `SELECT id, lesson_id, activity_name, hindi_guide, mundari_guide, created_at
         FROM lesson_activities
         WHERE lesson_id = ANY($1::integer[])
         ORDER BY lesson_id, id`,
        [lessonIds]
      ),
      query(
        `SELECT id, lesson_id, question_no, hindi_question, mundari_question, expected_answer, created_at
         FROM lesson_assessments
         WHERE lesson_id = ANY($1::integer[])
         ORDER BY lesson_id, question_no, id`,
        [lessonIds]
      ),
      query(
        `SELECT id, lesson_id, hindi_text, mundari_text, source, status, model_version, created_at, updated_at
         FROM translations
         WHERE lesson_id = ANY($1::integer[])
           AND status = 'approved'
         ORDER BY lesson_id, id`,
        [lessonIds]
      ),
    ]);

    activities = activityResult.rows;
    assessments = assessmentResult.rows;
    translations = translationResult.rows;

    for (const lesson of lessonResult.rows) {
      lesson.activities = activities.filter((activity) => activity.lesson_id === lesson.id);
      lesson.assessments = assessments.filter((assessment) => assessment.lesson_id === lesson.id);
    }
  }

  return {
    ...pack,
    lessons: lessonResult.rows,
    vocabulary: vocabularyResult.rows,
    classroom_phrases: phraseResult.rows,
    textbook_terms: termResult.rows,
    number_vocabulary: numberResult.rows,
    translations,
  };
}

router.get('/api/sync/version', async (req, res) => {
  try {
    const pack = await findLatestPublishedPack();

    if (!pack) {
      return res.status(404).json({
        success: false,
        message: 'No published Mundari offline pack is available',
      });
    }

    return res.status(200).json({
      success: true,
      language: OFFLINE_LANGUAGE,
      latest_version: pack.version,
    });
  } catch (error) {
    logError('GET /api/sync/version error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to read offline pack version',
    });
  }
});

router.get('/api/sync', async (req, res) => {
  const requestedVersion = req.query.version === undefined ? null : parsePositiveInteger(req.query.version);

  if (req.query.version !== undefined && !requestedVersion) {
    return res.status(400).json({
      success: false,
      message: 'version must be a positive integer',
    });
  }

  try {
    const pack = await findLatestPublishedPack();

    if (!pack) {
      return res.status(404).json({
        success: false,
        message: 'No published Mundari offline pack is available',
      });
    }

    const fullPack = await loadPackContent(pack);
    return res.status(200).json({
      success: true,
      pack: fullPack,
      synced_at: new Date().toISOString(),
      ...(requestedVersion !== null ? { requested_version: requestedVersion } : {}),
    });
  } catch (error) {
    logError('GET /api/sync error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to build offline sync pack',
    });
  }
});

router.get('/api/sync/packs/:id', async (req, res) => {
  const packId = parsePositiveInteger(req.params.id);

  if (!packId) {
    return res.status(400).json({
      success: false,
      message: 'Pack ID must be a positive integer',
    });
  }

  try {
    const result = await query(
      `SELECT id, name, language, grade, version, status, created_at, updated_at
       FROM offline_packs
       WHERE id = $1`,
      [packId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Offline pack not found',
      });
    }

    if (result.rows[0].status !== 'published') {
      return res.status(404).json({
        success: false,
        message: 'Offline pack is not published',
      });
    }

    return res.status(200).json({
      success: true,
      pack: await loadPackContent(result.rows[0]),
    });
  } catch (error) {
    logError('GET /api/sync/packs/:id error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to load offline pack',
    });
  }
});

router.post('/api/sync/packs', requireRole('teacher', 'reviewer', 'admin'), async (req, res) => {
  const {
    name,
    language,
    grade,
    lesson_ids: lessonIds,
    vocabulary_ids: vocabularyIds = [],
    classroom_phrase_ids: phraseIds = [],
    textbook_term_ids: termIds = [],
    number_vocabulary_ids: numberIds = [],
  } = req.body || {};
  const parsedGrade = parsePositiveInteger(grade);

  const selections = [lessonIds, vocabularyIds, phraseIds, termIds, numberIds];
  if (
    typeof name !== 'string' || !name.trim() || name.length > 200 || language !== OFFLINE_LANGUAGE || !parsedGrade
    || !Array.isArray(lessonIds) || lessonIds.length === 0 || selections.some((selection) => !Array.isArray(selection) || selection.length > 1000 || selection.some((id) => !parsePositiveInteger(id)))
  ) {
    return res.status(400).json({
      success: false,
      message: 'name, language Mundari, grade, lesson_ids, and valid optional content ID lists are required',
    });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const uniqueLessonIds = [...new Set(lessonIds.map(Number))];
    const lessonResult = await client.query(
      `SELECT id
       FROM lessons
       WHERE id = ANY($1::integer[])
         AND grade = $2
         AND status IN ('approved', 'published')
       ORDER BY id`,
      [uniqueLessonIds, parsedGrade]
    );

    if (lessonResult.rows.length !== uniqueLessonIds.length) {
      await client.query('ROLLBACK');
      return res.status(409).json({
        success: false,
        message: 'Every explicitly selected lesson must exist, match the pack grade, and be approved or published',
      });
    }

    const versionResult = await client.query(
      `SELECT COALESCE(MAX(version), 0) + 1 AS next_version
       FROM offline_packs
       WHERE language = $1 AND grade = $2`,
      [OFFLINE_LANGUAGE, parsedGrade]
    );
    const version = versionResult.rows[0].next_version;

    const packResult = await client.query(
      `INSERT INTO offline_packs (name, language, grade, version, status, created_by)
       VALUES ($1, $2, $3, $4, 'draft', $5)
       RETURNING id, name, language, grade, version, status, created_at, updated_at`,
      [name.trim(), OFFLINE_LANGUAGE, parsedGrade, version, req.auth.id]
    );

    for (const lesson of lessonResult.rows) {
      await client.query(
        `INSERT INTO offline_pack_lessons (pack_id, lesson_id)
         VALUES ($1, $2)`,
        [packResult.rows[0].id, lesson.id]
      );
    }

    const linkSelections = [
      ['vocabulary', vocabularyIds, 'offline_pack_vocabulary', 'vocabulary_id'],
      ['classroom_phrases', phraseIds, 'offline_pack_classroom_phrases', 'classroom_phrase_id'],
      ['textbook_terms', termIds, 'offline_pack_textbook_terms', 'textbook_term_id'],
      ['number_vocabulary', numberIds, 'offline_pack_number_vocabulary', 'number_vocabulary_id'],
    ];
    for (const [table, rawIds, linkTable, idColumn] of linkSelections) {
      const ids = [...new Set(rawIds.map(Number))];
      if (ids.length === 0) continue;
      const found = await client.query(`SELECT id FROM ${table} WHERE id = ANY($1::integer[])`, [ids]);
      if (found.rows.length !== ids.length) {
        await client.query('ROLLBACK');
        return res.status(409).json({ success: false, message: `One or more selected ${table} records do not exist` });
      }
      for (const id of ids) {
        await client.query(`INSERT INTO ${linkTable} (pack_id, ${idColumn}) VALUES ($1, $2)`, [packResult.rows[0].id, id]);
      }
    }

    await client.query('COMMIT');
    await audit({ userId: req.auth.id, action: 'offline_pack_requested', entityType: 'offline_pack', entityId: packResult.rows[0].id, metadata: { lesson_ids: uniqueLessonIds, status: 'draft' } });
    return res.status(201).json({
      success: true,
      pack: packResult.rows[0],
    });
  } catch (error) {
    await client.query('ROLLBACK');
    logError('POST /api/sync/packs error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to create offline pack',
    });
  } finally {
    client.release();
  }
});

module.exports = router;
