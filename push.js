let firebaseAdmin = null;
let firebaseInitTried = false;

function getFirebaseAdmin() {
  if (firebaseInitTried) return firebaseAdmin;
  firebaseInitTried = true;

  const serviceAccountJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  const credentialsPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;

  if (!serviceAccountJson && !credentialsPath) {
    return null;
  }

  try {
    const admin = require('firebase-admin');
    if (!admin.apps.length) {
      const appOptions = {};
      if (serviceAccountJson) {
        appOptions.credential = admin.credential.cert(JSON.parse(serviceAccountJson));
      } else {
        appOptions.credential = admin.credential.applicationDefault();
      }
      admin.initializeApp(appOptions);
    }
    firebaseAdmin = admin;
  } catch (err) {
    console.error('[push] Firebase Admin initialization failed:', err.message);
    firebaseAdmin = null;
  }

  return firebaseAdmin;
}

function isInvalidTokenError(code) {
  return [
    'messaging/invalid-registration-token',
    'messaging/registration-token-not-registered'
  ].includes(code);
}

async function sendPushToUser(repo, userId, notification) {
  const admin = getFirebaseAdmin();
  if (!admin) {
    return { enabled: false, sent: 0, failed: 0 };
  }

  const tokens = await repo.listEnabledPushTokens(userId);
  const cleanTokens = [...new Set(tokens.map(row => row.token).filter(Boolean))];
  if (!cleanTokens.length) {
    return { enabled: true, sent: 0, failed: 0 };
  }

  const message = {
    tokens: cleanTokens,
    notification: {
      title: notification.title,
      body: notification.body
    },
    data: Object.fromEntries(
      Object.entries(notification.data || {}).map(([key, value]) => [key, String(value ?? '')])
    ),
    android: {
      priority: 'high',
      notification: {
        channelId: 'eatspay_default'
      }
    },
    apns: {
      payload: {
        aps: {
          sound: 'default'
        }
      }
    }
  };

  const result = await admin.messaging().sendEachForMulticast(message);
  const invalidTokens = [];
  result.responses.forEach((response, index) => {
    if (!response.success && isInvalidTokenError(response.error?.code)) {
      invalidTokens.push(cleanTokens[index]);
    }
  });
  if (invalidTokens.length) {
    await repo.disablePushTokens(invalidTokens);
  }

  return {
    enabled: true,
    sent: result.successCount,
    failed: result.failureCount,
    invalidTokens: invalidTokens.length
  };
}

module.exports = {
  sendPushToUser
};
