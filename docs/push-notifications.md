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

## Current trigger

When an admin approves or rejects a virtual account request, the server:

1. Saves an in-app notification in PostgreSQL.
2. Sends a push notification to every enabled device token registered for that user.
3. Disables invalid FCM tokens returned by Firebase.

If Firebase credentials are not configured, the DB notification still works and push delivery is skipped.
