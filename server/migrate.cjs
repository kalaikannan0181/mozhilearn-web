const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { pool } = require('./db.cjs');

const migrationsDirectory = path.join(__dirname, 'migrations');

async function runMigration() {
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
}

runMigration()
  .catch((error) => {
    console.error('Database migration failed:', error.message);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
