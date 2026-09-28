# API

Private endpoints use the server-issued `mozhi_session` HttpOnly cookie. Health and authentication endpoints are public.

## Public

- `GET /api/health` - server health with `ok`, service name, and package version.
- `GET /api/test-db` - PostgreSQL connectivity.
- `GET /api/auth/csrf` - issue the CSRF cookie/token pair required for state-changing requests.
- `POST /api/auth/register` - create a teacher account. Body: `name`, `email`, `password`.
- `POST /api/auth/login` - sign in. Body: `email`, `password`.
- `POST /api/auth/logout` - revoke the current session.
- `GET /api/auth/me` - return the current user without password data.

## Lessons and classroom content

- `GET|POST /api/lessons`
- `GET|PUT|DELETE /api/lessons/:id`
- `GET|POST /api/lessons/:id/activities`
- `PUT|DELETE /api/activities/:id`
- `GET|POST /api/lessons/:id/assessments`
- `PUT|DELETE /api/assessments/:id`

## Translation

- `GET /api/lessons/:id/translations`
- `GET /api/translations`; `GET /api/translations/:id`
- `POST /api/translations`
- `PUT /api/translations/:id`
- `PUT /api/translations/:id/review`
- `GET /api/review/queue` - reviewer/admin only; optional `status` filter.
- `POST /api/ai/translate` - calls the configured server-side AI provider and stores `ai_generated` drafts.

## Libraries

- `GET|POST /api/vocabulary`; `GET|PUT|DELETE /api/vocabulary/:id`
- `GET|POST /api/classroom-phrases`; `GET|PUT|DELETE /api/classroom-phrases/:id`
- `GET|POST /api/textbook-terms`; `GET|PUT|DELETE /api/textbook-terms/:id`
- `GET|POST /api/number-vocabulary`; `GET|PUT /api/number-vocabulary/:id`

## Generated content

- `POST /api/materials/worksheet/generate`; `GET /api/materials/worksheets`; `GET /api/materials/worksheet/:id`; `PUT /api/materials/worksheet/:id`.
- `POST /api/materials/worksheet/:id/approve`; `POST /api/materials/worksheet/:id/publish`; `GET /api/materials/worksheet/:id/pdf`.
- `POST /api/materials/flashcards/generate`; `GET /api/materials/flashcards`; `GET /api/materials/flashcards/:id`; `PUT /api/materials/flashcards/:id`.
- `POST /api/materials/flashcards/:id/approve`; `POST /api/materials/flashcards/:id/publish`; `GET /api/materials/flashcards/:id/pdf`.
- Generated content is grounded in verified database values and remains unpublished until review.

## AI, ASR, and TTS

- `POST /api/ai/class1-lookup` - exact verified lookup; unknown text returns HTTP 422 with `code: verified_translation_not_found`.
- `POST /api/ai/translate` - authenticated, rate-limited AI draft generation.
- `POST /api/ai/transcribe-audio` - authenticated Hindi ASR.
- `GET /api/tts/status`; `POST /api/tts/speak` - authenticated Mundari TTS. Roman text is converted to model-native Odia input; missing weights return HTTP 503.

## Packs and sync

- `GET /api/packs` or `GET /api/offline-packs`
- `GET /api/packs/:id` or `GET /api/offline-packs/:id`
- `POST /api/offline-packs` creates a scoped draft pack.
- `GET /api/offline-packs/:id/content` returns published pack content.
- `PUT /api/packs/:id`
- `POST /api/packs/:id/publish`
- `POST /api/packs/:id/archive`
- `GET /api/sync/version`
- `GET /api/sync`
- `GET /api/sync/packs/:id`
- `GET /api/sync/changes?since=<ISO timestamp>`
- `GET /api/sync/pull`; `POST /api/sync/push`

Published packs only contain approved/published lessons and approved translations.

## Metrics

- `GET /api/dashboard/summary` returns real lesson, translation, and published-pack counts.
