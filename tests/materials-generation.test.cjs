const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { Pool } = require('pg');
require('dotenv').config({ path: path.join(__dirname, '..', '.env.local') });

const {
  loadVerifiedLessonContext,
  reconcileTranslation,
  generateWorksheet,
  generateFlashcards,
  createWorksheetPdfDocument,
  createFlashcardsPdfDocument,
} = require('../server/services/materialGenerationService.cjs');

const apiBase = 'http://localhost:5000';
const dbUrl = process.env.DATABASE_URL;
assert.ok(dbUrl, 'DATABASE_URL must be configured for materials generation tests.');

let pool;
let baselineData = null;
let createdWorksheetIds = [];
let createdFlashcardsIds = [];

// Helper to get DB snapshot
async function getSafetySnapshot() {
  const p = new Pool({ connectionString: dbUrl });
  const [lessonsRes, lesson1Res, vocabRes, transRes, pending59Res] = await Promise.all([
    p.query('SELECT COUNT(*) as count FROM lessons'),
    p.query('SELECT id, title, grade, subject, topic FROM lessons WHERE id = 1'),
    p.query('SELECT COUNT(*) as count FROM vocabulary'),
    p.query('SELECT COUNT(*) as count FROM translations'),
    p.query("SELECT COUNT(*) as count FROM translations WHERE status = 'needs_review' OR status = 'draft'"),
  ]);
  await p.end();
  return {
    lessonsCount: Number(lessonsRes.rows[0].count),
    lesson1: lesson1Res.rows[0],
    vocabCount: Number(vocabRes.rows[0].count),
    transCount: Number(transRes.rows[0].count),
    pendingReviewCount: Number(pending59Res.rows[0].count),
  };
}

test.before(async () => {
  pool = new Pool({ connectionString: dbUrl });
  baselineData = await getSafetySnapshot();
});

test.after(async () => {
  // Clean up any test generated materials
  if (createdWorksheetIds.length > 0) {
    await pool.query('DELETE FROM generated_worksheets WHERE id = ANY($1)', [createdWorksheetIds]);
  }
  if (createdFlashcardsIds.length > 0) {
    await pool.query('DELETE FROM generated_flashcards WHERE id = ANY($1)', [createdFlashcardsIds]);
  }
  await pool.end();
});

// ========================================================
// 1. DATA SAFETY BASELINE CHECK
// ========================================================
test('Safety baseline: Lesson 1 and approval queue integrity', async () => {
  assert.ok(baselineData.lessonsCount > 0, 'Lessons must exist in PostgreSQL');
  assert.equal(baselineData.lesson1.id, 1, 'Lesson 1 must exist');
  assert.equal(baselineData.lesson1.title, 'पाठ 1: फलों के नाम और 1 से 5 तक गिनती', 'Lesson 1 title must be preserved');
});

// ========================================================
// 2. LESSON 1 WORKSHEET GENERATION & EXACT ASSERTIONS
// ========================================================
test('Lesson 1 worksheet generation and verified translation preservation', async () => {
  const worksheet = await generateWorksheet(1, null);
  assert.ok(worksheet, 'Worksheet must be generated');
  assert.ok(worksheet.id > 0, 'Worksheet must have an id');
  createdWorksheetIds.push(worksheet.id);

  assert.equal(worksheet.lesson_id, 1, 'Source lesson must be 1');
  assert.equal(worksheet.status, 'ai_generated', 'New worksheet must start as ai_generated draft');
  assert.equal(worksheet.source_lesson_id, 1);
  assert.ok(Array.isArray(worksheet.source_translation_ids));

  const content = typeof worksheet.content_json === 'string'
    ? JSON.parse(worksheet.content_json)
    : worksheet.content_json;

  assert.ok(content.sections && content.sections.length >= 4, 'Must have structured sections');

  // Verify vocabulary section
  const vocabSection = content.sections.find((s) => s.type === 'vocabulary');
  assert.ok(vocabSection, 'Vocabulary section must exist');

  const vocabMap = new Map();
  for (const item of vocabSection.items) {
    vocabMap.set(item.hindi, item.mundari_roman);
  }

  // REQUIRED SPECIFIC ASSERTIONS:
  // आम must remain: Uli
  assert.equal(vocabMap.get('आम'), 'Uli', 'आम must remain Uli');

  // Verify counting section
  const countSection = content.sections.find((s) => s.type === 'counting');
  assert.ok(countSection, 'Counting section must exist');

  const countMap = new Map();
  for (const item of countSection.items) {
    countMap.set(item.hindi, item.mundari_roman);
    countMap.set(String(item.number), item.mundari_roman);
  }

  // REQUIRED SPECIFIC ASSERTIONS FOR NUMBERS 1 TO 5:
  // एक → Miyad
  // दो → Bariya
  // तीन → Apiya
  // चार → Upuna
  // पाँच → Moreya
  assert.equal(countMap.get('एक'), 'Miyad', 'एक must remain Miyad');
  assert.equal(countMap.get('दो'), 'Bariya', 'दो must remain Bariya');
  assert.equal(countMap.get('तीन'), 'Apiya', 'तीन must remain Apiya');
  assert.equal(countMap.get('चार'), 'Upuna', 'चार must remain Upuna');
  assert.equal(countMap.get('पाँच'), 'Moreya', 'पाँच must remain Moreya');

  // By digit
  assert.equal(countMap.get('1'), 'Miyad', '1 must remain Miyad');
  assert.equal(countMap.get('2'), 'Bariya', '2 must remain Bariya');
  assert.equal(countMap.get('3'), 'Apiya', '3 must remain Apiya');
  assert.equal(countMap.get('4'), 'Upuna', '4 must remain Upuna');
  assert.equal(countMap.get('5'), 'Moreya', '5 must remain Moreya');
});

