const path = require('path');
const fs = require('fs');
const PDFDocument = require('pdfkit');
const { query } = require('../db.cjs');
const { logError } = require('../lib/logger.cjs');

const REGULAR_FONT = path.join(__dirname, '..', 'fonts', 'NotoSansDevanagari-Regular.ttf');
const BOLD_FONT = path.join(__dirname, '..', 'fonts', 'NotoSansDevanagari-Bold.ttf');
const GENERATOR_VERSION = '1.0.0';

function normalizeHindi(text) {
  if (typeof text !== 'string') return '';
  return text
    .normalize('NFC')
    .replace(/[\p{P}\p{S}]/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim();
}

/**
 * Builds ground-truth lookup maps from the database for verified translations.
 */
async function loadVerifiedLessonContext(lessonId) {
  const [lessonRes, activitiesRes, assessmentsRes, vocabRes, numbersRes, phrasesRes, transRes] = await Promise.all([
    query('SELECT id, title, grade, subject, topic, learning_outcome_hindi, learning_outcome_mundari FROM lessons WHERE id = $1', [lessonId]),
    query('SELECT id, activity_name, hindi_guide, mundari_guide FROM lesson_activities WHERE lesson_id = $1 ORDER BY id', [lessonId]),
    query('SELECT id, question_no, hindi_question, mundari_question, expected_answer FROM lesson_assessments WHERE lesson_id = $1 ORDER BY question_no, id', [lessonId]),
    query('SELECT id, english, hindi, mundari_roman FROM vocabulary ORDER BY id'),
    query('SELECT id, number_value, hindi, mundari_roman FROM number_vocabulary ORDER BY number_value'),
    query('SELECT id, category, hindi, mundari_roman FROM classroom_phrases ORDER BY id'),
    query("SELECT id, hindi_text, mundari_text, status FROM translations WHERE status IN ('approved', 'native_reviewed', 'teacher_reviewed')"),
  ]);

  if (!lessonRes.rows[0]) return null;

  const verifiedMap = new Map();
  const sourceTranslationIds = [];

  // 1. Vocabulary
  for (const row of vocabRes.rows) {
    if (row.hindi && row.mundari_roman) {
      const key = normalizeHindi(row.hindi);
      if (!verifiedMap.has(key)) {
        verifiedMap.set(key, {
          source_hindi: row.hindi,
          mundari_roman: row.mundari_roman.trim(),
          source_type: 'vocabulary',
          source_id: row.id,
        });
        sourceTranslationIds.push(`vocab-${row.id}`);
      }
    }
  }

  // 2. Numbers
  for (const row of numbersRes.rows) {
    if (row.hindi && row.mundari_roman) {
      const key = normalizeHindi(row.hindi);
      verifiedMap.set(key, {
        source_hindi: row.hindi,
        mundari_roman: row.mundari_roman.trim(),
        number_value: row.number_value,
        source_type: 'number_vocabulary',
        source_id: row.id,
      });
      sourceTranslationIds.push(`num-${row.id}`);
    }
    // Also index digits '1', '2', etc.
    const digitKey = String(row.number_value);
    verifiedMap.set(digitKey, {
      source_hindi: row.hindi,
      mundari_roman: row.mundari_roman.trim(),
      number_value: row.number_value,
      source_type: 'number_vocabulary',
      source_id: row.id,
    });
  }

  // 3. Phrases
  for (const row of phrasesRes.rows) {
    if (row.hindi && row.mundari_roman) {
      const key = normalizeHindi(row.hindi);
      if (!verifiedMap.has(key)) {
        verifiedMap.set(key, {
          source_hindi: row.hindi,
          mundari_roman: row.mundari_roman.trim(),
          category: row.category,
          source_type: 'classroom_phrases',
          source_id: row.id,
        });
        sourceTranslationIds.push(`phrase-${row.id}`);
      }
    }
  }

  // 4. Approved translations table
  for (const row of transRes.rows) {
    if (row.hindi_text && row.mundari_text) {
      const key = normalizeHindi(row.hindi_text);
      if (!verifiedMap.has(key)) {
        verifiedMap.set(key, {
          source_hindi: row.hindi_text,
          mundari_roman: row.mundari_text.trim(),
          source_type: 'translations',
          source_id: row.id,
        });
        sourceTranslationIds.push(`trans-${row.id}`);
      }
    }
  }

  return {
    lesson: lessonRes.rows[0],
    activities: activitiesRes.rows,
    assessments: assessmentsRes.rows,
    vocabulary: vocabRes.rows,
    numbers: numbersRes.rows,
    phrases: phrasesRes.rows,
    verifiedMap,
    sourceTranslationIds,
  };
}

/**
 * Reconciles an item's proposed Mundari translation against verified database content.
 * Prevents AI hallucinations and corruptions of verified values.
 */
function reconcileTranslation(hindiText, proposedMundariRoman, verifiedMap) {
  const normalized = normalizeHindi(hindiText);
  const verified = verifiedMap.get(normalized);

  if (verified && verified.mundari_roman) {
    const verifiedRoman = verified.mundari_roman;
    const proposed = (proposedMundariRoman || '').trim();

    // Check if AI proposed something that differs from our verified ground-truth
    const mismatch = proposed.length > 0 && proposed.toLowerCase() !== verifiedRoman.toLowerCase();

    return {
      source_hindi: verified.source_hindi || hindiText,
      mundari_roman: verifiedRoman, // ALWAYS preserve verified DB value!
      translation_status: 'verified',
      translation_mismatch: mismatch,
      translation_id: verified.source_id,
      source_type: verified.source_type,
    };
  }

  // No verified translation exists in DB: DO NOT invent a Mundari word!
  return {
    source_hindi: hindiText,
    mundari_roman: null,
    translation_status: 'missing',
    translation_mismatch: false,
    translation_id: null,
  };
}

/**
 * Call the AI model for structured generation if API key is present.
 */
async function callAiModel(systemPrompt, userPrompt) {
  const apiKey = process.env.AI_API_KEY;
  if (!apiKey) return null;

  const apiUrl = process.env.AI_API_URL || 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions';
  const model = process.env.AI_MODEL || 'gemini-3.8-flash';

  const timeoutMs = process.env.AI_TIMEOUT_MS ? Number(process.env.AI_TIMEOUT_MS) : (process.env.NODE_ENV === 'test' ? 3000 : 8000);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        temperature: 0.1,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
      }),
      signal: controller.signal,
    });

    clearTimeout(timeout);
    if (!response.ok) return null;

    const data = await response.json();
    const content = data?.choices?.[0]?.message?.content;
    if (!content) return null;

    return JSON.parse(content);
  } catch (err) {
    clearTimeout(timeout);
    logError('AI model call failed or timed out:', err);
    return null;
  }
}

