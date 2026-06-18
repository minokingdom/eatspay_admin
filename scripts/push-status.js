const { createPool } = require('../db/pool');
const { createRepository } = require('../db/repository');
const { getPushRuntimeStatus } = require('../push');

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

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const email = args.email || process.env.PUSH_STATUS_EMAIL;
  const userId = args.userId || process.env.PUSH_STATUS_USER_ID;
  const pool = createPool();
  const repo = createRepository(pool);

  try {
    const totals = await repo.getPushTokenSummary();
    const recent = await repo.listRecentPushTokens(10);

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
      firebase: getPushRuntimeStatus(),
      tokens: totals,
      recentTokens: recent.map(row => ({
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
