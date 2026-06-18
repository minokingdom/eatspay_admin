const fs = require('fs');

const { createPool } = require('../db/pool');
const { createRepository } = require('../db/repository');

function parseArgs(argv) {
  const args = {};
  for (const arg of argv) {
    const match = arg.match(/^--([^=]+)=(.*)$/);
    if (match) {
      args[match[1]] = match[2];
    }
  }
  return args;
}

function maskToken(token) {
  const value = String(token || '');
  if (value.length <= 16) return value ? `${value.slice(0, 4)}...` : '';
  return `${value.slice(0, 8)}...${value.slice(-6)}`;
}

function firebaseStatus() {
  const serviceAccountJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  const credentialsPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  const status = {
    configured: false,
    mode: 'none',
    detail: 'Firebase credentials are not configured.'
  };

  if (serviceAccountJson) {
    status.mode = 'FIREBASE_SERVICE_ACCOUNT_JSON';
    try {
      const parsed = JSON.parse(serviceAccountJson);
      status.configured = Boolean(parsed.project_id && parsed.client_email && parsed.private_key);
      status.detail = status.configured
        ? `Project ${parsed.project_id} is configured.`
        : 'Service account JSON is missing required fields.';
    } catch (err) {
      status.detail = `Service account JSON is invalid: ${err.message}`;
    }
    return status;
  }

  if (credentialsPath) {
    status.mode = 'GOOGLE_APPLICATION_CREDENTIALS';
    status.configured = fs.existsSync(credentialsPath);
    status.detail = status.configured
      ? `Credential file exists: ${credentialsPath}`
      : `Credential file does not exist: ${credentialsPath}`;
    return status;
  }

  return status;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const email = args.email || process.env.PUSH_STATUS_EMAIL;
  const userId = args.userId || process.env.PUSH_STATUS_USER_ID;
  const pool = createPool();
  const repo = createRepository(pool);

  try {
    const totals = await pool.query(
      `SELECT
         count(*)::int AS total,
         count(*) FILTER (WHERE enabled = true)::int AS enabled,
         count(*) FILTER (WHERE enabled = false)::int AS disabled,
         count(DISTINCT user_id)::int AS users
       FROM push_tokens`
    );

    const recent = await pool.query(
      `SELECT user_id, platform, enabled, token, updated_at
       FROM push_tokens
       ORDER BY updated_at DESC
       LIMIT 10`
    );

    let target = null;
    if (email || userId) {
      const user = email
        ? await repo.findUserByEmail(email)
        : await repo.findUserById(Number(userId));
      if (!user) {
        target = { found: false, email: email || null, userId: userId || null };
      } else {
        const tokens = await repo.listEnabledPushTokens(user.id);
        target = {
          found: true,
          userId: user.id,
          email: user.email,
          franchiseName: user.franchiseName,
          enabledTokens: tokens.length,
          platforms: [...new Set(tokens.map(row => row.platform || 'unknown'))]
        };
      }
    }

    console.log(JSON.stringify({
      firebase: firebaseStatus(),
      tokens: totals.rows[0],
      recentTokens: recent.rows.map(row => ({
        userId: row.user_id,
        platform: row.platform || 'unknown',
        enabled: row.enabled,
        token: maskToken(row.token),
        updatedAt: row.updated_at
      })),
      target
    }, null, 2));
  } finally {
    await pool.end();
  }
}

main().catch(err => {
  console.error(err.message);
  process.exit(1);
});