/**
 * Generate a complete, verified worksheet for a lesson.
 */
async function generateWorksheet(lessonId, userId) {
  const context = await loadVerifiedLessonContext(lessonId);
  if (!context) throw new Error(`Lesson ${lessonId} not found`);

  const { lesson, activities, assessments, vocabulary, numbers, phrases, verifiedMap, sourceTranslationIds } = context;

  // Build grounded fallback/deterministic content based strictly on verified lesson data
  const relevantVocab = vocabulary.filter((v) => ['आम', 'केला', 'सेब', 'अमरूद', 'पपीता'].includes(v.hindi) || v.id <= 5);
  const relevantNumbers = numbers.filter((n) => n.number_value >= 1 && n.number_value <= 5);

  const fallbackWorksheet = {
    title: `${lesson.title} - कार्यपत्रक (Worksheet)`,
    instructions: [
      'सभी प्रश्नों के उत्तर ध्यानपूर्वक अपनी मातृभाषा (मुंडारी) एवं हिंदी में लिखें।',
      'संख्या और फलों के नामों का सही मिलान करें।',
    ],
    sections: [
      {
        type: 'header',
        school_class: `कक्षा ${lesson.grade} (Grade ${lesson.grade})`,
        lesson_title: lesson.title,
        subject: lesson.subject,
        topic: lesson.topic,
      },
      {
        type: 'vocabulary',
        title: 'Vocabulary / शब्दावली',
        items: relevantVocab.map((v) => ({
          hindi: v.hindi,
          mundari_roman: v.mundari_roman,
        })),
      },
      {
        type: 'counting',
        title: 'Counting / गिनती (1 से 5)',
        items: relevantNumbers.map((n) => ({
          number: n.number_value,
          hindi: n.hindi,
          mundari_roman: n.mundari_roman,
        })),
      },
      {
        type: 'matching',
        title: 'Matching / सही मिलान करें',
        pairs: [
          { hindi: 'आम', mundari_roman: 'Uli', cue: '🥭' },
          { hindi: 'केला', mundari_roman: 'Kela', cue: '🍌' },
          { hindi: 'एक', mundari_roman: 'Miyad', cue: '1' },
          { hindi: 'दो', mundari_roman: 'Bariya', cue: '2' },
          { hindi: 'तीन', mundari_roman: 'Apiya', cue: '3' },
          { hindi: 'चार', mundari_roman: 'Upuna', cue: '4' },
          { hindi: 'पाँच', mundari_roman: 'Moreya', cue: '5' },
        ],
      },
      {
        type: 'activity',
        title: 'Classroom Activity / गतिविधि',
        items: activities.length > 0 ? activities.map((a) => ({
          task_hindi: a.hindi_guide || a.activity_name,
          task_mundari_roman: a.mundari_guide || '',
          instruction: a.activity_name,
        })) : [
          {
            task_hindi: 'आम गिनो',
            task_mundari_roman: 'Uli leka me',
            instruction: 'चित्र देखकर आमों की संख्या मुंडारी में बोलें।',
          },
        ],
      },
      {
        type: 'assessment',
        title: 'Assessment Questions / मूल्यांकन प्रश्न',
        questions: assessments.length > 0 ? assessments.map((q) => ({
          question_no: q.question_no,
          hindi_question: q.hindi_question,
          mundari_question: q.mundari_question || '',
          expected_answer: q.expected_answer || '',
        })) : [
          {
            question_no: 1,
            hindi_question: 'आम को मुंडारी में क्या कहते हैं?',
            mundari_question: 'Uli chi kela?',
            expected_answer: 'Uli',
          },
          {
            question_no: 2,
            hindi_question: 'मुंडारी में 1 से 3 तक की गिनती लिखें।',
            mundari_question: 'Miyad, Bariya, Apiya',
            expected_answer: 'Miyad, Bariya, Apiya',
          },
        ],
      },
    ],
  };

  let candidateWorksheet = fallbackWorksheet;

  // Try AI enhancement with strict prompt and verified vocabulary grounding
  const systemPrompt = `You are an educational worksheet generator for MozhiLearn PALASH AI Classroom for Grade 1 children in Jharkhand, India.
Output ONLY valid JSON matching this structure:
{
  "title": string,
  "instructions": [string],
  "sections": [
    { "type": "vocabulary", "title": string, "items": [{ "hindi": string, "mundari_roman": string }] },
    { "type": "counting", "title": string, "items": [{ "number": number, "hindi": string, "mundari_roman": string }] },
    { "type": "matching", "title": string, "pairs": [{ "hindi": string, "mundari_roman": string, "cue": string }] },
    { "type": "activity", "title": string, "items": [{ "task_hindi": string, "task_mundari_roman": string, "instruction": string }] },
    { "type": "assessment", "title": string, "questions": [{ "question_no": number, "hindi_question": string, "mundari_question": string, "expected_answer": string }] }
  ]
}
Ground every vocabulary word and number ONLY on the verified values provided. Never invent Mundari words.`;

  const userPrompt = `Generate a Grade 1 worksheet for Lesson: "${lesson.title}".
Subject: ${lesson.subject}. Topic: ${lesson.topic}.
Verified Vocabulary:
${relevantVocab.map((v) => `${v.hindi} -> ${v.mundari_roman}`).join('\n')}
Verified Numbers:
${relevantNumbers.map((n) => `${n.number_value}: ${n.hindi} -> ${n.mundari_roman}`).join('\n')}
Phrases:
${phrases.slice(0, 5).map((p) => `${p.hindi} -> ${p.mundari_roman}`).join('\n')}`;

  const aiResult = await callAiModel(systemPrompt, userPrompt);
  if (aiResult && Array.isArray(aiResult.sections) && aiResult.sections.length >= 3) {
    candidateWorksheet = {
      title: aiResult.title || fallbackWorksheet.title,
      instructions: Array.isArray(aiResult.instructions) ? aiResult.instructions : fallbackWorksheet.instructions,
      sections: aiResult.sections,
    };
  }

  // RECONCILE AND ENFORCE TRANSLATION SAFETY
  let hasMissing = false;
  let hasMismatch = false;

  const sanitizedSections = candidateWorksheet.sections.map((section) => {
    if (section.type === 'vocabulary' && Array.isArray(section.items)) {
      const items = section.items.map((item) => {
        const recon = reconcileTranslation(item.hindi, item.mundari_roman, verifiedMap);
        if (recon.translation_status === 'missing') hasMissing = true;
        if (recon.translation_mismatch) hasMismatch = true;
        return {
          hindi: recon.source_hindi,
          mundari_roman: recon.mundari_roman,
          translation_status: recon.translation_status,
          translation_mismatch: recon.translation_mismatch,
          translation_id: recon.translation_id,
        };
      });
      return { ...section, items };
    }

    if (section.type === 'counting' && Array.isArray(section.items)) {
      const items = section.items.map((item) => {
        const recon = reconcileTranslation(item.hindi || String(item.number), item.mundari_roman, verifiedMap);
        if (recon.translation_status === 'missing') hasMissing = true;
        if (recon.translation_mismatch) hasMismatch = true;
        return {
          number: Number(item.number) || 1,
          hindi: recon.source_hindi,
          mundari_roman: recon.mundari_roman,
          translation_status: recon.translation_status,
          translation_mismatch: recon.translation_mismatch,
        };
      });
      return { ...section, items };
    }

    if (section.type === 'matching' && Array.isArray(section.pairs)) {
      const pairs = section.pairs.map((pair) => {
        const recon = reconcileTranslation(pair.hindi, pair.mundari_roman, verifiedMap);
        if (recon.translation_status === 'missing') hasMissing = true;
        if (recon.translation_mismatch) hasMismatch = true;
        return {
          hindi: recon.source_hindi,
          mundari_roman: recon.mundari_roman,
          cue: pair.cue || '',
          translation_status: recon.translation_status,
          translation_mismatch: recon.translation_mismatch,
        };
      });
      return { ...section, pairs };
    }

    if (section.type === 'activity' && Array.isArray(section.items)) {
      const items = section.items.map((item) => {
        const recon = reconcileTranslation(item.task_hindi, item.task_mundari_roman, verifiedMap);
        return {
          task_hindi: recon.source_hindi,
          task_mundari_roman: recon.mundari_roman,
          instruction: item.instruction || '',
          translation_status: recon.translation_status,
          translation_mismatch: recon.translation_mismatch,
        };
      });
      return { ...section, items };
    }

    if (section.type === 'assessment' && Array.isArray(section.questions)) {
      const questions = section.questions.map((item) => {
        const recon = reconcileTranslation(item.hindi_question, item.mundari_question, verifiedMap);
        if (recon.translation_status === 'missing') hasMissing = true;
        if (recon.translation_mismatch) hasMismatch = true;
        return {
          ...item,
          mundari_question: recon.mundari_roman,
          translation_status: recon.translation_status,
          translation_mismatch: recon.translation_mismatch,
        };
      });
      return { ...section, questions };
    }

    return section;
  });

  const finalContent = {
    title: candidateWorksheet.title,
    instructions: candidateWorksheet.instructions,
    sections: sanitizedSections,
    provenance: {
      lesson_id: lesson.id,
      generator_version: GENERATOR_VERSION,
      has_missing_translations: hasMissing,
      has_translation_mismatches: hasMismatch,
    },
  };

  const insertRes = await query(
    `INSERT INTO generated_worksheets (lesson_id, title, content_json, status, created_by, source_lesson_id, source_translation_ids, generator_version)
     VALUES ($1, $2, $3, 'ai_generated', $4, $5, $6, $7)
     RETURNING *`,
    [lesson.id, finalContent.title, JSON.stringify(finalContent), userId || null, lesson.id, JSON.stringify(sourceTranslationIds), GENERATOR_VERSION]
  );

  return insertRes.rows[0];
}

