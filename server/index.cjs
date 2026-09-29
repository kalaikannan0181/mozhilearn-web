const express = require('express');
const cors = require('cors');
const path = require('path');
const packageMetadata = require('../package.json');

require('dotenv').config({
  path: path.join(__dirname, '..', '.env.local'),
});

require('dotenv').config({
  path: path.join(__dirname, '..', '.env'),
});

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
const { runMigration } = require('./migrate.cjs');

const app = express();

if (process.env.NODE_ENV === 'production') {
  app.set('trust proxy', 1);
}

const PORT = process.env.PORT || 5000;
const isProduction = process.env.NODE_ENV === 'production';

/*
 * Production environment validation
 */
if (isProduction) {
  const requiredEnvironment = [
    'DATABASE_URL',
    'SESSION_SECRET',
    'CORS_ORIGIN',
  ];

  const missingEnvironment = requiredEnvironment.filter(
    (key) => !process.env[key]?.trim()
  );

  if (
    process.env.SESSION_SECRET &&
    process.env.SESSION_SECRET.length < 32
  ) {
    missingEnvironment.push(
      'SESSION_SECRET (minimum 32 characters)'
    );
  }

  if (missingEnvironment.length) {
    throw new Error(
      `Missing or invalid required production environment variables: ${missingEnvironment.join(
        ', '
      )}`
    );
  }
}

/*
 * CORS configuration
 */
const configuredOrigins = (process.env.CORS_ORIGIN || '')
  .split(',')
  .map((origin) => origin.trim().replace(/\/+$/, ''))
  .filter(Boolean);

const defaultOrigins = [
  'https://mozhilearn-web.vercel.app',
  'https://mozhilearn-mjofrvbcq-kalaikannan.vercel.app',
  'https://mozilearn-mjofrvbcq-kalaikannan.vercel.app',
  'https://mozhilearn-web-2.onrender.com',
  'https://mozilearn-web-2.onrender.com',
];

const allowedOriginsSet = new Set([
  ...defaultOrigins,
  ...configuredOrigins,
  ...(!isProduction
    ? [
        'http://localhost:8443',
        'http://127.0.0.1:8443',
      ]
    : []),
]);

const allowedOrigins = {
  has(origin) {
    if (!origin) return false;

    const clean = origin.trim().replace(/\/+$/, '');

    if (allowedOriginsSet.has(clean)) {
      return true;
    }

    if (
      /^https:\/\/(?:mozhilearn|mozilearn)[a-z0-9-]*\.vercel\.app$/i.test(
        clean
      )
    ) {
      return true;
    }

    if (
      /^https:\/\/(?:mozhilearn|mozilearn)[a-z0-9-]*\.onrender\.com$/i.test(
        clean
      )
    ) {
      return true;
    }

    return false;
  },
};

app.use(
  cors({
    origin(origin, callback) {
      callback(null, !origin || allowedOrigins.has(origin));
    },
    credentials: true,
  })
);

app.use(express.json({ limit: '1mb' }));

app.use(addErrorContract);

app.use(attachAuth);

app.use(csrfProtection(allowedOrigins));

/*
 * Root health endpoint
 */
app.get('/', (_req, res) => {
  res.status(200).json({
    ok: true,
    service: 'MozhiLearn API',
    message: 'Backend is running',
    environment: process.env.NODE_ENV || 'development',
    version: packageMetadata.version,
  });
});

/*
 * API health endpoint
 */
app.get('/api/health', (_req, res) => {
  res.status(200).json({
    ok: true,
    service: 'mozilearn-api',
    status: 'running',
    version: packageMetadata.version,
  });
});

/*
 * Authentication
 */
app.use(authRoutes);

/*
 * Health
 */
app.use(healthRoutes);

/*
 * AI
 */
app.use('/api/ai', requireAuth, aiRoutes);

/*
 * TTS
 */
app.use('/api/tts', requireAuth, ttsRoutes);

/*
 * Lessons
 */
app.use('/api/lessons', requireAuth);
app.use(lessonsRoutes);

/*
 * Activities
 */
app.use('/api/activities', requireAuth);
app.use(activityRoutes);

/*
 * Assessments
 */
app.use('/api/assessments', requireAuth);
app.use(assessmentRoutes);

/*
 * Vocabulary
 */
app.use('/api/vocabulary', requireAuth);

/*
 * Classroom phrases
 */
app.use('/api/classroom-phrases', requireAuth);

/*
 * Textbook terms
 */
app.use('/api/textbook-terms', requireAuth);

/*
 * Number vocabulary
 */
app.use('/api/number-vocabulary', requireAuth);

/*
 * Dashboard
 */
app.use('/api/dashboard', requireAuth);

/*
 * Packs
 */
app.use('/api/packs', requireAuth);

/*
 * Worksheets
 */
app.use('/api/worksheets', requireAuth);

/*
 * Flashcards
 */
app.use('/api/flashcards', requireAuth);

/*
 * Admin
 */
app.use('/api/admin', requireAuth);

/*
 * Libraries
 */
app.use(libraryRoutes);

/*
 * Dashboard routes
 */
app.use(dashboardRoutes);

/*
 * Pack routes
 */
app.use(packRoutes);

/*
 * Worksheet routes
 */
app.use(worksheetRoutes);

/*
 * Flashcard routes
 */
app.use(flashcardRoutes);

/*
 * Admin routes
 */
app.use(adminRoutes);

/*
 * Translations
 */
app.use('/api/translations', requireAuth);
app.use(translationRoutes);

/*
 * Sync
 */
app.use('/api/sync', requireAuth);
app.use(syncRoutes);

/*
 * Materials
 */
app.use('/api/materials', requireAuth);
app.use(materialsRoutes);

/*
 * Unknown API endpoint
 */
app.use('/api', (req, res) => {
  return res.status(404).json({
    success: false,
    message: 'API endpoint not found',
  });
});

/*
 * Global error handler
 */
app.use((err, req, res, next) => {
  logError('Unhandled server error:', err);

  if (res.headersSent) {
    return next(err);
  }

  const status =
    Number.isInteger(err.status) &&
    err.status >= 400 &&
    err.status < 600
      ? err.status
      : 500;

  return res.status(status).json({
    success: false,
    message: isProduction
      ? 'Internal server error'
      : err.message || 'Internal server error',
  });
});

/*
 * Vercel
 *
 * When deployed on Vercel, export the Express application.
 * Vercel will handle the HTTP server.
 */
if (process.env.VERCEL) {
  module.exports = app;
} else {
  /*
   * Local / normal Node server
   */
  const server = app.listen(PORT, '0.0.0.0', async () => {
    console.log(`Express server listening on port ${PORT}`);

    try {
      await runMigration();
      console.log('Database migrations verified and up to date.');
    } catch (err) {
      logError('Database migration startup error:', err);
    }

    initializeAsr();
  });

  /*
   * Graceful shutdown
   */
  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.once(signal, () => {
      shutdownAsr();

      server.close(() => {
        process.exit(0);
      });
    });
  }
}