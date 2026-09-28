const express = require('express');
const path = require('path');
const fs = require('fs');
const { query } = require('../db.cjs');
const { getAudioStatus, synthesize, AUDIO_ROOT } = require('../services/ttsService.cjs');
const { createRateLimiter } = require('../middleware/rateLimit.cjs');

const router = express.Router();
const speakLimit = createRateLimiter({ windowMs: 60 * 1000, max: 20, message: 'Too many TTS requests. Try again later.' });

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
  const { tts_input: ttsInput, tts_input_script: ttsInputScript, mundari_roman: mundariRoman, language } = req.body || {};

  if (
    typeof ttsInput !== 'string' || !ttsInput.trim() || ttsInput.length > 2000 ||
    ttsInputScript !== 'Odia' || typeof mundariRoman !== 'string' || !mundariRoman.trim() ||
    !/^[A-Za-z\s.,!?'-]+$/.test(mundariRoman) || (language !== undefined && language !== 'mundari')
  ) {
    return res.status(400).json({
      success: false,
      status: 'invalid_input',
      mode: 'unavailable',
      language: 'mundari',
      message: 'Odia model-compatible tts_input of at most 2000 characters is required.',
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
      [mundariRoman.trim()],
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

  const result = await synthesize({ ttsInput, ttsInputScript, language });
  return res.status(result.statusCode || (result.success ? 200 : 503)).json(result);
});

module.exports = router;
