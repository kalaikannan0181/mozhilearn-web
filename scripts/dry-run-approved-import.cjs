const fs = require('node:fs');
const path = require('node:path');
const { parse } = require('csv-parse/sync');
const { pool } = require('../server/db.cjs');

const manifestPath = path.resolve(__dirname, '..', 'data', 'reports', 'class1_approved_import_manifest.csv');
const requiredColumns = [
  'dataset',
  'table',
  'source_file',
  'source_sheet',
  'source_row',
  'lesson_title',
  'hindi',
  'mundari_roman',
  'number_value',
  'category',
  'source_book',
  'review_status',
  'human_decision',
  'human_reviewer',
  'review_notes',
];
const blockedStatuses = new Set([
  'DUPLICATE',
  'CONFLICT',
  'NEEDS_HUMAN_REVIEW',
  'MISSING_REQUIRED_FIELD',
]);
const counts = {
  would_insert: 0,
  would_skip_duplicate: 0,
  would_conflict: 0,
  invalid_rows: 0,
  total_approved: 0,
};

function requireValue(row, field, lineNumber) {
  const value = row[field];
  if (value === undefined || value === null || String(value).trim() === '') {
    throw new Error(`row ${lineNumber}: required mapping ${field} is missing`);
  }
  return String(value).trim();
}

function activityName(row, lineNumber) {
  const match = /^activity_name=([^;]+)(?:;|$)/.exec(row.review_notes || '');
  if (!match) throw new Error(`row ${lineNumber}: activity_name mapping is missing`);
  return match[1].trim();
}

function assessmentQuestionNo(row, lineNumber) {
  const match = /(?:^|;\s*)question_no=(\d+)(?:;|$)/.exec(row.review_notes || '');
  if (!match) throw new Error(`row ${lineNumber}: question_no mapping is missing`);
  return Number(match[1]);
}

function assessmentExpectedAnswer(row) {
  const match = /expected_answer=(.*?)(?:;\s*proposed lesson_id=|$)/.exec(row.review_notes || '');
  return match ? match[1].trim() : '';
}

async function selectOnly(sql, parameters) {
  if (!/^\s*SELECT\b/i.test(sql)) {
    throw new Error('Safety check failed: dry-run attempted a non-SELECT database statement.');
  }
  return pool.query(sql, parameters);
}

