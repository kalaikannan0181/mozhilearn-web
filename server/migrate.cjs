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

function redactSensitiveText(value) {
  if (value === null || value === undefined) return null;
  return String(value)
    .replace(/(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?):\/\/[^\s"'<>]+/gi, '[REDACTED_DATABASE_URL]')
    .replace(/\b(password|token|secret|api[_-]?key)\s*[:=]\s*[^\s,;]+/gi, '$1=[REDACTED]');
}

function logMigrationError(error, migration) {
  console.error(JSON.stringify({
    event: 'migration_error',
    migration,
    name: error?.name || 'Error',
    code: error?.code || null,
    message: redactSensitiveText(error?.message || String(error)),
    detail: redactSensitiveText(error?.detail),
    hint: redactSensitiveText(error?.hint),
    position: redactSensitiveText(error?.position),
  }));
}

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
  let migration = null;
  try {
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
      migration = fileName;
      const sql = fs.readFileSync(path.join(migrationsDirectory, fileName), 'utf8');
      const rawChecksum = crypto.createHash('sha256').update(sql, 'utf8').digest('hex');
      const canonicalSql = sql.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
      const canonicalChecksum = crypto.createHash('sha256').update(canonicalSql, 'utf8').digest('hex');
      const legacyCrlfChecksum = crypto
        .createHash('sha256')
        .update(canonicalSql.replace(/\n/g, '\r\n'), 'utf8')
        .digest('hex');
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const existing = await client.query('SELECT checksum FROM schema_migrations WHERE name = $1', [fileName]);
        if (existing.rows[0]) {
          if (
            existing.rows[0].checksum !== rawChecksum &&
            existing.rows[0].checksum !== canonicalChecksum &&
            existing.rows[0].checksum !== legacyCrlfChecksum
          ) {
            throw new Error(`Applied migration checksum changed: ${fileName}`);
          }
          await client.query('COMMIT');
          continue;
        }

        await client.query(canonicalSql);
        await client.query(
          'INSERT INTO schema_migrations (name, checksum) VALUES ($1, $2)',
          [fileName, canonicalChecksum],
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

    migration = null;
    await verifyPreservedCounts(existingCounts);
    console.log('Existing application table row counts preserved.');
  } catch (error) {
    logMigrationError(error, migration);
    throw error;
  }
}

module.exports = { runMigration };

if (require.main === module) {
  runMigration()
    .catch((error) => {
      console.error('Database migration failed.');
      process.exitCode = 1;
    })
    .finally(() => pool.end());
}

