const assert = require('node:assert/strict');
const test = require('node:test');

const push = require('../push');

test.afterEach(() => {
  push._resetFirebaseAdminForTest();
  delete process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  delete process.env.GOOGLE_APPLICATION_CREDENTIALS;
  delete process.env.WEB_PUSH_VAPID_PUBLIC_KEY;
  delete process.env.WEB_PUSH_VAPID_PRIVATE_KEY;
  delete process.env.WEB_PUSH_VAPID_SUBJECT;
});

test('sendPushToUser skips delivery when Firebase is not configured', async () => {
  const repo = {
    listEnabledPushTokens: async () => {
      throw new Error('push token lookup should not run');
    }
  };

  const result = await push.sendPushToUser(repo, 7, {
    title: '알림',
    body: '새 알림이 있습니다.',
    data: { requestId: 'REQ-1' }
  });

  assert.deepEqual(result, { enabled: false, sent: 0, failed: 0 });
});

test('getPushRuntimeStatus reports missing and malformed Firebase credentials', () => {
  assert.deepEqual(push.getPushRuntimeStatus(), {
    configured: false,
    mode: 'none',
    detail: 'Firebase credentials are not configured.'
  });

  process.env.FIREBASE_SERVICE_ACCOUNT_JSON = '{bad-json';
  const status = push.getPushRuntimeStatus();
  assert.equal(status.configured, false);
  assert.equal(status.mode, 'FIREBASE_SERVICE_ACCOUNT_JSON');
  assert.match(status.detail, /invalid/i);
});

test('sendPushToUser sends deduplicated tokens and disables invalid tokens', async () => {
  const sentMessages = [];
  const disabledTokens = [];
  push._setFirebaseAdminForTest({
    messaging() {
      return {
        async sendEachForMulticast(message) {
          sentMessages.push(message);
          return {
            successCount: 1,
            failureCount: 1,
            responses: [
              { success: true },
              {
                success: false,
                error: { code: 'messaging/registration-token-not-registered' }
              }
            ]
          };
        }
      };
    }
  });

  const repo = {
    async listEnabledPushTokens(userId) {
      assert.equal(userId, 11);
      return [
        { token: 'token-a', platform: 'android' },
        { token: 'token-a', platform: 'android' },
        { token: 'token-b', platform: 'ios' },
        { token: '', platform: 'android' }
      ];
    },
    async disablePushTokens(tokens) {
      disabledTokens.push(...tokens);
      return tokens.map(token => ({ token }));
    }
  };

  const result = await push.sendPushToUser(repo, 11, {
    title: '가상계좌가 승인되었습니다.',
    body: '생각대로 가상계좌가 승인되었습니다.',
    data: {
      requestId: 'REQ-1',
      action: 'APPROVED',
      assignedVirtualAccount: { bank: '농협은행' }
    }
  });

  assert.equal(sentMessages.length, 1);
  assert.deepEqual(sentMessages[0].tokens, ['token-a', 'token-b']);
  assert.equal(sentMessages[0].notification.title, '가상계좌가 승인되었습니다.');
  assert.equal(sentMessages[0].android.notification.channelId, 'eatspay_default');
  assert.equal(sentMessages[0].apns.payload.aps.sound, 'default');
  assert.equal(sentMessages[0].data.assignedVirtualAccount, '{"bank":"농협은행"}');
  assert.deepEqual(disabledTokens, ['token-b']);
  assert.deepEqual(result, {
    enabled: true,
    sent: 1,
    failed: 1,
    invalidTokens: 1
  });
});

test('sendWebPushToUser sends subscriptions and disables expired endpoints', async () => {
  const sent = [];
  const disabled = [];
  push._setWebPushClientForTest({
    async sendNotification(subscription, payload) {
      sent.push({ subscription, payload: JSON.parse(payload) });
      if (subscription.endpoint.endsWith('/expired')) {
        const err = new Error('expired');
        err.statusCode = 410;
        throw err;
      }
    }
  });

  const repo = {
    async listEnabledWebPushSubscriptions(userId) {
      assert.equal(userId, 15);
      return [
        { endpoint: 'https://push.example/ok', p256dh: 'p1', auth: 'a1' },
        { endpoint: 'https://push.example/expired', p256dh: 'p2', auth: 'a2' }
      ];
    },
    async disableWebPushSubscriptions(endpoints) {
      disabled.push(...endpoints);
      return endpoints.map(endpoint => ({ endpoint }));
    }
  };

  const result = await push.sendWebPushToUser(repo, 15, {
    title: '새 알림',
    body: '테스트 알림입니다.',
    data: { url: '/' }
  });

  assert.equal(sent.length, 2);
  assert.equal(sent[0].payload.notification.title, '새 알림');
  assert.deepEqual(disabled, ['https://push.example/expired']);
  assert.deepEqual(result, {
    enabled: true,
    sent: 1,
    failed: 1,
    invalidSubscriptions: 1
  });
});