async function compareRow(row, lineNumber) {
  requireValue(row, 'source_file', lineNumber);
  requireValue(row, 'source_sheet', lineNumber);
  requireValue(row, 'source_row', lineNumber);

  switch (row.table) {
    case 'vocabulary': {
      const hindi = requireValue(row, 'hindi', lineNumber);
      const roman = requireValue(row, 'mundari_roman', lineNumber);
      const result = await selectOnly('SELECT mundari_roman FROM vocabulary WHERE hindi = $1', [hindi]);
      if (result.rows.some((dbRow) => dbRow.mundari_roman === roman)) counts.would_skip_duplicate += 1;
      else if (result.rows.length) counts.would_conflict += 1;
      else counts.would_insert += 1;
      return;
    }
    case 'number_vocabulary': {
      const numberValue = Number(requireValue(row, 'number_value', lineNumber));
      const hindi = requireValue(row, 'hindi', lineNumber);
      const roman = requireValue(row, 'mundari_roman', lineNumber);
      if (!Number.isInteger(numberValue)) throw new Error(`row ${lineNumber}: number_value is not an integer`);
      const result = await selectOnly(
        'SELECT hindi, mundari_roman FROM number_vocabulary WHERE number_value = $1',
        [numberValue],
      );
      if (result.rows.some((dbRow) => dbRow.hindi === hindi && dbRow.mundari_roman === roman)) counts.would_skip_duplicate += 1;
      else if (result.rows.length) counts.would_conflict += 1;
      else counts.would_insert += 1;
      return;
    }
    case 'classroom_phrases': {
      const category = requireValue(row, 'category', lineNumber);
      const hindi = requireValue(row, 'hindi', lineNumber);
      const roman = requireValue(row, 'mundari_roman', lineNumber);
      const result = await selectOnly(
        'SELECT category, mundari_roman FROM classroom_phrases WHERE hindi = $1',
        [hindi],
      );
      if (result.rows.some((dbRow) => dbRow.category === category && dbRow.mundari_roman === roman)) counts.would_skip_duplicate += 1;
      else if (result.rows.length) counts.would_conflict += 1;
      else counts.would_insert += 1;
      return;
    }
    case 'textbook_terms': {
      const sourceBook = requireValue(row, 'source_book', lineNumber);
      const hindi = requireValue(row, 'hindi', lineNumber);
      const roman = requireValue(row, 'mundari_roman', lineNumber);
      const result = await selectOnly(
        'SELECT source_book, mundari_roman FROM textbook_terms WHERE hindi = $1',
        [hindi],
      );
      if (result.rows.some((dbRow) => dbRow.source_book === sourceBook && dbRow.mundari_roman === roman)) counts.would_skip_duplicate += 1;
      else if (result.rows.length) counts.would_conflict += 1;
      else counts.would_insert += 1;
      return;
    }
    case 'lessons': {
      const title = requireValue(row, 'lesson_title', lineNumber);
      const result = await selectOnly(
        'SELECT id, grade, subject, learning_outcome_hindi, learning_outcome_mundari FROM lessons WHERE title = $1',
        [title],
      );
      if (result.rows.length > 1) throw new Error(`row ${lineNumber}: lesson title resolves to multiple database records`);
      if (result.rows.length === 1) {
        const dbRow = result.rows[0];
        if (Number(dbRow.grade) !== 1) {
          counts.would_conflict += 1;
        } else if (dbRow.learning_outcome_hindi === row.hindi && dbRow.learning_outcome_mundari === row.mundari_roman) {
          counts.would_skip_duplicate += 1;
        } else {
          counts.would_conflict += 1;
        }
        return;
      }
      throw new Error(`row ${lineNumber}: required DB mapping for lesson subject and grade is missing`);
    }
    case 'lesson_activities':
    case 'lesson_assessments': {
      const title = requireValue(row, 'lesson_title', lineNumber);
      const proposedId = Number(requireValue(row, 'proposed_lesson_id', lineNumber));
      if (!Number.isInteger(proposedId)) throw new Error(`row ${lineNumber}: proposed_lesson_id is invalid`);
      const lesson = await selectOnly(
        'SELECT id FROM lessons WHERE title = $1 AND grade = 1',
        [title],
      );
      if (lesson.rows.length !== 1 || Number(lesson.rows[0].id) !== proposedId) {
        throw new Error(`row ${lineNumber}: activity/assessment lesson_id resolution is missing or ambiguous`);
      }

      if (row.table === 'lesson_activities') {
        const name = activityName(row, lineNumber);
        const guide = row.hindi.split(' | ').slice(1).join(' | ');
        const result = await selectOnly(
          'SELECT hindi_guide, mundari_guide FROM lesson_activities WHERE lesson_id = $1 AND activity_name = $2',
          [proposedId, name],
        );
        if (result.rows.some((dbRow) => dbRow.hindi_guide === guide && dbRow.mundari_guide === row.mundari_roman)) counts.would_skip_duplicate += 1;
        else if (result.rows.length) counts.would_conflict += 1;
        else counts.would_insert += 1;
        return;
      }

      const questionNo = assessmentQuestionNo(row, lineNumber);
      const expectedAnswer = assessmentExpectedAnswer(row);
      const result = await selectOnly(
        'SELECT hindi_question, mundari_question, expected_answer FROM lesson_assessments WHERE lesson_id = $1 AND question_no = $2',
        [proposedId, questionNo],
      );
      if (result.rows.some((dbRow) => dbRow.hindi_question === row.hindi && dbRow.mundari_question === row.mundari_roman && dbRow.expected_answer === expectedAnswer)) counts.would_skip_duplicate += 1;
      else if (result.rows.length) counts.would_conflict += 1;
      else counts.would_insert += 1;
      return;
    }
    default:
      throw new Error(`row ${lineNumber}: unsupported table mapping ${row.table || '(blank)'}`);
  }
}

async function run() {
  let failure = null;
  try {
    if (!fs.existsSync(manifestPath)) throw new Error('Approved import manifest does not exist. Build it first.');
    const content = fs.readFileSync(manifestPath, 'utf8');
    const rows = parse(content, { bom: true, columns: true, skip_empty_lines: true, trim: true });
    const columns = rows.length ? Object.keys(rows[0]) : parse(content, { bom: true, skip_empty_lines: true })[0] || [];
    const missingColumns = requiredColumns.filter((column) => !columns.includes(column));
    if (missingColumns.length) throw new Error(`Manifest is missing required columns: ${missingColumns.join(', ')}`);
    if (rows.some((row) => row.human_decision !== 'APPROVE')) {
      throw new Error('Safety check failed: manifest contains a row without explicit APPROVE.');
    }
    if (rows.some((row) => blockedStatuses.has(row.review_status) || row.review_status !== 'SAFE_TO_IMPORT')) {
      throw new Error('Safety check failed: manifest contains a blocked or uncleared review_status.');
    }

    counts.total_approved = rows.length;
    for (const [index, row] of rows.entries()) {
      try {
        await compareRow(row, index + 2);
      } catch (error) {
        if (/conflict/i.test(error.message)) counts.would_conflict += 1;
        else counts.invalid_rows += 1;
        failure = error;
        break;
      }
    }

    if (!failure && counts.would_conflict > 0) {
      failure = new Error('Dry-run stopped: one or more approved rows conflict with PostgreSQL.');
    }
  } catch (error) {
    failure = error;
    if (counts.total_approved === 0 && /row \d+:/i.test(error.message)) counts.invalid_rows += 1;
  } finally {
    await pool.end();
  }

  console.log(`would_insert=${counts.would_insert}`);
  console.log(`would_skip_duplicate=${counts.would_skip_duplicate}`);
  console.log(`would_conflict=${counts.would_conflict}`);
  console.log(`invalid_rows=${counts.invalid_rows}`);
  console.log(`total_approved=${counts.total_approved}`);
  if (failure) {
    console.error(`Dry-run stopped: ${failure.message}`);
    process.exitCode = 1;
  }
}

run().catch((error) => {
  console.error(`Dry-run failed: ${error.message}`);
  process.exitCode = 1;
});