/**
 * Generate structured, verified flashcards for a lesson.
 */
async function generateFlashcards(lessonId, userId) {
  const context = await loadVerifiedLessonContext(lessonId);
  if (!context) throw new Error(`Lesson ${lessonId} not found`);

  const { lesson, vocabulary, numbers, verifiedMap, sourceTranslationIds } = context;

  // Selected verified vocabulary items for Lesson 1
  const targets = [
    { hindi: 'आम', english: 'mango', fallbackPrompt: 'simple educational illustration of one fresh mango for Grade 1' },
    { hindi: 'केला', english: 'banana', fallbackPrompt: 'simple educational illustration of a ripe banana for Grade 1' },
    { hindi: 'एक', english: 'number 1', fallbackPrompt: 'educational numeral 1 flashcard with one fruit for foundational numeracy' },
    { hindi: 'दो', english: 'number 2', fallbackPrompt: 'educational numeral 2 flashcard with two fruits for foundational numeracy' },
    { hindi: 'तीन', english: 'number 3', fallbackPrompt: 'educational numeral 3 flashcard with three fruits for foundational numeracy' },
    { hindi: 'चार', english: 'number 4', fallbackPrompt: 'educational numeral 4 flashcard with four fruits for foundational numeracy' },
    { hindi: 'पाँच', english: 'number 5', fallbackPrompt: 'educational numeral 5 flashcard with five fruits for foundational numeracy' },
  ];

  // Also include any other matching vocabulary from this lesson
  for (const v of vocabulary) {
    if (v.hindi && !targets.some((t) => t.hindi === v.hindi) && targets.length < 10) {
      targets.push({
        hindi: v.hindi,
        english: v.english || v.hindi,
        fallbackPrompt: `simple educational illustration of ${v.english || v.hindi} for Grade 1 classroom`,
      });
    }
  }

  // Build flashcards directly from ground-truth verified values
  const cards = targets.map((item) => {
    const recon = reconcileTranslation(item.hindi, '', verifiedMap);
    return {
      front_hindi: recon.source_hindi,
      back_mundari_roman: recon.mundari_roman, // Enforce exact verified Mundari Roman
      image_prompt: item.fallbackPrompt,
      lesson_id: lesson.id,
      translation_id: recon.translation_id,
      translation_status: recon.translation_status,
      translation_mismatch: false,
    };
  });

  const finalContent = {
    title: `${lesson.title} - फ्लैशकार्ड्स (Flashcards)`,
    cards,
    provenance: {
      lesson_id: lesson.id,
      generator_version: GENERATOR_VERSION,
      total_cards: cards.length,
    },
  };

  const insertRes = await query(
    `INSERT INTO generated_flashcards (lesson_id, title, content_json, status, created_by, source_lesson_id, source_translation_ids, generator_version)
     VALUES ($1, $2, $3, 'ai_generated', $4, $5, $6, $7)
     RETURNING *`,
    [lesson.id, finalContent.title, JSON.stringify(finalContent), userId || null, lesson.id, JSON.stringify(sourceTranslationIds), GENERATOR_VERSION]
  );

  return insertRes.rows[0];
}

