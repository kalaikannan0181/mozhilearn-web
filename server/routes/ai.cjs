const express = require('express');
const { query } = require('../db.cjs');
const { TranslationServiceError, translateHindiToMundari } = require('../services/translationService.cjs');
const { prepareMundariTtsInputs, transcribeUploadedAudio } = require('../services/uploadedTranslationService.cjs');
const { getAsrStatus } = require('../services/asrService.cjs');
const { createRateLimiter } = require('../middleware/rateLimit.cjs');
const { logError } = require('../lib/logger.cjs');

const router = express.Router();
const AUDIO_EXTENSIONS = new Set(['aac', 'flac', 'm4a', 'mp3', 'mp4', 'ogg', 'wav', 'webm']);
const CLASS1_LESSON_TITLE = 'पाठ 1: फलों के नाम और 1 से 5 तक गिनती';
const expensiveAiLimit = createRateLimiter({ windowMs: 15 * 60 * 1000, max: 20, message: 'Too many AI or speech requests. Try again later.' });
const ttsPreparationLimit = createRateLimiter({ windowMs: 15 * 60 * 1000, max: 30, message: 'Too many TTS preparation requests. Try again later.' });

function normalizeClass1Hindi(text) {
  return text
    .normalize('NFC')
    .replace(/[\p{P}\p{S}]/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim();
}

function isLatinScript(text) {
  const letters = text.match(/\p{L}/gu) || [];
  return letters.length > 0 && letters.every((letter) => /\p{Script=Latin}/u.test(letter));
}

async function transcribeAudioUpload(req, res) {
  const extension = typeof req.query.extension === 'string'
    ? req.query.extension.toLowerCase().replace(/^\./, '')
    : '';

  const contentType = (req.get('content-type') || '').split(';')[0].trim().toLowerCase();
  const mimeTypes = {
    aac: ['audio/aac', 'audio/aacp', 'application/octet-stream'],
    flac: ['audio/flac', 'audio/x-flac', 'application/octet-stream'],
    m4a: ['audio/mp4', 'audio/x-m4a', 'application/octet-stream'],
    mp3: ['audio/mpeg', 'audio/mp3', 'application/octet-stream'],
    mp4: ['audio/mp4', 'application/mp4', 'application/octet-stream'],
    ogg: ['audio/ogg', 'application/ogg', 'application/octet-stream'],
    wav: ['audio/wav', 'audio/x-wav', 'audio/wave', 'application/octet-stream'],
    webm: ['audio/webm', 'application/octet-stream'],
  };
  if (!AUDIO_EXTENSIONS.has(extension) || !mimeTypes[extension]?.includes(contentType)) {
    res.status(400).json({ success: false, message: 'Use a WAV, MP3, M4A, FLAC, OGG, or WebM audio file.' });
    return null;
  }

  if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
    res.status(400).json({ success: false, message: 'A non-empty audio file is required.' });
    return null;
  }
  if (req.body.length > 30 * 1024 * 1024 || !hasAudioSignature(req.body, extension)) {
    res.status(400).json({ success: false, message: 'The uploaded file does not match the selected audio format.' });
    return null;
  }

  try {
    return await transcribeUploadedAudio(req.body, extension);
  } catch (error) {
    const unavailable = error?.message === 'Hindi speech recognition is unavailable.';
    res.status(unavailable ? 503 : 502).json({
      success: false,
      message: error instanceof Error ? error.message : 'Hindi speech recognition failed.',
    });
    return null;
  }
}

function hasAudioSignature(buffer, extension) {
  if (extension === 'wav') return buffer.length >= 12 && buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WAVE';
  if (extension === 'flac') return buffer.length >= 4 && buffer.toString('ascii', 0, 4) === 'fLaC';
  if (extension === 'ogg') return buffer.length >= 4 && buffer.toString('ascii', 0, 4) === 'OggS';
  if (extension === 'mp4' || extension === 'm4a') return buffer.length >= 12 && buffer.toString('ascii', 4, 8) === 'ftyp';
  if (extension === 'mp3') return buffer.length >= 3 && (buffer.toString('ascii', 0, 3) === 'ID3' || (buffer[0] === 0xff && (buffer[1] & 0xe0) === 0xe0));
  if (extension === 'aac') return buffer.length >= 2 && buffer[0] === 0xff && (buffer[1] & 0xf6) === 0xf0;
  if (extension === 'webm') return buffer.length >= 4 && buffer[0] === 0x1a && buffer[1] === 0x45 && buffer[2] === 0xdf && buffer[3] === 0xa3;
  return false;
}

