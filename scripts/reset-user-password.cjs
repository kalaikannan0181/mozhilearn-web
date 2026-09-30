const readline = require('node:readline/promises');
const bcrypt = require('bcryptjs');
const { pool } = require('../server/db.cjs');

function askSecret(prompt) {
  const input = process.stdin;
  if (!input.isTTY || typeof input.setRawMode !== 'function') {
    return Promise.reject(new Error('Run this command in an interactive terminal.'));
  }

  return new Promise((resolve, reject) => {
    let value = '';
    let settled = false;
    const finish = (error) => {
      if (settled) return;
      settled = true;
      input.removeListener('data', onData);
      input.setRawMode(false);
      input.pause();
      process.stdout.write('\n');
      if (error) reject(error);
      else resolve(value);
    };
    const onData = (chunk) => {
      for (const character of chunk.toString('utf8')) {
        if (character === '\u0003') return finish(new Error('Cancelled.'));
        if (character === '\r' || character === '\n') return finish();
        if (character === '\u007f' || character === '\b') {
          value = Array.from(value).slice(0, -1).join('');
        } else if (character >= ' ') {
          value += character;
        }
      }
    };

    process.stdout.write(prompt);
    input.setRawMode(true);
    input.resume();
    input.on('data', onData);
  });
}

async function main() {
  const targetEmail = String(process.argv[2] || '').trim().toLowerCase();
  if (!targetEmail || targetEmail.length > 320 || !targetEmail.includes('@')) {
    throw new Error('Usage: node scripts/reset-user-password.cjs <account-email>');
  }

  const confirmation = readline.createInterface({ input: process.stdin, output: process.stdout });
  let confirmedEmail;
  try {
    confirmedEmail = (await confirmation.question(`Type ${targetEmail} to confirm the target account: `)).trim().toLowerCase();
  } finally {
    confirmation.close();
  }
  if (confirmedEmail !== targetEmail) throw new Error('Email confirmation did not match; no changes were made.');

  const password = await askSecret('New password (8-128 characters, input hidden): ');
  const passwordConfirmation = await askSecret('Re-enter new password (input hidden): ');
  if (password.length < 8 || password.length > 128) throw new Error('Password must be between 8 and 128 characters.');
  if (password !== passwordConfirmation) throw new Error('Password entries did not match; no changes were made.');

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const user = await client.query('SELECT id FROM users WHERE email = $1 FOR UPDATE', [targetEmail]);
    if (!user.rows[0]) throw new Error('No user exists for the confirmed email; no changes were made.');

    const passwordHash = await bcrypt.hash(password, 12);
    const updated = await client.query(
      'UPDATE users SET password_hash = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
      [passwordHash, user.rows[0].id]
    );
    if (updated.rowCount !== 1) throw new Error('Exactly one user must match; no changes were made.');
    await client.query('DELETE FROM sessions WHERE user_id = $1', [user.rows[0].id]);
    await client.query('DELETE FROM password_reset_tokens WHERE user_id = $1', [user.rows[0].id]);
    await client.query('COMMIT');
    console.log('Password updated for the confirmed account. Existing sessions were revoked.');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

main()
  .catch((error) => {
    console.error(error.message || 'Password reset failed.');
    process.exitCode = 1;
  })
  .finally(() => pool.end());