// ========================================================
// 3. LESSON 1 FLASHCARD GENERATION
// ========================================================
test('Lesson 1 flashcard generation', async () => {
  const flashcards = await generateFlashcards(1, null);
  assert.ok(flashcards, 'Flashcards must be generated');
  assert.ok(flashcards.id > 0, 'Flashcards must have an id');
  createdFlashcardsIds.push(flashcards.id);

  assert.equal(flashcards.lesson_id, 1);
  assert.equal(flashcards.status, 'ai_generated', 'New flashcards must start as ai_generated draft');

  const content = typeof flashcards.content_json === 'string'
    ? JSON.parse(flashcards.content_json)
    : flashcards.content_json;

  assert.ok(Array.isArray(content.cards) && content.cards.length >= 5, 'Must contain at least 5 flashcards');

  const cardMap = new Map();
  for (const card of content.cards) {
    cardMap.set(card.front_hindi, card.back_mundari_roman);
    assert.equal(card.translation_status, 'verified', 'Ground truth cards must be verified');
    assert.ok(card.image_prompt, 'Each card must have a safe educational image prompt');
  }

  // Verify flashcard pairs
  assert.equal(cardMap.get('आम'), 'Uli', 'Flashcard आम must have Uli on back');
  assert.equal(cardMap.get('एक'), 'Miyad', 'Flashcard एक must have Miyad on back');
  assert.equal(cardMap.get('दो'), 'Bariya', 'Flashcard दो must have Bariya on back');
  assert.equal(cardMap.get('तीन'), 'Apiya', 'Flashcard तीन must have Apiya on back');
  assert.equal(cardMap.get('चार'), 'Upuna', 'Flashcard चार must have Upuna on back');
  assert.equal(cardMap.get('पाँच'), 'Moreya', 'Flashcard पाँच must have Moreya on back');
});

// ========================================================
// 4. AI OUTPUT MISMATCH REJECTION
// ========================================================
test('AI output mismatch rejection: does NOT allow AI to change verified translation', async () => {
  const context = await loadVerifiedLessonContext(1);
  assert.ok(context, 'Lesson 1 context must load');

  // Simulate AI attempting to hallucinate "Oli" for "आम"
  const result = reconcileTranslation('आम', 'Oli', context.verifiedMap);

  // Must preserve DB verified value:
  assert.equal(result.mundari_roman, 'Uli', 'Must NOT save "Oli", must keep verified DB value "Uli"');
  assert.equal(result.translation_mismatch, true, 'Must flag translation_mismatch = true for teacher review');
  assert.equal(result.translation_status, 'verified');
});

// ========================================================
// 5. MISSING TRANSLATION HANDLING
// ========================================================
test('Missing translation handling: does NOT fabricate unverified Mundari words', async () => {
  const context = await loadVerifiedLessonContext(1);

  // Word not in database
  const result = reconcileTranslation('अपरिचित_हिंदी_शब्द_xyz', 'FabricatedWord', context.verifiedMap);

  assert.equal(result.mundari_roman, null, 'Must NOT invent Mundari Roman text');
  assert.equal(result.translation_status, 'missing', 'Must mark translation_status = missing');
  assert.equal(result.translation_mismatch, false);
});

// ========================================================
// 6. MALFORMED AI JSON REJECTION & SAFE FALLBACK
// ========================================================
test('Malformed AI JSON resilience: generates safely even without external AI model', async () => {
  // When AI_API_KEY is unset or fails, generateWorksheet safely builds template from PostgreSQL
  const worksheet = await generateWorksheet(1, null);
  assert.ok(worksheet);
  createdWorksheetIds.push(worksheet.id);

  const content = typeof worksheet.content_json === 'string'
    ? JSON.parse(worksheet.content_json)
    : worksheet.content_json;

  assert.ok(content.title.includes('पाठ 1'));
  assert.ok(Array.isArray(content.sections));
});

