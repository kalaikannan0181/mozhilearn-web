import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import pg from 'pg';

const { Pool } = pg;
const __dirname = path.dirname(new URL(import.meta.url).pathname);

dotenv.config({ path: path.join(__dirname, '..', '..', '.env.local') });
dotenv.config({ path: path.join(__dirname, '..', '..', '.env') });

const root = path.resolve(__dirname, '..', '..');
const sourceDir = path.join(root, 'lesson-1', 'mundari-content');
const dataDir = path.join(root, 'data');
const reportsDir = path.join(dataDir, 'reports');
const normalizedDir = path.join(dataDir, 'normalized');

const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: false });

function parseCsv(filePath) {
  const text = fs.readFileSync(filePath, 'utf8-sig');
  const lines = text.split(/\r?\n/).filter((line) => line.trim() !== '');
  if (!lines.length) return [];
  const rows = [];
  let row;
  for (const line of lines) {
    row = [];
    let current = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i += 1) {
      const ch = line[i];
      if (ch === '"') {
        if (inQuotes && line[i + 1] === '"') {
          current += '"';
          i += 1;
        } else {
          inQuotes = !inQuotes;
        }
      } else if (ch === ',' && !inQuotes) {
        row.push(current);
        current = '';
      } else {
        current += ch;
      }
    }
    row.push(current);
    rows.push(row);
  }
  return rows;
}

function parseCsvObjects(filePath) {
  const rows = parseCsv(filePath);
  if (rows.length < 2) return [];
  const headers = rows[0].map((header) => header.trim());
  return rows.slice(1).map((row) => {
    const obj = {};
    headers.forEach((header, index) => {
      obj[header] = row[index] !== undefined ? row[index].trim() : '';
    });
    return obj;
  });
}

function getRowCount(filePath) {
  const rows = parseCsv(filePath);
  return Math.max(rows.length - 1, 0);
}

function classifySourceFile(fileName) {
  const lower = fileName.toLowerCase();
  if (lower.includes('math')) return 'math/numbers';
  if (lower.includes('phonics') || lower.includes('sound')) return 'phonics/sounds';
  if (lower.includes('word') || lower.includes('noun')) return 'vocabulary/nouns';
  if (lower.includes('vowel')) return 'vowel and word-building';
  if (lower.includes('jharkhand') || lower.includes('curriculum')) return 'curriculum mapping';
  if (lower.includes('untitled') || lower.includes('sheet')) return 'classroom/lesson source';
  return 'mixed educational source';
}

