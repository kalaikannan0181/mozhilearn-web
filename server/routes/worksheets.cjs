const express = require('express');
const { createWorksheetPdf, getLessonWorksheetData } = require('../services/worksheetService.cjs');
const { logError } = require('../lib/logger.cjs');

const router = express.Router();

router.post('/api/worksheets/generate', async (req, res) => {
  const lessonId = Number(req.body?.lesson_id);
  if (!Number.isInteger(lessonId) || lessonId <= 0) return res.status(400).json({ success: false, message: 'lesson_id must be a positive integer' });
  try {
    const data = await getLessonWorksheetData(lessonId);
    if (!data) return res.status(404).json({ success: false, message: 'Lesson not found' });
    res.status(200);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="lesson-${lessonId}-worksheet.pdf"`);
    return createWorksheetPdf(data).pipe(res);
  } catch (error) {
    logError('POST /api/worksheets/generate error:', error);
    return res.status(500).json({ success: false, message: 'Failed to generate worksheet' });
  }
});

module.exports = router;
