# Android Runbook

## 1. Backend First

The Android app must call a public HTTPS backend. Do not use `localhost` on a real phone.

Required backend environment:

```text
DATABASE_URL=postgresql://...
JWT_SECRET=...
EATSPAY_HMAC_SECRET=...
ADMIN_ROLLBACK_TOKEN=...
PORT=3000
```

Initialize the database and admin account:

```powershell
npm.cmd run db:init
npm.cmd run db:create-admin
npm.cmd start
```

Deploy this server behind HTTPS, then set the app API URL.

## 2. Set API URL

Edit `js/config.js`:

```js
window.EATSPAY_CONFIG = {
  API_BASE_URL: localStorage.getItem('EATSPAY_API_BASE_URL') || 'https://eatspay.kr'
};
```

Replace `https://eatspay.kr` with your production domain if you change hosts later.

For a temporary local test on a phone, use a tunnel URL such as an HTTPS ngrok/cloudflared URL.

## 3. Sync Web Assets

```powershell
npm.cmd run android:sync
```

This copies only the static app files into `www/`, then syncs them into the native Android project.

## 4. Build Debug APK

Install Android Studio or a JDK plus Android SDK first. `JAVA_HOME` must point to the installed JDK.

```powershell
cd android
.\gradlew.bat assembleDebug
```

The APK is generated at:

```text
android/app/build/outputs/apk/debug/app-debug.apk
```

## 5. Run On A Phone

1. Enable Developer options on the Android phone.
2. Enable USB debugging.
3. Connect the phone by USB.
4. Open the project:

```powershell
npm.cmd run android:open
```

5. In Android Studio, select the phone and press Run.

## Notes

- Android network calls require HTTPS for production.
- The mobile app now uses JWT for user payment requests. HMAC remains for admin rollback/server-grade operations.
- File upload preview uses `/api/files/:fileName` and `/uploads/:fileName`.
- Actual PG settlement sync and bank account verification still require external provider API credentials.
