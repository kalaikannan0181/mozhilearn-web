const fs = require('fs');
const path = require('path');
const { parse } = require('csv-parse/sync');
const { pool } = require('./db.cjs');

const definitions = {
  lessons: {
    table: 'lessons',
    required: ['title', 'grade', 'subject'],
    columns: ['title', 'grade', 'subject', 'topic', 'learning_outcome_hindi', 'learning_outcome_mundari', 'source', 'source_reference', 'validation_status', 'reviewer_id', 'reviewer_notes'],
    key: (row) => `${row.title}|${row.grade}|${row.subject}`,
    normalize: (row) => ({ ...row, grade: Number(row.grade), validation_status: row.validation_status || 'raw' }),
  },
  activities: {
    table: 'lesson_activities',
    required: ['lesson_id', 'activity_name'],
    columns: ['lesson_id', 'activity_name', 'hindi_guide', 'mundari_guide', 'source', 'source_reference', 'validation_status', 'reviewer_id', 'reviewer_notes'],
    key: (row) => `${row.lesson_id}|${row.activity_name}`,
    normalize: (row) => ({ ...row, lesson_id: Number(row.lesson_id), validation_status: row.validation_status || 'raw' }),
  },
  assessments: {
    table: 'lesson_assessments',
    required: ['lesson_id', 'question_no', 'hindi_question'],
    columns: ['lesson_id', 'question_no', 'hindi_question', 'mundari_question', 'expected_answer', 'source', 'source_reference', 'validation_status', 'reviewer_id', 'reviewer_notes'],
    key: (row) => `${row.lesson_id}|${row.question_no}`,
    normalize: (row) => ({ ...row, lesson_id: Number(row.lesson_id), question_no: Number(row.question_no), validation_status: row.validation_status || 'raw' }),
  },
  vocabulary: {
    table: 'vocabulary',
    required: ['hindi', 'mundari_roman'],
    columns: ['object_code', 'english', 'hindi', 'mundari_roman', 'audio_prompt', 'image_path', 'source', 'source_reference', 'validation_status', 'reviewer_id', 'reviewer_notes'],
    key: (row) => `${row.hindi}|${row.mundari_roman}`,
    normalize: (row) => ({ ...row, validation_status: row.validation_status || 'raw' }),
  },
  'classroom-phrases': {
    table: 'classroom_phrases',
    required: ['category', 'hindi', 'mundari_roman'],
    columns: ['category', 'hindi', 'mundari_roman', 'source', 'source_reference', 'validation_status', 'reviewer_id', 'reviewer_notes'],
    key: (row) => `${row.category}|${row.hindi}|${row.mundari_roman}`,
    normalize: (row) => ({ ...row, validation_status: row.validation_status || 'raw' }),
  },
  'textbook-terms': {
    table: 'textbook_terms',
    required: ['source_book', 'hindi'],
    columns: ['source_book', 'hindi', 'mundari_roman', 'source', 'source_reference', 'validation_status', 'reviewer_id', 'reviewer_notes'],
    key: (row) => `${row.source_book}|${row.hindi}`,
    normalize: (row) => ({ ...row, validation_status: row.validation_status || 'raw' }),
  },
  'number-vocabulary': {
    table: 'number_vocabulary',
    required: ['number_value', 'hindi', 'mundari_roman'],
    columns: ['number_value', 'hindi', 'mundari_roman', 'source', 'source_reference', 'validation_status', 'reviewer_id', 'reviewer_notes'],
    key: (row) => `${row.number_value}`,
    normalize: (row) => ({ ...row, number_value: Number(row.number_value), validation_status: row.validation_status || 'raw' }),
  },
  translations: {
    table: 'translations',
    required: ['hindi_text', 'mundari_text', 'source'],
    columns: ['lesson_id', 'hindi_text', 'mundari_text', 'source', 'status', 'teacher_notes', 'reviewer_notes', 'reviewer_id', 'model_version'],
    key: (row) => `${row.lesson_id || ''}|${row.hindi_text}|${row.mundari_text}`,
    normalize: (row) => ({ ...row, lesson_id: row.lesson_id ? Number(row.lesson_id) : null, status: row.status || 'draft' }),
  },
};

function argument(name) {
  const index = process.argv.indexOf(name);
  return index === -1 ? null : process.argv[index + 1];
}