function parseOptionalPositiveInteger(value) {
  if (value === undefined || value === null || value === '') {
    return null;
  }

  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

router.post('/class1-lookup', async (req, res) => {
  const hindiText = req.body?.hindi_text;
  if (typeof hindiText !== 'string' || !hindiText.trim()) {
    return res.status(400).json({
      success: false,
      source: 'class1_verified',
      reason: 'hindi_text_required',
    });
  }

  try {
    const lessonResult = await query(
      'SELECT id FROM lessons WHERE grade = 1 AND subject = $1 AND title = $2 LIMIT 1',
      ['Foundational Numeracy', CLASS1_LESSON_TITLE]
    );
    if (lessonResult.rows.length === 0) {
      return res.status(503).json({
        success: false,
        source: 'class1_verified',
        reason: 'verified_class1_content_unavailable',
      });
    }

    const lessonId = lessonResult.rows[0].id;
    const [vocabularyResult, numberResult, phraseResult, activityResult, assessmentResult] = await Promise.all([
      query(
        `SELECT hindi, mundari_roman AS mundari_roman
         FROM vocabulary
         WHERE object_code = ANY($1::text[])`,
        [['OBJ_02', 'OBJ_03', 'OBJ_04', 'OBJ_05', 'OBJ_06']]
      ),
      query(
        `SELECT hindi, mundari_roman
         FROM number_vocabulary
         WHERE number_value BETWEEN 1 AND 5`
      ),
      query(
        `SELECT hindi, mundari_roman
         FROM classroom_phrases
         WHERE category IN ('lesson_script', 'instruction')`
      ),
      query(
        `SELECT hindi_guide AS hindi, mundari_guide AS mundari_roman
         FROM lesson_activities
         WHERE lesson_id = $1 AND hindi_guide IS NOT NULL AND mundari_guide IS NOT NULL`,
        [lessonId]
      ),
      query(
        `SELECT hindi_question AS hindi, mundari_question AS mundari_roman
         FROM lesson_assessments
         WHERE lesson_id = $1 AND hindi_question IS NOT NULL AND mundari_question IS NOT NULL`,
        [lessonId]
      ),
    ]);

    const normalizedHindi = normalizeClass1Hindi(hindiText);
    const match = [
      ...vocabularyResult.rows,
      ...numberResult.rows,
      ...phraseResult.rows,
      ...activityResult.rows,
      ...assessmentResult.rows,
    ]
      .find((row) => normalizeClass1Hindi(row.hindi) === normalizedHindi
        && typeof row.mundari_roman === 'string'
        && isLatinScript(row.mundari_roman.trim()));
    if (!match || !match.mundari_roman.trim()) {
      return res.status(422).json({
        success: false,
        source: 'class1_verified',
        error: 'Verified translation not found',
        code: 'verified_translation_not_found',
      });
    }

    return res.status(200).json({
      success: true,
      source: 'class1_verified',
      hindi_text: hindiText.trim(),
      mundari_translation: null,
      mundari_roman: match.mundari_roman,
    });
  } catch (error) {
    logError('POST /api/ai/class1-lookup error:', error);
    return res.status(500).json({
      success: false,
      source: 'class1_verified',
      reason: 'verified_class1_lookup_failed',
    });
  }
});

router.post('/translate', expensiveAiLimit, async (req, res) => {
  const { hindi_text: hindiText, lesson_id: lessonId, preview } = req.body || {};
  const parsedLessonId = parseOptionalPositiveInteger(lessonId);

  if (typeof hindiText !== 'string' || !hindiText.trim() || parsedLessonId === undefined) {
    return res.status(400).json({
      success: false,
      message: 'hindi_text is required and lesson_id must be a positive integer when supplied',
    });
  }
  if (hindiText.length > 5000 || typeof preview !== 'boolean' && preview !== undefined || (req.body?.output_script !== undefined && !['roman', 'devanagari'].includes(req.body.output_script))) {
    return res.status(400).json({ success: false, message: 'Translation input is too long or has invalid options' });
  }
  if (req.body?.output_script === 'roman' && preview !== true) {
    return res.status(400).json({ success: false, message: 'Roman-script output is preview-only and cannot be saved as an unreviewed translation' });
  }

  try {
    if (parsedLessonId !== null) {
      const lessonResult = await query('SELECT id FROM lessons WHERE id = $1', [parsedLessonId]);

      if (lessonResult.rows.length === 0) {
        return res.status(404).json({
          success: false,
          message: 'Lesson not found',
        });
      }
    }

    const outputScript = preview === true && req.body?.output_script === 'roman' ? 'roman' : 'devanagari';
    const forms = await translateHindiToMundari(hindiText.trim(), { outputScript });
    if (preview === true) {
      return res.status(200).json({
        success: true,
        translation: {
          mundari_text: forms.mundari_translation,
          ...forms,
        },
      });
    }

    const result = await query(
      `INSERT INTO translations (lesson_id, hindi_text, mundari_text, source, status, model_version, created_by)
       VALUES ($1, $2, $3, 'ai', 'ai_generated', $4, $5)
       RETURNING id,
                 lesson_id,
                 hindi_text,
                 mundari_text,
                 source,
                 status,
                 teacher_notes,
                 reviewer_notes,
                 reviewer_id,
                 model_version,
                 created_at,
                 updated_at`,
      [parsedLessonId, hindiText.trim(), forms.mundari_translation, forms.modelVersion, req.auth.id]
    );

    return res.status(201).json({
      success: true,
      translation: result.rows[0],
    });
  } catch (error) {
    if (error instanceof TranslationServiceError) {
      const status = error.code === 'NOT_CONFIGURED' ? 503 : 502;
      return res.status(status).json({
        success: false,
        message: error.code === 'NOT_CONFIGURED'
          ? 'AI translation provider is not configured'
          : error.code === 'INVALID_SCRIPT'
            ? 'Translation provider did not return Mundari Roman text. Please retry.'
            : 'AI translation provider request failed',
      });
    }

    logError('POST /api/ai/translate error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to save AI translation draft',
    });
  }
});

