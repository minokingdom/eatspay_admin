function parseArgs(argv) {
  const args = {};
  for (const arg of argv) {
    const match = arg.match(/^--([^=]+)(?:=(.*))?$/);
    if (match) args[match[1]] = match[2] === undefined ? true : match[2];
  }
  return args;
}

function normalizeBaseUrl(value) {
  return String(value || 'https://www.eatspay.co.kr').replace(/\/$/, '');
}

async function readJson(response) {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch (err) {
    return { raw: text.slice(0, 300) };
  }
}

function printResult(name, ok, detail, next = '') {
  console.log(`[${ok ? 'OK' : 'FAIL'}] ${name}`);
  if (detail) console.log(`  ${detail}`);
  if (!ok && next) console.log(`  next: ${next}`);
}

async function getJson(url, headers = {}) {
  const response = await fetch(url, { headers, cache: 'no-store' });
  const json = await readJson(response);
  return { response, json };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const baseUrl = normalizeBaseUrl(args.baseUrl || process.env.PUSH_SMOKE_BASE_URL);
  const email = args.email || process.env.PUSH_SMOKE_EMAIL || '';
  const token = args.adminToken || process.env.ADMIN_ACCESS_TOKEN || process.env.PUSH_SMOKE_ADMIN_TOKEN || '';
  const sendTest = Boolean(args.sendTest || process.env.PUSH_SMOKE_SEND_TEST === 'true');
  const checks = [];

  const health = await getJson(`${baseUrl}/healthz`).catch(err => ({ error: err }));
  const healthOk = Boolean(health.response?.ok && health.json?.ok);
  checks.push(healthOk);
  printResult(
    'Production health endpoint',
    healthOk,
    health.error ? health.error.message : `${baseUrl}/healthz status=${health.response?.status || 'n/a'}`,
    'Check nginx, systemctl status eatspay, and DNS/HTTPS.'
  );

  const publicKey = await getJson(`${baseUrl}/api/web-push/public-key`).catch(err => ({ error: err }));
  const publicKeyConfigured = Boolean(publicKey.response?.ok && publicKey.json?.data?.configured && publicKey.json?.data?.publicKey);
  checks.push(publicKeyConfigured);
  printResult(
    'Web Push public key endpoint',
    publicKeyConfigured,
    publicKey.error
      ? publicKey.error.message
      : `configured=${Boolean(publicKey.json?.data?.configured)} status=${publicKey.response?.status || 'n/a'}`,
    'Run npm run push:vapid, copy WEB_PUSH_VAPID_* into /opt/eatspay/.env, then restart eatspay.'
  );

  if (token) {
    const query = email ? `?email=${encodeURIComponent(email)}` : '';
    const adminStatus = await getJson(`${baseUrl}/api/admin/push/status${query}`, {
      Authorization: `Bearer ${token}`
    }).catch(err => ({ error: err }));
    const adminOk = Boolean(adminStatus.response?.ok && adminStatus.json?.success);
    checks.push(adminOk);
    printResult(
      'Admin push diagnostics API',
      adminOk,
      adminStatus.error ? adminStatus.error.message : `status=${adminStatus.response?.status || 'n/a'}`,
      'Log in as admin, provide ADMIN_ACCESS_TOKEN/PUSH_SMOKE_ADMIN_TOKEN, and confirm the admin account has access.'
    );

    if (adminOk) {
      const data = adminStatus.json.data || {};
      printResult('Firebase runtime configured', Boolean(data.firebase?.configured), data.firebase?.detail || '-');
      printResult('Web Push runtime configured', Boolean(data.webPush?.configured), data.webPush?.detail || '-');
      if (data.target) {
        printResult(
          'Target account registration',
          Boolean((data.target.enabledTokens || 0) + (data.target.enabledWebSubscriptions || 0)),
          `appTokens=${data.target.enabledTokens || 0}, webSubscriptions=${data.target.enabledWebSubscriptions || 0}`,
          'Log in on the target phone/PWA and allow notifications.'
        );
      }
    }

    if (sendTest) {
      if (!email) {
        checks.push(false);
        printResult('Send test push', false, 'email is required for --sendTest.', 'Pass --email=USER_EMAIL.');
      } else {
        const response = await fetch(`${baseUrl}/api/admin/push/test`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            email,
            title: 'eats PAY 테스트 알림',
            body: '운영 푸시알림 스모크 테스트입니다.'
          })
        }).catch(err => ({ error: err }));
        if (response.error) {
          checks.push(false);
          printResult('Send test push', false, response.error.message);
        } else {
          const json = await readJson(response);
          const ok = Boolean(response.ok && json?.success);
          checks.push(ok);
          const push = json?.data?.push || {};
          printResult(
            'Send test push',
            ok,
            `status=${response.status}, fcm=${push.fcm?.sent || 0}/${push.fcm?.failed || 0}, web=${push.web?.sent || 0}/${push.web?.failed || 0}`,
            'Check Firebase/VAPID credentials and target device token/subscription.'
          );
        }
      }
    }
  } else {
    printResult(
      'Admin push diagnostics API',
      false,
      'Skipped because no admin token was provided.',
      'Set ADMIN_ACCESS_TOKEN or PUSH_SMOKE_ADMIN_TOKEN to check admin diagnostics and send test push.'
    );
  }

  const passed = checks.filter(Boolean).length;
  console.log('');
  console.log(`Push smoke: ${passed}/${checks.length} required checks passed.`);
  if (passed !== checks.length) process.exitCode = 1;
}

main().catch(err => {
  console.error(err.message);
  process.exit(1);
});
