const express = require('express');
const path = require('path');
const { getAudioStatus, synthesize, AUDIO_ROOT } = require('../services/ttsService.cjs');
const { createRateLimiter } = require('../middleware/rateLimit.cjs');

const router = express.Router();
const speakLimit = createRateLimiter({ windowMs: 60 * 1000, max: 20, message: 'Too many TTS requests. Try again later.' });

router.get('/status', (_req, res) => {
  const language = (_req.query.language || 'mundari').toString();
  return res.status(200).json(getAudioStatus({ language }));
});

router.get('/audio/*asset', (req, res) => {
  const rawAsset = Array.isArray(req.params.asset) ? req.params.asset.join('/') : req.params.asset;
  const asset = (rawAsset || '').replace(/\.\./g, '').replace(/\\/g, '/');
  const safeAsset = asset.replace(/^\/+/, '');
  const requestedPath = path.join(AUDIO_ROOT, safeAsset);

  if (!requestedPath.startsWith(AUDIO_ROOT) || !requestedPath.includes(AUDIO_ROOT)) {
    return res.status(400).json({ success: false, message: 'Invalid audio path.' });
  }

  if (!require('fs').existsSync(requestedPath)) {
    return res.status(404).json({ success: false, message: 'Audio file not found.' });
  }

  return res.sendFile(requestedPath);
});

router.post('/speak', speakLimit, async (req, res) => {
  const { tts_input: ttsInput, language, audioUrl, voice } = req.body || {};

  if (typeof ttsInput !== 'string' || !ttsInput.trim() || ttsInput.length > 2000 || (language !== undefined && language !== 'mundari')) {
    return res.status(400).json({
      success: false,
      mode: 'unavailable',
      language: 'mundari',
      message: 'Mundari model-compatible tts_input of at most 2000 characters is required.',
    });
  }

  const result = await synthesize({ ttsInput, language, audioUrl, voice });
  return res.status(result.success ? 200 : 200).json(result);
});

module.exports = router;
