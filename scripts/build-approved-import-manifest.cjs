const fs = require('node:fs');
const path = require('node:path');
const { parse } = require('csv-parse/sync');

const root = path.resolve(__dirname, '..');
const queuePath = path.join(root, 'data', 'reports', 'class1_human_approval_queue.csv');
const manifestPath = path.join(root, 'data', 'reports', 'class1_approved_import_manifest.csv');
const allowedDecisions = new Set(['APPROVE', 'REJECT', 'HOLD']);
const blockedStatuses = new Set([
  'DUPLICATE',
  'CONFLICT',
  'NEEDS_HUMAN_REVIEW',
  'MISSING_REQUIRED_FIELD',
]);
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
  'current_db_mundari_roman',
  'current_db_category',
  'current_db_source_book',
  'review_status',
  'review_reason',
  'human_decision',
  'human_reviewer',
  'review_notes',
];

function encodeCsvCell(value) {
  const text = String(value ?? '');
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function serializeCsv(columns, rows) {
  return [columns, ...rows.map((row) => columns.map((column) => row[column] ?? ''))]
    .map((row) => row.map(encodeCsvCell).join(','))
    .join('\r\n') + '\r\n';
}

function run() {
  const content = fs.readFileSync(queuePath, 'utf8');
  const records = parse(content, {
    bom: true,
    columns: true,
    skip_empty_lines: true,
    trim: true,
  });
  const columns = records.columns || Object.keys(records[0] || {});
  const missingColumns = requiredColumns.filter((column) => !columns.includes(column));
  if (missingColumns.length) {
    throw new Error(`Approval queue is missing required columns: ${missingColumns.join(', ')}`);
  }

  for (const [index, row] of records.entries()) {
    if (!allowedDecisions.has(row.human_decision)) {
      throw new Error(`Row ${index + 2} has invalid human_decision: ${row.human_decision || '(blank)'}`);
    }
  }

  const approvedRows = records.filter((row) => row.human_decision === 'APPROVE');
  const manifestRows = approvedRows.filter((row) => (
    row.review_status === 'SAFE_TO_IMPORT' && !blockedStatuses.has(row.review_status)
  ));
  const manifestContent = serializeCsv(columns, manifestRows);
  const verifiedManifestRows = parse(manifestContent, {
    bom: true,
    columns: true,
    skip_empty_lines: true,
    trim: true,
  });

  if (verifiedManifestRows.some((row) => row.human_decision !== 'APPROVE')) {
    throw new Error('Safety check failed: manifest contains a row without explicit APPROVE.');
  }
  if (verifiedManifestRows.some((row) => blockedStatuses.has(row.review_status))) {
    throw new Error('Safety check failed: manifest contains a blocked review_status.');
  }
  if (verifiedManifestRows.length !== manifestRows.length) {
    throw new Error('Safety check failed: manifest row count changed during serialization.');
  }

  fs.writeFileSync(manifestPath, manifestContent, 'utf8');

  const rejectedRows = records.filter((row) => row.human_decision === 'REJECT').length;
  const holdRows = records.filter((row) => row.human_decision === 'HOLD').length;
  console.log(`TOTAL_REVIEW_ROWS=${records.length}`);
  console.log(`APPROVED_ROWS=${approvedRows.length}`);
  console.log(`REJECTED_ROWS=${rejectedRows}`);
  console.log(`HOLD_ROWS=${holdRows}`);
  console.log(`IMPORT_MANIFEST_ROWS=${verifiedManifestRows.length}`);
}

try {
  run();
} catch (error) {
  console.error(`Manifest build failed: ${error.message}`);
  process.exitCode = 1;
}