/**
 * Creates a high quality PDF with Devanagari font for a worksheet.
 */
function createWorksheetPdfDocument(worksheetData) {
  const content = typeof worksheetData.content_json === 'string'
    ? JSON.parse(worksheetData.content_json)
    : worksheetData.content_json;

  const doc = new PDFDocument({ margin: 40, size: 'A4' });

  // Register Devanagari fonts
  const hasRegularFont = fs.existsSync(REGULAR_FONT);
  const hasBoldFont = fs.existsSync(BOLD_FONT);

  if (hasRegularFont) doc.registerFont('NotoRegular', REGULAR_FONT);
  if (hasBoldFont) doc.registerFont('NotoBold', BOLD_FONT);

  const regular = hasRegularFont ? 'NotoRegular' : 'Helvetica';
  const bold = hasBoldFont ? 'NotoBold' : 'Helvetica-Bold';

  // Title & Header
  doc.font(bold).fontSize(18).fillColor('#1b4332').text(content.title || 'कार्यपत्रक (Worksheet)', { align: 'center' });
  doc.moveDown(0.4);

  doc.font(regular).fontSize(10).fillColor('#555555')
    .text(`Status: ${worksheetData.status?.toUpperCase() || 'DRAFT'} | MozhiLearn PALASH AI Classroom`, { align: 'center' });
  doc.moveDown(0.6);

  // Divider
  doc.strokeColor('#2d6a4f').lineWidth(1.5).moveTo(40, doc.y).lineTo(555, doc.y).stroke();
  doc.moveDown(0.8);

  // Instructions
  if (Array.isArray(content.instructions) && content.instructions.length > 0) {
    doc.font(bold).fontSize(11).fillColor('#1b4332').text('निर्देश (Instructions):');
    doc.font(regular).fontSize(9.5).fillColor('#333333');
    content.instructions.forEach((ins, idx) => {
      doc.text(`${idx + 1}. ${ins}`);
    });
    doc.moveDown(0.8);
  }

  // Sections
  const sections = Array.isArray(content.sections) ? content.sections : [];
  for (const sec of sections) {
    if (doc.y > 700) doc.addPage();

    if (sec.type === 'vocabulary') {
      doc.font(bold).fontSize(13).fillColor('#1b4332').text(sec.title || 'शब्दावली (Vocabulary)');
      doc.moveDown(0.3);
      doc.font(regular).fontSize(10).fillColor('#222222');
      if (Array.isArray(sec.items)) {
        sec.items.forEach((item) => {
          doc.text(`• ${item.hindi}  =  ${item.mundari_roman || '(अनुवाद प्रतीक्षित)'}`);
        });
      }
      doc.moveDown(0.8);
    } else if (sec.type === 'counting') {
      doc.font(bold).fontSize(13).fillColor('#1b4332').text(sec.title || 'गिनती (Counting 1 to 5)');
      doc.moveDown(0.3);
      doc.font(regular).fontSize(10).fillColor('#222222');
      if (Array.isArray(sec.items)) {
        sec.items.forEach((item) => {
          doc.text(`[ ${item.number} ]   ${item.hindi}   →   ${item.mundari_roman || ''}`);
        });
      }
      doc.moveDown(0.8);
    } else if (sec.type === 'matching') {
      doc.font(bold).fontSize(13).fillColor('#1b4332').text(sec.title || 'सही मिलान करें (Matching)');
      doc.moveDown(0.3);
      doc.font(regular).fontSize(10).fillColor('#222222');
      if (Array.isArray(sec.pairs)) {
        sec.pairs.forEach((pair, idx) => {
          doc.text(`${idx + 1}. ${pair.hindi} ${pair.cue ? `(${pair.cue})` : ''}  __________  ${pair.mundari_roman || ''}`);
        });
      }
      doc.moveDown(0.8);
    } else if (sec.type === 'activity') {
      doc.font(bold).fontSize(13).fillColor('#1b4332').text(sec.title || 'गतिविधि (Classroom Activity)');
      doc.moveDown(0.3);
      doc.font(regular).fontSize(10).fillColor('#222222');
      if (Array.isArray(sec.items)) {
        sec.items.forEach((item, idx) => {
          doc.text(`${idx + 1}. ${item.task_hindi} (${item.task_mundari_roman || ''})`);
          if (item.instruction) doc.fontSize(9).fillColor('#666666').text(`   निर्देश: ${item.instruction}`).fontSize(10).fillColor('#222222');
        });
      }
      doc.moveDown(0.8);
    } else if (sec.type === 'assessment') {
      doc.font(bold).fontSize(13).fillColor('#1b4332').text(sec.title || 'मूल्यांकन (Assessment Questions)');
      doc.moveDown(0.3);
      doc.font(regular).fontSize(10).fillColor('#222222');
      if (Array.isArray(sec.questions)) {
        sec.questions.forEach((q) => {
          doc.text(`प्र. ${q.question_no}: ${q.hindi_question}`);
          if (q.mundari_question) doc.text(`   (मुंडारी: ${q.mundari_question})`);
          doc.text(`   उत्तर: ___________________________________`);
          doc.moveDown(0.4);
        });
      }
    }
  }

  doc.end();
  return doc;
}

