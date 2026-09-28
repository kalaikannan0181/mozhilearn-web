# MozhiLearn / PALASH AI Classroom

MozhiLearn is a Vite + React teacher web application backed by Express and PostgreSQL. It prepares Hindi and Mundari lesson content for a future Android client. Android, Room, offline AI, and APK code are intentionally outside this repository's current scope.

## Architecture
React + Vite (8443) -> Express (5000) -> PostgreSQL
                              |
                              +-> server-side AI translation provider
## Setup

Install dependencies and start both the API and web app:

```powershell
pnpm install
pnpm dev:all
```


Open `http://localhost:8443`.

## Production Deployment

The production architecture is Vercel (Vite frontend) -> Render (Express API) -> Render PostgreSQL. `render.yaml` configures only the web service; it does not create, reset, or migrate a database.

On Render, create the web service from this repository using the included blueprint. Set `DATABASE_URL` to the existing Render PostgreSQL internal connection URL and `CORS_ORIGIN` to the exact Vercel frontend origin, with no trailing slash. Set `AI_API_KEY` only if AI translation is enabled. Gemini is the default provider, using Google's OpenAI-compatible chat-completions endpoint and `gemini-3.8-flash`; `AI_API_URL` and `AI_MODEL` can override these defaults. The blueprint creates a Python environment for Hindi audio transcription; the Whisper `small` model is downloaded on first use, so the service needs outbound network access and enough disk space for its model cache. `NODE_ENV=production` is set by the blueprint. Do not run migrations as part of deploy; the existing migration files are additive and should only be applied deliberately.

On Vercel, use the Vite framework preset and set `VITE_API_URL` to the Render service origin, for example `https://<render-service>.onrender.com`, without `/api`. No `vercel.json` is needed for the Vite build. The Vite `/api` proxy is local-development-only; leave `VITE_API_URL` unset locally to use it, or set `VITE_API_URL=http://localhost:5000` to call Express directly.

The current database-backed session implementation creates cryptographically random tokens and stores only their SHA-256 hashes, so `SESSION_SECRET` is a reserved placeholder and is not required by the server. Session cookies are `HttpOnly`; production uses `SameSite=None; Secure` for the cross-site Vercel-to-Render request.

Vercel Deployment Protection must be configured manually in the Vercel dashboard.

## Implemented API areas

Public health:

- `GET /api/health`
- `GET /api/test-db`

Authentication:

- `POST /api/auth/register`
Lessons and content:

- `GET|POST /api/lessons`
- `GET|PUT|DELETE /api/lessons/:id`
- `GET|POST /api/lessons/:id/activities`
- `PUT|DELETE /api/activities/:id`
- `GET|POST /api/lessons/:id/assessments`
- `PUT|DELETE /api/assessments/:id`
- `GET /api/lessons/:id/translations`
- `POST /api/translations`

## Data import

Use the empty `data/raw`, `data/cleaned`, `data/validated`, and `data/imports` folders for collected material. Preview a CSV without writing:

```powershell
npm run import:csv -- data/raw/vocabulary.csv --type vocabulary --dry-run
```

Import validated JSON transactionally:

```powershell
npm run import:json -- data/validated/lessons.json --type lessons
```

## Generated content

Worksheets are deterministic PDFs built from PostgreSQL lesson, activity, assessment, and vocabulary data. Flashcards are built from PostgreSQL vocabulary. Neither claims AI generation.
- `GET /api/review/translations` for reviewer/admin roles
- `POST /api/ai/translate`
- `POST /api/ai/translate-audio` (WAV, MP3, M4A, FLAC, OGG, or WebM; 30 MB maximum)

Content libraries:

- `GET|POST /api/vocabulary`
- `PUT|DELETE /api/vocabulary/:id`
- `GET|POST /api/classroom-phrases`
- `PUT|DELETE /api/classroom-phrases/:id`
- `GET|POST /api/textbook-terms`
- `PUT|DELETE /api/textbook-terms/:id`
- `GET /api/number-vocabulary`

Offline pack and sync foundation:

- `POST /api/sync/packs`
- `GET /api/sync/packs/:id`
- `GET /api/sync/version`
- `GET /api/sync`

Private APIs require the server-issued HttpOnly session cookie.

## Translation workflow

The uploaded translation module at `tts-main/tts-main/hindi_to_mundari/translator.py` is consulted first through `server/services/uploadedTranslationService.cjs`. Its legacy `mundari_roman` column is preserved as source translation text when it contains Devanagari; it is exposed as Roman only when a verified source row actually contains Latin text. The voice translator records or uploads Hindi audio to `POST /api/ai/translate-audio`; the response keeps `mundari_translation`, `mundari_roman`, and `tts_input` separate. The Class 1 content adapter retains each supplied Roman string for display and converts that supplied Latin text separately to Odia-script `tts_input` using `indic-transliteration` IAST→Oriya, then validates every output character against the MMS tokenizer vocabulary. Devanagari source text uses Devanagari→Odia conversion. This script conversion is not a claim that the TTS pronunciation is linguistically validated. Mundari TTS remains unavailable until checkpoint weights and a TTS service are supplied. Set `TRANSLATION_MODULE_ROOT` or `TRANSLATION_MODULE_PYTHON` only when deploying the module outside its workspace location.

```text
draft -> ai_generated -> teacher_reviewed -> native_reviewed -> approved
```

AI output is always stored as `source = ai` and `status = ai_generated`. The UI labels it `AI-generated draft — review required`; approval is never automatic.

## Migrations

- `001_create_translations.sql`
- `002_allow_unattached_translations.sql`
- `003_create_offline_packs.sql`
- `004_create_auth.sql`

Migrations are additive and do not drop existing tables or lesson data.

## Verification

```powershell
npm run build
npx tsc --noEmit
```

The real seeded Lesson 1 can be viewed at `/lessons/1` after signing in. The future Android client will consume published pack data from `/api/sync`; Android/Room synchronization is not implemented here.
