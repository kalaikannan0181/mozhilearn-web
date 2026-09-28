# API

Private endpoints use the server-issued `mozhi_session` HttpOnly cookie. Health and authentication endpoints are public.

## Public

- `GET /api/health` - server health.
- `GET /api/test-db` - PostgreSQL connectivity.
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
- `POST /api/translations`
- `PUT /api/translations/:id`
- `PUT /api/translations/:id/review`
- `GET /api/review/queue` - reviewer/admin only; optional `status` filter.
- `POST /api/ai/translate` - calls the configured server-side AI provider and stores `ai_generated` drafts.

## Libraries

- `GET|POST /api/vocabulary`; `PUT|DELETE /api/vocabulary/:id`
- `GET|POST /api/classroom-phrases`; `PUT|DELETE /api/classroom-phrases/:id`
- `GET|POST /api/textbook-terms`; `PUT|DELETE /api/textbook-terms/:id`
- `GET /api/number-vocabulary`

## Generated content

- `POST /api/worksheets/generate` with `{ "lesson_id": 1 }` returns a deterministic bilingual PDF.
- `GET /api/flashcards` returns vocabulary-backed cards.
- `GET /api/flashcards.pdf` returns a printable PDF.

## Packs and sync

- `GET|POST /api/packs`
- `GET /api/packs/:id`
- `PUT /api/packs/:id`
- `POST /api/packs/:id/publish`
- `POST /api/packs/:id/archive`
- `GET /api/sync/version`
- `GET /api/sync`
- `GET /api/sync/packs/:id`

Published packs only contain approved/published lessons and approved translations.

## Metrics

- `GET /api/dashboard/summary` returns real lesson, translation, and published-pack counts.
