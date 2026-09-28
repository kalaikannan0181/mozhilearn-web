const express = require('express');
const cors = require('cors');
const path = require('path');
const packageMetadata = require('../package.json');
require('dotenv').config({ path: path.join(__dirname, '..', '.env.local') });
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const healthRoutes = require('./routes/health.cjs');
const lessonsRoutes = require('./routes/lessons.cjs');
const translationRoutes = require('./routes/translations.cjs');
const aiRoutes = require('./routes/ai.cjs');
const ttsRoutes = require('./routes/tts.cjs');
const syncRoutes = require('./routes/sync.cjs');
const authRoutes = require('./routes/auth.cjs');
const activityRoutes = require('./routes/activities.cjs');
const assessmentRoutes = require('./routes/assessments.cjs');
const libraryRoutes = require('./routes/libraries.cjs');
const dashboardRoutes = require('./routes/dashboard.cjs');
const packRoutes = require('./routes/packs.cjs');
const worksheetRoutes = require('./routes/worksheets.cjs');
const flashcardRoutes = require('./routes/flashcards.cjs');
const materialsRoutes = require('./routes/materials.cjs');
const adminRoutes = require('./routes/admin.cjs');
const { attachAuth, requireAuth } = require('./middleware/auth.cjs');
const { csrfProtection } = require('./middleware/csrf.cjs');
const { addErrorContract } = require('./middleware/errorContract.cjs');
const { initializeAsr, shutdownAsr } = require('./services/asrService.cjs');
const { logError } = require('./lib/logger.cjs');

const app = express();
if (process.env.NODE_ENV === 'production') app.set('trust proxy', 1);
const PORT = process.env.PORT || 5000;
const isProduction = process.env.NODE_ENV === 'production';
if (isProduction) {
  const requiredEnvironment = ['DATABASE_URL', 'SESSION_SECRET', 'CORS_ORIGIN'];
  const missingEnvironment = requiredEnvironment.filter((key) => !process.env[key]?.trim());
  if (process.env.SESSION_SECRET && process.env.SESSION_SECRET.length < 32) {
    missingEnvironment.push('SESSION_SECRET (minimum 32 characters)');
  }
  if (missingEnvironment.length) {
    throw new Error(`Missing or invalid required production environment variables: ${missingEnvironment.join(', ')}`);
  }
}
const allowedOrigins = new Set([
  ...(process.env.CORS_ORIGIN || '').split(',').map((origin) => origin.trim()).filter(Boolean),
  ...(!isProduction ? ['http://localhost:8443', 'http://127.0.0.1:8443'] : []),
]);

app.use(cors({
  origin(origin, callback) {
    callback(null, !origin || allowedOrigins.has(origin));
  },
  credentials: true,
}));
app.use(express.json({ limit: '1mb' }));
app.use(addErrorContract);
app.use(attachAuth);
app.use(csrfProtection(allowedOrigins));

app.get('/', (_req, res) => {
  res.status(200).json({
    ok: true,
    service: 'MozhiLearn API',
    message: 'Backend is running',
    environment: process.env.NODE_ENV || 'development',
    version: packageMetadata.version,
  });
});

app.get('/api/health', (req, res) => {
  res.status(200).json({
    ok: true,
    service: 'mozilearn-api',
    status: 'running',
    version: packageMetadata.version,
  });
});

app.use(authRoutes);
app.use(healthRoutes);
app.use('/api/ai', requireAuth, aiRoutes);
app.use('/api/tts', requireAuth, ttsRoutes);
app.use('/api/lessons', requireAuth);
app.use(lessonsRoutes);
app.use('/api/activities', requireAuth);
app.use(activityRoutes);
app.use('/api/assessments', requireAuth);
app.use(assessmentRoutes);
app.use('/api/vocabulary', requireAuth);
app.use('/api/classroom-phrases', requireAuth);
app.use('/api/textbook-terms', requireAuth);
app.use('/api/number-vocabulary', requireAuth);
app.use('/api/dashboard', requireAuth);
app.use('/api/packs', requireAuth);
app.use('/api/worksheets', requireAuth);
app.use('/api/flashcards', requireAuth);
app.use('/api/admin', requireAuth);
app.use(libraryRoutes);
app.use(dashboardRoutes);
app.use(packRoutes);
app.use(worksheetRoutes);
app.use(flashcardRoutes);
app.use(adminRoutes);
app.use('/api/translations', requireAuth);
app.use(translationRoutes);
app.use('/api/sync', requireAuth);
app.use(syncRoutes);
app.use('/api/materials', requireAuth);
app.use(materialsRoutes);

app.use('/api', (req, res) => {
  return res.status(404).json({ success: false, message: 'API endpoint not found' });
});

app.use((err, req, res, next) => {
  logError('Unhandled server error:', err);
  if (res.headersSent) return next(err);
  const status = Number.isInteger(err.status) && err.status >= 400 && err.status < 600 ? err.status : 500;
  return res.status(status).json({
    success: false,
    message: isProduction ? 'Internal server error' : (err.message || 'Internal server error'),
  });
});

const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`Express server listening on port ${PORT}`);
  initializeAsr();
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, () => {
    shutdownAsr();
    server.close(() => process.exit(0));
  });
}