router.get('/asr-status', (_req, res) => {
  return res.status(200).json({ success: true, status: getAsrStatus() });
});

router.post('/prepare-tts-inputs', ttsPreparationLimit, async (req, res) => {
  const items = req.body?.items;
  if (!Array.isArray(items) || items.length > 100 || items.some((item) => (
    !item || typeof item.id !== 'string' || item.id.length > 100 || typeof item.mundariRoman !== 'string' || item.mundariRoman.length > 1000
  ))) {
    return res.status(400).json({ success: false, message: 'items must contain at most 100 id and mundariRoman pairs.' });
  }

  try {
    const prepared = await prepareMundariTtsInputs(items);
    return res.status(200).json({ success: true, items: prepared });
  } catch (error) {
    logError('POST /api/ai/prepare-tts-inputs error:', error);
    return res.status(502).json({ success: false, message: 'Unable to prepare tokenizer-compatible TTS inputs.' });
  }
});

router.post('/transcribe-audio', expensiveAiLimit, express.raw({ type: ['audio/*', 'application/octet-stream'], limit: '30mb' }), async (req, res) => {
  const hindiText = await transcribeAudioUpload(req, res);
  if (hindiText === null) return;

  return res.status(200).json({
    success: true,
    transcription: { hindi_text: hindiText },
    recognition: { engine: 'faster-whisper', language: 'hi' },
  });
});

router.post('/translate-audio', expensiveAiLimit, express.raw({ type: ['audio/*', 'application/octet-stream'], limit: '30mb' }), async (req, res) => {
  const hindiText = await transcribeAudioUpload(req, res);
  if (hindiText === null) return;

  try {
    const result = await translateHindiToMundari(hindiText);
    return res.status(200).json({
      success: true,
      transcription: { hindi_text: hindiText },
      translation: result,
    });
  } catch (error) {
    if (error instanceof TranslationServiceError) {
      const status = error.code === 'NOT_CONFIGURED' ? 503 : 502;
      return res.status(status).json({
        success: false,
        transcription: { hindi_text: hindiText },
        message: error.code === 'NOT_CONFIGURED'
          ? 'Hindi speech was recognized, but no verified Mundari match or AI translation provider is available.'
          : 'Hindi speech was recognized, but Mundari translation failed.',
      });
    }

    logError('POST /api/ai/translate-audio error:', error);
    return res.status(500).json({ success: false, message: 'Hindi audio translation failed.' });
  }
});

module.exports = router;
