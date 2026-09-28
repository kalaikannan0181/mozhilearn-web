# Data Import

Tomorrow's collection files belong under:

- `data/raw`
- `data/cleaned`
- `data/validated`
- `data/imports`

Supported types are `lessons`, `activities`, `assessments`, `vocabulary`, `classroom-phrases`, `textbook-terms`, `number-vocabulary`, and `translations`.

CSV preview:

```powershell
npm run import:csv -- data/raw/vocabulary.csv --type vocabulary --dry-run
```

JSON import:

```powershell
npm run import:json -- data/validated/lessons.json --type lessons
```

The importer validates required fields, rejects duplicate rows in the input, skips records already present by natural key, reports imported/skipped/error counts, and wraps non-dry-run inserts in a PostgreSQL transaction. A validation failure sets a non-zero exit code and never silently inserts invalid rows.

Imported content defaults to `validation_status = raw`. It is never automatically marked native-reviewed or approved. Provenance fields include `source`, `source_reference`, `reviewer_id`, and `reviewer_notes` where the target table supports them.