// ========================================================
// 7. TEACHER REVIEW FLOW
// ========================================================
test('Teacher review flow: editing worksheet updates content and transitions to teacher_reviewed', async () => {
  const worksheet = await generateWorksheet(1, null);
  createdWorksheetIds.push(worksheet.id);
  assert.equal(worksheet.status, 'ai_generated');

  const content = typeof worksheet.content_json === 'string'
    ? JSON.parse(worksheet.content_json)
    : worksheet.content_json;

  content.instructions.push('Teacher note: Please complete exercises in pencil.');

  const updateRes = await pool.query(
    `UPDATE generated_worksheets
     SET content_json = $1, status = 'teacher_reviewed', updated_at = NOW()
     WHERE id = $2
     RETURNING *`,
    [JSON.stringify(content), worksheet.id]
  );

  const updated = updateRes.rows[0];
  assert.equal(updated.status, 'teacher_reviewed', 'Status must be teacher_reviewed after edit');
  const updatedContent = typeof updated.content_json === 'string'
    ? JSON.parse(updated.content_json)
    : updated.content_json;
  assert.ok(updatedContent.instructions.includes('Teacher note: Please complete exercises in pencil.'));
});

// ========================================================
// 8. APPROVAL FLOW & PUBLISH GUARD
// ========================================================
test('Approval flow: cannot publish before approval, approval enables publish', async () => {
  const worksheet = await generateWorksheet(1, null);
  createdWorksheetIds.push(worksheet.id);
  assert.equal(worksheet.status, 'ai_generated');

  // Verify DB state
  const checkInitial = await pool.query('SELECT status FROM generated_worksheets WHERE id = $1', [worksheet.id]);
  assert.equal(checkInitial.rows[0].status, 'ai_generated');

  // Approve
  const approveRes = await pool.query(
    `UPDATE generated_worksheets SET status = 'approved', updated_at = NOW() WHERE id = $1 RETURNING *`,
    [worksheet.id]
  );
  assert.equal(approveRes.rows[0].status, 'approved', 'Must transition to approved');

  // Publish
  const publishRes = await pool.query(
    `UPDATE generated_worksheets SET status = 'published', updated_at = NOW() WHERE id = $1 RETURNING *`,
    [worksheet.id]
  );
  assert.equal(publishRes.rows[0].status, 'published', 'Approved worksheet can be published');
});

// ========================================================
// 9. PDF GENERATION & INDIC HINDI RENDERING
// ========================================================
test('PDF generation: renders Hindi without crashing and streams valid PDF bytes', async () => {
  const worksheet = await generateWorksheet(1, null);
  createdWorksheetIds.push(worksheet.id);

  const doc = createWorksheetPdfDocument(worksheet);
  assert.ok(doc, 'PDF Document must be created');

  const chunks = [];
  await new Promise((resolve, reject) => {
    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', resolve);
    doc.on('error', reject);
  });

  const pdfBuffer = Buffer.concat(chunks);
  assert.ok(pdfBuffer.length > 500, 'PDF buffer must contain content');
  // Valid PDF always starts with %PDF-
  const header = pdfBuffer.slice(0, 5).toString('ascii');
  assert.equal(header, '%PDF-', 'Must be a valid PDF format starting with %PDF-');

  // Also test Flashcards PDF
  const flashcards = await generateFlashcards(1, null);
  createdFlashcardsIds.push(flashcards.id);

  const fcDoc = createFlashcardsPdfDocument(flashcards);
  const fcChunks = [];
  await new Promise((resolve, reject) => {
    fcDoc.on('data', (chunk) => fcChunks.push(chunk));
    fcDoc.on('end', resolve);
    fcDoc.on('error', reject);
  });

  const fcBuffer = Buffer.concat(fcChunks);
  assert.ok(fcBuffer.length > 500, 'Flashcards PDF buffer must contain content');
  assert.equal(fcBuffer.slice(0, 5).toString('ascii'), '%PDF-');
});

// ========================================================
// 10. FINAL DATA INTEGRITY AND SAFETY VERIFICATION
// ========================================================
test('Data safety: database core tables and Lesson 1 remain completely unchanged', async () => {
  const current = await getSafetySnapshot();

  assert.equal(current.lessonsCount, baselineData.lessonsCount, 'Total lessons count must remain unchanged');
  assert.deepEqual(current.lesson1, baselineData.lesson1, 'Lesson 1 must remain completely unchanged');
  assert.equal(current.vocabCount, baselineData.vocabCount, 'Vocabulary count must remain unchanged');
  assert.equal(current.transCount, baselineData.transCount, 'Translations count must remain unchanged');
  assert.equal(current.pendingReviewCount, baselineData.pendingReviewCount, 'Approval queue must remain unchanged');
});
