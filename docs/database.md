# Database

The application uses PostgreSQL through the server-only `pg` pool. The browser never receives `DATABASE_URL`.

Existing educational tables are preserved:

- `lessons`
- `lesson_activities`
- `lesson_assessments`
- `vocabulary`
- `classroom_phrases`
- `textbook_terms`
- `number_vocabulary`

Application tables added by migrations:

- `translations`
- `offline_packs`
- `offline_pack_lessons`
- `users`
- `sessions`
- `audit_logs`

Run additive migrations with:

```powershell
npm run db:migrate
```

Migrations do not drop or reset existing tables. Real Lesson 1 content is preserved.
