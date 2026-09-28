const express = require('express');
const { query } = require('../db.cjs');
const { logError } = require('../lib/logger.cjs');
const PDFDocument = require('pdfkit');

const router = express.Router();

router.get('/api/flashcards', async (_req, res) => {
  try {
    const result = await query('SELECT id, english, hindi, mundari_roman, image_path FROM vocabulary ORDER BY id');
    return res.status(200).json({ success: true, data: result.rows });
  } catch (error) {
    logError('GET /api/flashcards error:', error);
    return res.status(500).json({ success: false, message: 'Failed to fetch flashcards' });
  }
});

router.get('/api/flashcards.pdf', async (_req, res) => {
  try {
    const result = await query('SELECT hindi, mundari_roman FROM vocabulary ORDER BY id');
    const doc = new PDFDocument({ margin: 40 });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename="mozhi-flashcards.pdf"');
    doc.pipe(res);
    doc.fontSize(18).text('MozhiLearn Flashcards');
    result.rows.forEach((card, index) => {
      doc.moveDown().fontSize(14).text(`${index + 1}. Front: ${card.hindi || ''}`);
      doc.fontSize(12).text(`Back: ${card.mundari_roman || ''}`);
      doc.moveDown().text('------------------------------');
    });
    doc.end();
  } catch (error) {
    logError('GET /api/flashcards.pdf error:', error);
    return res.status(500).json({ success: false, message: 'Failed to generate flashcards' });
  }
});

module.exports = router;
