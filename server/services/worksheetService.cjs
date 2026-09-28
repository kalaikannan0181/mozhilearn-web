const PDFDocument = require('pdfkit');
const { query } = require('../db.cjs');

async function getLessonWorksheetData(lessonId) {
  const lessonResult = await query('SELECT id, title, grade, subject, topic, learning_outcome_hindi, learning_outcome_mundari FROM lessons WHERE id = $1', [lessonId]);
  if (!lessonResult.rows[0]) return null;
  const [activities, assessments, vocabulary] = await Promise.all([
    query('SELECT activity_name, hindi_guide, mundari_guide FROM lesson_activities WHERE lesson_id = $1 ORDER BY id', [lessonId]),
    query('SELECT question_no, hindi_question, mundari_question, expected_answer FROM lesson_assessments WHERE lesson_id = $1 ORDER BY question_no, id', [lessonId]),
    query('SELECT english, hindi, mundari_roman FROM vocabulary ORDER BY id LIMIT 20'),
  ]);
  return { ...lessonResult.rows[0], activities: activities.rows, assessments: assessments.rows, vocabulary: vocabulary.rows };
}

function writeWorksheet(doc, data) {
  doc.fontSize(18).text(data.title);
  doc.moveDown(0.5).fontSize(10).text(`Grade ${data.grade} | ${data.subject} | ${data.topic || ''}`);
  doc.moveDown().fontSize(12).text('Learning outcome / सीखने का परिणाम');
  doc.fontSize(10).text(data.learning_outcome_hindi || 'Not recorded');
  doc.text(data.learning_outcome_mundari || 'Mundari outcome not recorded');
  doc.moveDown().fontSize(12).text('Vocabulary / शब्दावली');
  data.vocabulary.forEach((item) => doc.fontSize(10).text(`${item.hindi || ''} — ${item.mundari_roman || ''}`));
  doc.moveDown().fontSize(12).text('Activities / गतिविधियाँ');
  data.activities.forEach((item, index) => doc.fontSize(10).text(`${index + 1}. ${item.activity_name}\n${item.hindi_guide || ''}\n${item.mundari_guide || ''}`));
  doc.moveDown().fontSize(12).text('Questions / प्रश्न');
  data.assessments.forEach((item) => doc.fontSize(10).text(`${item.question_no}. ${item.hindi_question}\n${item.mundari_question || ''}\nAnswer: ____________________`));
}

function createWorksheetPdf(data) {
  const doc = new PDFDocument({ margin: 50 });
  writeWorksheet(doc, data);
  doc.end();
  return doc;
}

module.exports = { createWorksheetPdf, getLessonWorksheetData };
