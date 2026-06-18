# Eats Pay Push Notifications

Eats Pay uses Firebase Cloud Messaging (FCM) for Android and iOS push notifications.

## Android app setup

1. Create a Firebase project.
2. Add an Android app with package name `kr.co.eatspay.app`.
3. Download `google-services.json`.
4. Put it at:

   ```text
   android/app/google-services.json
   ```

5. Run:

   ```bash
   npm run android:sync
   ```

6. Build the APK/AAB again.

## iOS app setup

1. Add an iOS app in the same Firebase project.
2. Use the iOS bundle id that will be used for the App Store build.
3. Download `GoogleService-Info.plist`.
4. Add it to the iOS app target in Xcode.
5. Configure APNs in Firebase Cloud Messaging.

If the `ios/` project does not exist yet, create it on a Mac:

```bash
npx cap add ios
npx cap sync ios
```

iOS push cannot be fully built or signed on Windows. It requires Mac, Xcode, Apple Developer account, APNs key/certificate, and the Firebase iOS app configuration.

## Web/PWA push setup

The PWA can receive browser push notifications when Web Push VAPID keys are configured on the server.

Generate VAPID keys:

```bash
npm run push:vapid
```

Copy the generated values to `/opt/eatspay/.env`:

```bash
WEB_PUSH_VAPID_PUBLIC_KEY=...
WEB_PUSH_VAPID_PRIVATE_KEY=...
WEB_PUSH_VAPID_SUBJECT=mailto:admin@eatspay.co.kr
```

After restart, users who open `https://www.eatspay.co.kr`, log in, and allow notifications will register a browser subscription in PostgreSQL.

## Server setup

The server sends push messages through Firebase Admin SDK. Configure one of these on AWS:

```bash
FIREBASE_SERVICE_ACCOUNT_JSON='{"type":"service_account","project_id":"..."}'
```

or:

```bash
GOOGLE_APPLICATION_CREDENTIALS=/etc/eatspay/firebase-service-account.json
```

After changing the environment file:

```bash
sudo systemctl restart eatspay
```

Typical AWS deployment after pulling this feature:

```bash
cd /opt/eatspay
sudo git pull origin main
npm install
npm run push:vapid
npm run db:init
sudo install -d -m 750 -o root -g root /etc/eatspay
sudo nano /etc/eatspay/firebase-service-account.json
sudo chmod 640 /etc/eatspay/firebase-service-account.json
sudo nano /opt/eatspay/.env
sudo systemctl restart eatspay
sudo systemctl status eatspay --no-pager
```

Add this to `/opt/eatspay/.env` if the service account JSON is stored as a file:

```bash
GOOGLE_APPLICATION_CREDENTIALS=/etc/eatspay/firebase-service-account.json
WEB_PUSH_VAPID_PUBLIC_KEY=...
WEB_PUSH_VAPID_PRIVATE_KEY=...
WEB_PUSH_VAPID_SUBJECT=mailto:admin@eatspay.co.kr
```

Check that the app server is healthy:

```bash
curl -fsS https://www.eatspay.co.kr/healthz
```

Check Firebase and registered device tokens:

```bash
npm run push:readiness
npm run push:status
```

Check one login account specifically:

```bash
npm run push:readiness -- --email=admin@eatspay.co.kr
npm run push:status -- --email=admin@eatspay.co.kr
```

Check the live production URL from AWS:

```bash
npm run push:smoke
```

With an admin access token, the smoke test can also check the authenticated admin diagnostics API:

```bash
ADMIN_ACCESS_TOKEN=ADMIN_ACCESS_TOKEN npm run push:smoke -- --email=admin@eatspay.co.kr
```

To send a real test push through the production URL:

```bash
ADMIN_ACCESS_TOKEN=ADMIN_ACCESS_TOKEN npm run push:smoke -- --email=admin@eatspay.co.kr --sendTest
```

The same diagnostics are also available through the authenticated admin API:

```bash
curl -fsS "https://www.eatspay.co.kr/api/admin/push/status?email=admin@eatspay.co.kr" \
  -H "Authorization: Bearer ADMIN_ACCESS_TOKEN"
```

Important status meanings:

- `firebase.configured: false`: Firebase server credentials are missing or invalid.
- `webPush.configured: false`: Web Push VAPID keys are missing.
- `tokens.enabled: 0`: no phone has logged in and registered a push token yet.
- `webSubscriptions.enabled: 0`: no browser/PWA has logged in and registered a web push subscription yet.
- `target.enabledTokens: 0`: that specific account has no registered phone token.

## Test delivery

Install the new Android build on a phone, log in once, and allow notifications. This registers the phone token in PostgreSQL.

Then send a test push from AWS:

```bash
cd /opt/eatspay
npm run push:test -- --email=admin@eatspay.co.kr
```

or target a specific user id:

```bash
npm run push:test -- --userId=1
```

Successful output looks like this:

```json
{
  "success": true,
  "userId": 1,
  "email": "admin@eatspay.co.kr",
  "push": {
    "fcm": {
      "enabled": true,
      "sent": 1,
      "failed": 0
    },
    "web": {
      "enabled": true,
      "sent": 1,
      "failed": 0
    }
  }
}
```

If `push.fcm.enabled` is `false`, Firebase credentials are not configured on the server. If `push.web.enabled` is `false`, Web Push VAPID keys are not configured. If both `sent` values are `0`, the target account has not registered a phone token or web subscription yet.

An authenticated admin API can also send a test push:

```bash
curl -fsS -X POST https://www.eatspay.co.kr/api/admin/push/test \
  -H "Authorization: Bearer ADMIN_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@eatspay.co.kr","title":"eats PAY 테스트 알림","body":"푸시알림 연결이 정상적으로 동작합니다."}'
```

## Current trigger

The server sends push notifications when:

- An admin approves or rejects a virtual account request.
- A Talk chat message is sent to the other participant.

For each push event, the server:

1. Saves an in-app notification in PostgreSQL.
2. Sends a push notification to every enabled device token registered for that user.
3. Disables invalid FCM tokens returned by Firebase.

If Firebase credentials are not configured, the DB notification still works and push delivery is skipped.
