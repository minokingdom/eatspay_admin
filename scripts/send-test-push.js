const { createPool } = require('../db/pool');
const { createRepository } = require('../db/repository');
const { sendNotificationPushToUser } = require('../push');

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

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const email = args.email || process.env.PUSH_TEST_EMAIL;
  const userId = args.userId || process.env.PUSH_TEST_USER_ID;
  const title = args.title || process.env.PUSH_TEST_TITLE || 'eats PAY 테스트 알림';
  const body = args.body || process.env.PUSH_TEST_BODY || '푸시알림 연결이 정상적으로 동작합니다.';

  if (!email && !userId) {
    throw new Error('Provide --email=USER_EMAIL or --userId=USER_ID.');
  }

  const pool = createPool();
  const repo = createRepository(pool);

  try {
    const user = email
      ? await repo.findUserByEmail(email)
      : await repo.findUserById(Number(userId));

    if (!user) {
      throw new Error('Target user was not found.');
    }

    const notification = {
      userId: user.id,
      type: 'PUSH_TEST',
      title,
      body,
      data: {
        test: true,
        userId: user.id,
        franchiseId: user.franchiseId || '',
        sentAt: new Date().toISOString()
      }
    };

    await repo.createNotification(notification);
    const result = await sendNotificationPushToUser(repo, user.id, notification);
    console.log(JSON.stringify({
      success: true,
      userId: user.id,
      email: user.email,
      push: result
    }, null, 2));
  } finally {
    await pool.end();
  }
}

main().catch(err => {
  console.error(err.message);
  process.exit(1);
});
