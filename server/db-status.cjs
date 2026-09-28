const { pool } = require('./db.cjs');

const expectedTables = [
  'lessons',
  'lesson_activities',
  'lesson_assessments',
  'translations',
  'offline_packs',
  'users',
  'sessions',
  'audit_logs',
];

pool.query(
  `SELECT table_name
   FROM information_schema.tables
   WHERE table_schema = ANY(current_schemas(false))
     AND table_name = ANY($1::text[])
   ORDER BY table_name`,
  [expectedTables]
)
  .then((result) => {
    const existingTables = new Set(result.rows.map((row) => row.table_name));
    console.table(expectedTables.map((table_name) => ({ table_name, exists: existingTables.has(table_name) })));
    console.log('Migration application history is not recorded in this database.');
  })
  .catch((error) => { console.error('Database status failed:', error.message); process.exitCode = 1; })
  .finally(() => pool.end());
