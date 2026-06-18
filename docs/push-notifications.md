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
```

Check that the app server is healthy:

```bash
curl -fsS https://www.eatspay.co.kr/healthz
```

Check Firebase and registered device tokens:

```bash
npm run push:status
```

Check one login account specifically:

```bash
npm run push:status -- --email=admin@eatspay.co.kr
```

Important status meanings:

- `firebase.configured: false`: Firebase server credentials are missing or invalid.
- `tokens.enabled: 0`: no phone has logged in and registered a push token yet.
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
    "enabled": true,
    "sent": 1,
    "failed": 0
  }
}
```

If `"enabled": false`, Firebase credentials are not configured on the server. If `"sent": 0`, the app has not registered a device token yet.

## Current trigger

When an admin approves or rejects a virtual account request, the server:

1. Saves an in-app notification in PostgreSQL.
2. Sends a push notification to every enabled device token registered for that user.
3. Disables invalid FCM tokens returned by Firebase.

If Firebase credentials are not configured, the DB notification still works and push delivery is skipped.
