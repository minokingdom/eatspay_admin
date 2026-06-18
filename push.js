const fs = require('fs');

let firebaseAdmin = null;
let firebaseInitTried = false;
let webPushClient = null;
let webPushInitTried = false;

function getPushRuntimeStatus() {
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

function getWebPushRuntimeStatus() {
  const publicKey = process.env.WEB_PUSH_VAPID_PUBLIC_KEY;
  const privateKey = process.env.WEB_PUSH_VAPID_PRIVATE_KEY;
  const subject = process.env.WEB_PUSH_VAPID_SUBJECT || process.env.WEB_PUSH_CONTACT || 'mailto:admin@eatspay.co.kr';
  const configured = Boolean(publicKey && privateKey);
  return {
    configured,
    mode: configured ? 'VAPID' : 'none',
    detail: configured
      ? `VAPID public key is configured. subject=${subject}`
      : 'WEB_PUSH_VAPID_PUBLIC_KEY and WEB_PUSH_VAPID_PRIVATE_KEY are not configured.'
  };
}

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

function getWebPushClient() {
  if (webPushInitTried) return webPushClient;
  webPushInitTried = true;

  const publicKey = process.env.WEB_PUSH_VAPID_PUBLIC_KEY;
  const privateKey = process.env.WEB_PUSH_VAPID_PRIVATE_KEY;
  if (!publicKey || !privateKey) {
    return null;
  }

  try {
    const webPush = require('web-push');
    const subject = process.env.WEB_PUSH_VAPID_SUBJECT || process.env.WEB_PUSH_CONTACT || 'mailto:admin@eatspay.co.kr';
    webPush.setVapidDetails(subject, publicKey, privateKey);
    webPushClient = webPush;
  } catch (err) {
    console.error('[push] Web Push initialization failed:', err.message);
    webPushClient = null;
  }

  return webPushClient;
}

function isInvalidTokenError(code) {
  return [
    'messaging/invalid-registration-token',
    'messaging/registration-token-not-registered'
  ].includes(code);
}

function stringifyDataValue(value) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
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
      Object.entries(notification.data || {}).map(([key, value]) => [key, stringifyDataValue(value)])
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

function isInvalidWebPushError(statusCode) {
  return [404, 410].includes(Number(statusCode));
}

async function sendWebPushToUser(repo, userId, notification) {
  const webPush = getWebPushClient();
  if (!webPush) {
    return { enabled: false, sent: 0, failed: 0 };
  }

  const subscriptions = await repo.listEnabledWebPushSubscriptions(userId);
  if (!subscriptions.length) {
    return { enabled: true, sent: 0, failed: 0 };
  }

  const payload = JSON.stringify({
    notification: {
      title: notification.title,
      body: notification.body
    },
    data: notification.data || {}
  });
  const invalidEndpoints = [];
  let sent = 0;
  let failed = 0;

  await Promise.all(subscriptions.map(async row => {
    const subscription = {
      endpoint: row.endpoint,
      keys: {
        p256dh: row.p256dh,
        auth: row.auth
      }
    };
    try {
      await webPush.sendNotification(subscription, payload);
      sent += 1;
    } catch (err) {
      failed += 1;
      if (isInvalidWebPushError(err.statusCode)) {
        invalidEndpoints.push(row.endpoint);
      }
    }
  }));

  if (invalidEndpoints.length) {
    await repo.disableWebPushSubscriptions(invalidEndpoints);
  }

  return {
    enabled: true,
    sent,
    failed,
    invalidSubscriptions: invalidEndpoints.length
  };
}

async function sendNotificationPushToUser(repo, userId, notification) {
  const [fcm, web] = await Promise.all([
    sendPushToUser(repo, userId, notification),
    sendWebPushToUser(repo, userId, notification)
  ]);
  return { fcm, web };
}

module.exports = {
  sendPushToUser,
  sendWebPushToUser,
  sendNotificationPushToUser,
  getPushRuntimeStatus,
  getWebPushRuntimeStatus,
  _setFirebaseAdminForTest(admin) {
    firebaseAdmin = admin;
    firebaseInitTried = true;
  },
  _setWebPushClientForTest(client) {
    webPushClient = client;
    webPushInitTried = true;
  },
  _resetFirebaseAdminForTest() {
    firebaseAdmin = null;
    firebaseInitTried = false;
    webPushClient = null;
    webPushInitTried = false;
  }
};
