const assert = require('node:assert/strict');
const test = require('node:test');

const push = require('../push');

test.afterEach(() => {
  push._resetFirebaseAdminForTest();
  delete process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  delete process.env.GOOGLE_APPLICATION_CREDENTIALS;
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