/**
 * Creates printable flashcards PDF document with Devanagari font.
 */
function createFlashcardsPdfDocument(flashcardsData) {
  const content = typeof flashcardsData.content_json === 'string'
    ? JSON.parse(flashcardsData.content_json)
    : flashcardsData.content_json;

  const doc = new PDFDocument({ margin: 30, size: 'A4' });

  const hasRegularFont = fs.existsSync(REGULAR_FONT);
  const hasBoldFont = fs.existsSync(BOLD_FONT);

  if (hasRegularFont) doc.registerFont('NotoRegular', REGULAR_FONT);
  if (hasBoldFont) doc.registerFont('NotoBold', BOLD_FONT);

  const regular = hasRegularFont ? 'NotoRegular' : 'Helvetica';
  const bold = hasBoldFont ? 'NotoBold' : 'Helvetica-Bold';

  doc.font(bold).fontSize(16).fillColor('#1b4332').text(content.title || 'MozhiLearn Flashcards', { align: 'center' });
  doc.font(regular).fontSize(9).fillColor('#666666').text('Printable Classroom Cards | Hindi (Front) - Mundari Roman (Back)', { align: 'center' });
  doc.moveDown(1);

  const cards = Array.isArray(content.cards) ? content.cards : [];
  let cardIndex = 0;

  for (const card of cards) {
    if (doc.y > 680) doc.addPage();

    const startY = doc.y;
    // Draw box for card
    doc.roundedRect(40, startY, 515, 75, 8).strokeColor('#2d6a4f').lineWidth(1).stroke();

    // Front: Hindi
    doc.font(bold).fontSize(16).fillColor('#1b4332').text(card.front_hindi || '', 55, startY + 14);
    if (card.image_prompt) {
      doc.font(regular).fontSize(8).fillColor('#777777').text(card.image_prompt, 55, startY + 42, { width: 280 });
    }

    // Divider line inside card
    doc.strokeColor('#e5e7eb').lineWidth(0.8).moveTo(340, startY + 10).lineTo(340, startY + 65).stroke();

    // Back: Mundari Roman
    doc.font(regular).fontSize(9).fillColor('#888888').text('Mundari Roman:', 355, startY + 16);
    doc.font(bold).fontSize(18).fillColor('#d97706').text(card.back_mundari_roman || '(Missing)', 355, startY + 34);

    doc.y = startY + 88;
    cardIndex += 1;
  }

  doc.end();
  return doc;
}

module.exports = {
  loadVerifiedLessonContext,
  reconcileTranslation,
  generateWorksheet,
  generateFlashcards,
  createWorksheetPdfDocument,
  createFlashcardsPdfDocument,
};
