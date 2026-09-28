const express = require('express');
const path = require('path');
const fs = require('fs');
const { query } = require('../db.cjs');
const { prepareMundariTtsInputs } = require('../services/uploadedTranslationService.cjs');
const { getAudioStatus, synthesize, AUDIO_ROOT } = require('../services/ttsService.cjs');
const { createRateLimiter } = require('../middleware/rateLimit.cjs');

const router = express.Router();
const isProduction = process.env.NODE_ENV === 'production';
const speakLimit = createRateLimiter({ windowMs: 60 * 1000, max: isProduction ? 20 : 500, message: 'Too many TTS requests. Try again later.' });

router.get('/health', async (_req, res) => {
  const language = (_req.query.language || 'mundari').toString();
  return res.status(200).json(await getAudioStatus({ language }));
});

router.get('/status', async (_req, res) => {
  const language = (_req.query.language || 'mundari').toString();
  return res.status(200).json(await getAudioStatus({ language }));
});

router.get('/audio/:file', (req, res) => {
  const file = req.params.file;
  if (!/^[a-f0-9]{64}\.wav$/.test(file)) {
    return res.status(400).json({ success: false, message: 'Invalid audio file.' });
  }
  const requestedPath = path.resolve(AUDIO_ROOT, 'generated', file);
  const generatedRoot = path.resolve(AUDIO_ROOT, 'generated');
  if (!requestedPath.startsWith(`${generatedRoot}${path.sep}`) || !fs.existsSync(requestedPath)) {
    return res.status(404).json({ success: false, message: 'Audio file not found.' });
  }

  res.setHeader('Content-Type', 'audio/wav');
  res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
  return res.sendFile(requestedPath);
});

router.post('/speak', speakLimit, async (req, res) => {
  const {
    source_text: sourceText,
    mundari_translation: mundariTranslation,
    mundari_roman: mundariRomanRaw,
    tts_input: ttsInputRaw,
    tts_input_script: ttsInputScriptRaw,
    language,
    source_type: sourceType,
    source_id: sourceId,
  } = req.body || {};

  if (language !== undefined && language !== 'mundari') {
    return res.status(400).json({
      success: false,
      available: false,
      status: 'invalid_input',
      message: 'Only Mundari language is supported.',
    });
  }

  const mundariRoman = typeof mundariRomanRaw === 'string' && mundariRomanRaw.trim()
    ? mundariRomanRaw.trim()
    : typeof mundariTranslation === 'string' && mundariTranslation.trim()
    ? mundariTranslation.trim()
    : '';

  let ttsInput = typeof ttsInputRaw === 'string' ? ttsInputRaw.trim() : '';
  let ttsInputScript = typeof ttsInputScriptRaw === 'string' ? ttsInputScriptRaw.trim() : '';

  if (!mundariRoman) {
    return res.status(400).json({
      success: false,
      status: 'invalid_input',
      mode: 'unavailable',
      language: 'mundari',
      message: 'A verified Mundari Roman translation is required for TTS.',
    });
  }

  // If mundari_roman was provided, verify it is Roman and verified in DB
  if (mundariRoman) {
    if (!/^[A-Za-z\s.,!?'-]+$/.test(mundariRoman)) {
      return res.status(400).json({
        success: false,
        available: false,
        status: 'invalid_input',
        message: 'mundari_roman must be in Roman script.',
      });
    }

    try {
      const verified = await query(
        `SELECT EXISTS (
           SELECT 1 FROM vocabulary WHERE mundari_roman = $1
           UNION ALL SELECT 1 FROM classroom_phrases WHERE mundari_roman = $1
           UNION ALL SELECT 1 FROM number_vocabulary WHERE mundari_roman = $1
           UNION ALL SELECT 1 FROM lesson_activities WHERE mundari_guide = $1
           UNION ALL SELECT 1 FROM lesson_assessments WHERE mundari_question = $1
           UNION ALL SELECT 1 FROM translations WHERE mundari_text = $1 AND status IN ('teacher_reviewed', 'native_reviewed', 'approved', 'published')
           UNION ALL SELECT 1 FROM lessons WHERE learning_outcome_mundari = $1 AND status IN ('approved', 'published')
         ) AS found`,
        [mundariRoman]
      );
      if (!verified.rows[0]?.found) {
        return res.status(422).json({
          success: false,
          available: false,
          status: 'invalid_input',
          reason: 'verified_translation_not_found',
          message: 'Verified Mundari Roman translation not found.',
        });
      }
    } catch {
      return res.status(503).json({
        success: false,
        available: false,
        status: 'synthesis_failed',
        reason: 'verification_unavailable',
        message: 'Unable to verify the Mundari text for TTS.',
      });
    }

    // Auto-prepare ttsInput if not supplied
    if (!ttsInput || ttsInputScript !== 'Odia') {
      try {
        const prepared = await prepareMundariTtsInputs([{ id: 'request', mundariRoman }]);
        const verifiedInput = prepared.find((item) => item.id === 'request');
        if (verifiedInput?.tts_input && verifiedInput.tts_input_script === 'Odia') {
          ttsInput = verifiedInput.tts_input;
          ttsInputScript = 'Odia';
        } else {
          return res.status(422).json({
            success: false,
            available: false,
            status: 'invalid_input',
            reason: 'tts_input_conversion_failed',
            message: 'Unable to convert Mundari Roman to model Odia script.',
          });
        }
      } catch {
        return res.status(503).json({
          success: false,
          available: false,
          status: 'model_load_failed',
          reason: 'tts_input_preparation_unavailable',
          message: 'Unable to prepare model-compatible Mundari TTS input.',
        });
      }
    } else {
      // Validate that provided ttsInput matches the transliteration
      try {
        const prepared = await prepareMundariTtsInputs([{ id: 'request', mundariRoman }]);
        const verifiedInput = prepared.find((item) => item.id === 'request');
        if (verifiedInput?.tts_input && verifiedInput.tts_input !== ttsInput) {
          return res.status(422).json({
            success: false,
            available: false,
            status: 'invalid_input',
            reason: 'tts_input_mismatch',
            message: 'TTS input does not match the verified Mundari Roman text.',
          });
        }
      } catch {
        // non-blocking
      }
    }
  }

  // Ensure ttsInput is present and script is Odia
  if (!ttsInput || ttsInput.length > 2000 || ttsInputScript !== 'Odia') {
    return res.status(400).json({
      success: false,
      available: false,
      status: 'invalid_input',
      mode: 'unavailable',
      language: 'mundari',
      message: 'Odia model-compatible tts_input of at most 2000 characters is required.',
    });
  }

  const result = await synthesize({ ttsInput, ttsInputScript, language: 'mundari' });
  const statusCode = result.statusCode || (result.success ? 200 : 503);
  return res.status(statusCode).json(result);
});

module.exports = router;
