const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { pool } = require('./db.cjs');

const migrationsDirectory = path.join(__dirname, 'migrations');
const preservedTables = [
  'lessons',
  'lesson_activities',
  'lesson_assessments',
  'translations',
  'vocabulary',
  'classroom_phrases',
  'textbook_terms',
  'number_vocabulary',
  'users',
];

async function snapshotExistingCounts() {
  const counts = new Map();
  for (const table of preservedTables) {
    const exists = await pool.query(
      'SELECT 1 FROM information_schema.tables WHERE table_schema = ANY(current_schemas(false)) AND table_name = $1 LIMIT 1',
      [table],
    );
    if (!exists.rows[0]) continue;
    const result = await pool.query(`SELECT COUNT(*)::bigint AS count FROM "${table}"`);
    counts.set(table, result.rows[0].count);
  }
  return counts;
}

async function verifyPreservedCounts(before) {
  const differences = [];
  for (const [table, oldCount] of before) {
    const result = await pool.query(`SELECT COUNT(*)::bigint AS count FROM "${table}"`);
    if (result.rows[0].count !== oldCount) {
      differences.push(`${table}: ${oldCount} -> ${result.rows[0].count}`);
    }
  }
  if (differences.length) {
    throw new Error(`Migration changed existing data row counts: ${differences.join(', ')}`);
  }
}

async function runMigration() {
  const existingCounts = await snapshotExistingCounts();
  const migrationFiles = fs
    .readdirSync(migrationsDirectory)
    .filter((fileName) => fileName.endsWith('.sql'))
    .sort();

  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name TEXT PRIMARY KEY,
      checksum CHAR(64) NOT NULL,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);

  for (const fileName of migrationFiles) {
    const sql = fs.readFileSync(path.join(migrationsDirectory, fileName), 'utf8');
    const checksum = crypto.createHash('sha256').update(sql).digest('hex');
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const existing = await client.query('SELECT checksum FROM schema_migrations WHERE name = $1', [fileName]);
      if (existing.rows[0]) {
        if (existing.rows[0].checksum !== checksum) {
          throw new Error(`Applied migration checksum changed: ${fileName}`);
        }
        await client.query('COMMIT');
        continue;
      }

      await client.query(sql);
      await client.query(
        'INSERT INTO schema_migrations (name, checksum) VALUES ($1, $2)',
        [fileName, checksum],
      );
      await client.query('COMMIT');
      console.log('Database migration applied:', fileName);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  await verifyPreservedCounts(existingCounts);
  console.log('Existing application table row counts preserved.');
}

module.exports = { runMigration };

if (require.main === module) {
  runMigration()
    .catch((error) => {
      console.error('Database migration failed:', error.message);
      process.exitCode = 1;
    })
    .finally(() => pool.end());
}