function writeCsv(filePath, rows) {
  if (!rows.length) {
    fs.writeFileSync(filePath, '');
    return;
  }
  const headers = Object.keys(rows[0]);
  const lines = [headers.join(',')];
  rows.forEach((row) => {
    const values = headers.map((header) => {
      const value = row[header] ?? '';
      const escaped = String(value).replace(/"/g, '""');
      return `"${escaped}"`;
    });
    lines.push(values.join(','));
  });
  fs.writeFileSync(filePath, lines.join('\n') + '\n');
}

async function queryDatabase(sql, params = []) {
  const client = await pool.connect();
  try {
    return await client.query(sql, params);
  } finally {
    client.release();
  }
}

async function buildInventory() {
  const files = fs.readdirSync(sourceDir).sort();
  const inventory = [];
  for (const file of files) {
    const full = path.join(sourceDir, file);
    const ext = path.extname(file).toLowerCase();
    const lower = file.toLowerCase();
    if (ext === '.csv') {
      const rows = parseCsv(full);
      const header = rows[0] || [];
      const rowCount = Math.max(rows.length - 1, 0);
      const text = rows.slice(0, 8).flat().join(' ');
      const isRelevant = /math|phonics|word|vowel|sheet|number|fruit|lesson|class|jharkhand|count|curriculum|teacher|audio/i.test(file);
      inventory.push({
        file,
        sheet_name: 'CSV source',
        rows: String(rowCount),
        columns: String(header.length || 0),
        likely_purpose: classifySourceFile(file),
        relevant: isRelevant ? 'yes' : 'no',
        reason: isRelevant ? 'Directly covers numeracy, classroom prompts, or lesson vocabulary content.' : 'General curriculum or support workbook; not directly needed for the Class 1 fruit-and-counting dataset.',
        contains_hindi: /[\u0900-\u097F]/.test(text) ? 'yes' : 'no',
        contains_mundari: /[\u{1E000}-\u{1E0FF}]/u.test(text) ? 'yes' : 'no',
        contains_mundari_roman: /(miyad|bariya|apiya|upuna|moreya|uli|kela|mundari|roman)/i.test(text) ? 'yes' : 'no',
        contains_pronunciation: /(pronunciation|tts|audio|phonics|vowel|script)/i.test(text) ? 'yes' : 'no'
      });
    } else if (ext === '.xlsx' || ext === '.xls') {
      inventory.push({
        file,
        sheet_name: 'Excel workbook',
        rows: 'N/A',
        columns: 'N/A',
        likely_purpose: classifySourceFile(file),
        relevant: /math|phonics|word|vowel|sheet|number|fruit|lesson|class|jharkhand|count|curriculum|teacher|audio/i.test(file) ? 'yes' : 'no',
        reason: /math|phonics|word|vowel|sheet|number|fruit|lesson|class|jharkhand|count|curriculum|teacher|audio/i.test(file) ? 'Excel-backed source workbook with relevant educational content.' : 'Excel workbook not directly needed for the Class 1 fruit-and-counting dataset.',
        contains_hindi: 'unknown',
        contains_mundari: 'unknown',
        contains_mundari_roman: 'unknown',
        contains_pronunciation: 'unknown'
      });
    }
  }
  writeCsv(path.join(reportsDir, 'source_inventory.csv'), inventory);
  return inventory;
}

function computeNormalizedCounts() {
  const files = [
    'lessons_class1.csv',
    'lesson_activities_class1.csv',
    'lesson_assessments_class1.csv',
    'vocabulary_class1.csv',
    'classroom_phrases_class1.csv',
    'number_vocabulary_class1.csv',
    'textbook_terms_class1.csv'
  ];
  const counts = {};
  for (const file of files) {
    const full = path.join(normalizedDir, file);
    if (fs.existsSync(full)) {
      counts[file] = getRowCount(full);
    }
  }
  return counts;
}

function detectDuplicates() {
  const files = [
    { file: 'lessons_class1.csv', key: (row) => `${row.title}|${row.grade}|${row.subject}` },
    { file: 'lesson_activities_class1.csv', key: (row) => `${row.lesson_title}|${row.activity_name}` },
    { file: 'lesson_assessments_class1.csv', key: (row) => `${row.lesson_title}|${row.question_no}` },
    { file: 'vocabulary_class1.csv', key: (row) => `${row.hindi}|${row.mundari_roman}` },
    { file: 'classroom_phrases_class1.csv', key: (row) => `${row.category}|${row.hindi}|${row.mundari_roman}` },
    { file: 'number_vocabulary_class1.csv', key: (row) => `${row.number_value}` },
    { file: 'textbook_terms_class1.csv', key: (row) => `${row.source_book}|${row.hindi}|${row.mundari_roman}` }
  ];

  const results = [];
  for (const entry of files) {
    const rows = parseCsvObjects(path.join(normalizedDir, entry.file));
    const seen = new Map();
    for (const row of rows) {
      const key = entry.key(row);
      const prior = seen.get(key);
      if (!prior) {
        seen.set(key, row);
      } else {
        const same = JSON.stringify(prior) === JSON.stringify(row);
        results.push({
          file: entry.file,
          key,
          classification: same ? 'exact_duplicate' : 'conflict',
          first_row: JSON.stringify(prior),
          second_row: JSON.stringify(row)
        });
      }
    }
  }
  writeCsv(path.join(reportsDir, 'lesson1_duplicates.csv'), results);
  return results;
}

function detectMissingFields() {
  const files = [
    'lessons_class1.csv',
    'lesson_activities_class1.csv',
    'lesson_assessments_class1.csv',
    'vocabulary_class1.csv',
    'classroom_phrases_class1.csv',
    'number_vocabulary_class1.csv',
    'textbook_terms_class1.csv'
  ];
  const results = [];
  for (const file of files) {
    const rows = parseCsvObjects(path.join(normalizedDir, file));
    for (const row of rows) {
      const fields = {
        file,
        missing_hindi: (!row.hindi || !String(row.hindi).trim()) && !(!row.hindi_question || !String(row.hindi_question).trim()) ? 'yes' : 'no',
        missing_mundari: (!row.mundari_roman && !row.mundari_guide && !row.mundari_question) ? 'yes' : 'no',
        missing_roman: (!row.mundari_roman && !row.mundari_guide && !row.mundari_question) ? 'yes' : 'no',
        missing_category: !row.category ? 'yes' : 'no',
        missing_lesson: !row.lesson_title && !row.title ? 'yes' : 'no',
        missing_number: !row.number_value ? 'yes' : 'no',
        missing_source: !row.source_file ? 'yes' : 'no',
        missing_provenance: !row.source_file || !row.source_row ? 'yes' : 'no'
      };
      if (Object.values(fields).some((value) => value === 'yes')) {
        results.push(fields);
      }
    }
  }
  writeCsv(path.join(reportsDir, 'lesson1_missing_fields.csv'), results);
  return results;
}

async function buildDatabaseComparison() {
  const tables = {
    lessons: 'SELECT title, grade, subject FROM lessons',
    lesson_activities: 'SELECT lesson_id, activity_name FROM lesson_activities',
    lesson_assessments: 'SELECT lesson_id, question_no FROM lesson_assessments',
    vocabulary: 'SELECT hindi, mundari_roman FROM vocabulary',
    classroom_phrases: 'SELECT category, hindi, mundari_roman FROM classroom_phrases',
    number_vocabulary: 'SELECT number_value, hindi, mundari_roman FROM number_vocabulary',
    textbook_terms: 'SELECT source_book, hindi, mundari_roman FROM textbook_terms'
  };

  const data = {};
  for (const [table, sql] of Object.entries(tables)) {
    const result = await queryDatabase(sql);
    data[table] = result.rows;
  }

  const comparisons = [];
  const lessonRows = parseCsvObjects(path.join(normalizedDir, 'lessons_class1.csv'));
  const activityRows = parseCsvObjects(path.join(normalizedDir, 'lesson_activities_class1.csv'));
  const assessmentRows = parseCsvObjects(path.join(normalizedDir, 'lesson_assessments_class1.csv'));
  const vocabRows = parseCsvObjects(path.join(normalizedDir, 'vocabulary_class1.csv'));
  const phraseRows = parseCsvObjects(path.join(normalizedDir, 'classroom_phrases_class1.csv'));
  const numberRows = parseCsvObjects(path.join(normalizedDir, 'number_vocabulary_class1.csv'));
  const textbookRows = parseCsvObjects(path.join(normalizedDir, 'textbook_terms_class1.csv'));

  for (const row of lessonRows) {
    const key = `${row.title}|${row.grade}|${row.subject}`;
    const match = data.lessons.some((dbRow) => dbRow.title === row.title && Number(dbRow.grade) === Number(row.grade) && dbRow.subject === row.subject);
    comparisons.push({ type: 'lessons', key, status: match ? 'existing_match' : 'new_record', source_file: row.source_file || '', source_row: row.source_row || '' });
  }
  for (const row of activityRows) {
    const key = `${row.lesson_title}|${row.activity_name}`;
    comparisons.push({ type: 'lesson_activities', key, status: 'new_record', source_file: row.source_file || '', source_row: row.source_row || '' });
  }
  for (const row of assessmentRows) {
    const key = `${row.lesson_title}|${row.question_no}`;
    comparisons.push({ type: 'lesson_assessments', key, status: 'new_record', source_file: row.source_file || '', source_row: row.source_row || '' });
  }
  for (const row of vocabRows) {
    const key = `${row.hindi}|${row.mundari_roman}`;
    const match = data.vocabulary.some((dbRow) => dbRow.hindi === row.hindi && dbRow.mundari_roman === row.mundari_roman);
    comparisons.push({ type: 'vocabulary', key, status: match ? 'existing_match' : 'new_record', source_file: row.source_file || '', source_row: row.source_row || '' });
  }
  for (const row of phraseRows) {
    const key = `${row.category}|${row.hindi}|${row.mundari_roman}`;
    const match = data.classroom_phrases.some((dbRow) => dbRow.category === row.category && dbRow.hindi === row.hindi && dbRow.mundari_roman === row.mundari_roman);
    comparisons.push({ type: 'classroom_phrases', key, status: match ? 'existing_match' : 'new_record', source_file: row.source_file || '', source_row: row.source_row || '' });
  }
  for (const row of numberRows) {
    const key = `${row.number_value}`;
    const match = data.number_vocabulary.some((dbRow) => Number(dbRow.number_value) === Number(row.number_value));
    comparisons.push({ type: 'number_vocabulary', key, status: match ? 'existing_match' : 'new_record', source_file: row.source_file || '', source_row: row.source_row || '' });
  }
  for (const row of textbookRows) {
    const key = `${row.source_book}|${row.hindi}|${row.mundari_roman}`;
    const match = data.textbook_terms.some((dbRow) => dbRow.source_book === row.source_book && dbRow.hindi === row.hindi && dbRow.mundari_roman === row.mundari_roman);
    comparisons.push({ type: 'textbook_terms', key, status: match ? 'existing_match' : 'new_record', source_file: row.source_file || '', source_row: row.source_row || '' });
  }

  writeCsv(path.join(reportsDir, 'lesson1_database_comparison.csv'), comparisons);
  return comparisons;
}

async function writeQualityReport() {
  const inventory = await buildInventory();
  const normalizedCounts = computeNormalizedCounts();
  const duplicates = detectDuplicates();
  const missingFields = detectMissingFields();
  const dbComparison = await buildDatabaseComparison();
  const totalSourceRows = inventory.reduce((sum, row) => {
    const numeric = Number(row.rows);
    return sum + (Number.isFinite(numeric) ? numeric : 0);
  }, 0);
  const relevantRows = inventory.filter((row) => row.relevant === 'yes').reduce((sum, row) => sum + (Number.isFinite(Number(row.rows)) ? Number(row.rows) : 0), 0);
  const normalizedRows = Object.values(normalizedCounts).reduce((sum, count) => sum + Number(count || 0), 0);
  const exactDupes = duplicates.filter((d) => d.classification === 'exact_duplicate').length;
  const conflictDupes = duplicates.filter((d) => d.classification === 'conflict').length;
  const missingHindi = missingFields.filter((row) => row.missing_hindi === 'yes').length;
  const missingMundari = missingFields.filter((row) => row.missing_mundari === 'yes').length;
  const missingRoman = missingFields.filter((row) => row.missing_roman === 'yes').length;
  const needsReview = Math.max(0, missingHindi + missingMundari + missingRoman + conflictDupes);
  const readyForImport = Math.max(0, normalizedRows - exactDupes - conflictDupes - needsReview);
  const existingMatches = dbComparison.filter((row) => row.status === 'existing_match').length;
  const newRecords = dbComparison.filter((row) => row.status === 'new_record').length;
  const sourceConflict = dbComparison.filter((row) => row.status === 'source_conflict').length;

  const lines = [
    '# Class 1 Lesson 1 dataset quality report',
    '',
    '## Real counts',
    '',
    '| Section | Count |',
    '|---|---:|',
    `| Lessons | ${normalizedCounts['lessons_class1.csv'] || 0} |`,
    `| Activities | ${normalizedCounts['lesson_activities_class1.csv'] || 0} |`,
    `| Assessments | ${normalizedCounts['lesson_assessments_class1.csv'] || 0} |`,
    `| Vocabulary | ${normalizedCounts['vocabulary_class1.csv'] || 0} |`,
    `| Classroom phrases | ${normalizedCounts['classroom_phrases_class1.csv'] || 0} |`,
    `| Numbers | ${normalizedCounts['number_vocabulary_class1.csv'] || 0} |`,
    `| Textbook terms | ${normalizedCounts['textbook_terms_class1.csv'] || 0} |`,
    '',
    `- Total source rows: ${totalSourceRows}`,
    `- Relevant rows: ${relevantRows}`,
    `- Normalized rows: ${normalizedRows}`,
    `- Duplicates: ${exactDupes + conflictDupes}`,
    `- Conflicts: ${conflictDupes}`,
    `- Missing Hindi: ${missingHindi}`,
    `- Missing Mundari: ${missingMundari}`,
    `- Missing Roman: ${missingRoman}`,
    `- Needs review: ${needsReview}`,
    `- Ready for import: ${readyForImport}`,
    '',
    '## Database comparison summary',
    '',
    `- Existing matches: ${existingMatches}`,
    `- New rows: ${newRecords}`,
    `- Source conflicts: ${sourceConflict}`,
    '',
    '## Notes',
    '',
    '- This phase is read-only and does not alter Postgres data.',
    '- Roman Mundari values are preserved exactly as they appear in source files and are not converted from Devanagari automatically.',
    '- The verified Hindi → Mundari Roman baseline remains unchanged and is not imported during this stage.'
  ];

  fs.writeFileSync(path.join(reportsDir, 'lesson1_quality_report.md'), lines.join('\n'));
}

async function verifyCurrentBaseline() {
  const result = await queryDatabase(`SELECT hindi, mundari_roman FROM vocabulary WHERE hindi IN ('आम','केला','एक','दो','तीन','चार','पाँच') ORDER BY CASE hindi WHEN 'आम' THEN 1 WHEN 'केला' THEN 2 WHEN 'एक' THEN 3 WHEN 'दो' THEN 4 WHEN 'तीन' THEN 5 WHEN 'चार' THEN 6 WHEN 'पाँच' THEN 7 ELSE 8 END`);
  return result.rows;
}

async function main() {
  await writeQualityReport();
  const baseline = await verifyCurrentBaseline();
  console.log('DATABASE_BASELINE');
  console.table(baseline);
  const beforeCounts = await queryDatabase(`SELECT 'lessons' AS table_name, COUNT(*) AS count FROM lessons UNION ALL SELECT 'lesson_activities', COUNT(*) FROM lesson_activities UNION ALL SELECT 'lesson_assessments', COUNT(*) FROM lesson_assessments UNION ALL SELECT 'translations', COUNT(*) FROM translations UNION ALL SELECT 'vocabulary', COUNT(*) FROM vocabulary UNION ALL SELECT 'classroom_phrases', COUNT(*) FROM classroom_phrases UNION ALL SELECT 'textbook_terms', COUNT(*) FROM textbook_terms UNION ALL SELECT 'number_vocabulary', COUNT(*) FROM number_vocabulary`);
  console.log('DATABASE_COUNTS_AFTER_READ_ONLY_PASS');
  console.table(beforeCounts.rows);
  console.log('REPORTS_READY');
  console.log(['source_inventory.csv', 'lesson1_duplicates.csv', 'lesson1_database_comparison.csv', 'lesson1_missing_fields.csv', 'lesson1_quality_report.md'].join('\n'));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
}).finally(() => pool.end());