function parseArgs() {
  const file = process.argv[2];
  const type = argument('--type');
  const dryRun = process.argv.includes('--dry-run');
  if (!file || !type || !definitions[type]) throw new Error('Usage: node server/import.cjs <file> --type <type> [--dry-run]');
  return { file: path.resolve(file), type, dryRun };
}

function readRows(file) {
  const content = fs.readFileSync(file, 'utf8');
  if (file.toLowerCase().endsWith('.json')) {
    const rows = JSON.parse(content);
    if (!Array.isArray(rows)) throw new Error('JSON import must contain an array');
    return rows;
  }
  return parse(content, { columns: true, skip_empty_lines: true, bom: true, trim: true });
}

function validateRows(rows, definition) {
  const errors = [];
  const seen = new Set();
  const valid = [];
  let ignored = 0;
  rows.forEach((raw, index) => {
    const rowNumber = index + 1;
    if (raw.human_decision !== 'APPROVE' || raw.review_status !== 'SAFE_TO_IMPORT') {
      ignored += 1;
      return;
    }
    const row = definition.normalize(raw);
    const missing = definition.required.filter((field) => row[field] === undefined || row[field] === null || row[field] === '');
    const key = definition.key(row);
    if (missing.length) errors.push({ row: rowNumber, message: `Missing required fields: ${missing.join(', ')}` });
    else if (seen.has(key)) errors.push({ row: rowNumber, message: 'Duplicate row in input' });
    else if (definition.table !== 'translations' && ['raw', 'machine_generated', 'teacher_reviewed', 'native_reviewed', 'approved'].indexOf(row.validation_status) === -1) errors.push({ row: rowNumber, message: 'Invalid validation_status' });
    else { seen.add(key); valid.push(row); }
  });
  return { valid, errors, ignored };
}

async function run() {
  const { file, type, dryRun } = parseArgs();
  const definition = definitions[type];
  const rows = readRows(file);
  const { valid, errors, ignored } = validateRows(rows, definition);
  const client = await pool.connect();
  let imported = 0;
  let skipped = 0;

  try {
    await client.query('BEGIN');
    for (const row of valid) {
      const values = definition.columns.map((column) => row[column] === undefined || row[column] === '' ? null : row[column]);
      const placeholders = values.map((_, index) => `$${index + 1}`).join(', ');
      const duplicate = await client.query(`SELECT 1 FROM ${definition.table} WHERE ${duplicateWhere(type)} LIMIT 1`, duplicateParams(type, row));
      if (duplicate.rows[0]) { skipped += 1; continue; }
      if (!dryRun) {
        await client.query(`INSERT INTO ${definition.table} (${definition.columns.join(', ')}) VALUES (${placeholders})`, values);
      }
      imported += 1;
    }
    if (dryRun) await client.query('ROLLBACK'); else await client.query('COMMIT');
    console.log(JSON.stringify({ imported, skipped, ignored, errors: errors.length, dry_run: dryRun, error_rows: errors }, null, 2));
    if (errors.length) process.exitCode = 2;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally { client.release(); await pool.end(); }
}

function duplicateWhere(type) {
  return {
    lessons: 'title = $1 AND grade = $2 AND subject = $3',
    activities: 'lesson_id = $1 AND activity_name = $2',
    assessments: 'lesson_id = $1 AND question_no = $2',
    vocabulary: 'hindi = $1 AND mundari_roman = $2',
    'classroom-phrases': 'category = $1 AND hindi = $2 AND mundari_roman = $3',
    'textbook-terms': 'source_book = $1 AND hindi = $2',
    'number-vocabulary': 'number_value = $1',
    translations: 'lesson_id IS NOT DISTINCT FROM $1 AND hindi_text = $2 AND mundari_text = $3',
  }[type];
}

function duplicateParams(type, row) {
  return {
    lessons: [row.title, row.grade, row.subject],
    activities: [row.lesson_id, row.activity_name],
    assessments: [row.lesson_id, row.question_no],
    vocabulary: [row.hindi, row.mundari_roman],
    'classroom-phrases': [row.category, row.hindi, row.mundari_roman],
    'textbook-terms': [row.source_book, row.hindi],
    'number-vocabulary': [row.number_value],
    translations: [row.lesson_id, row.hindi_text, row.mundari_text],
  }[type];
}

run().catch((error) => { console.error('Import failed:', error.message); process.exitCode = 1; });
