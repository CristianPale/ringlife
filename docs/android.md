# Android

**RingLife is tested on iOS only. It is also available for Android, untested.** The Android app is built from the same code as the iPhone app, but nobody has tried it on a real Android phone yet. Reports are welcome: open an issue with your phone model and Android version (never attach health data).

## What works

The Android app runs the same web code as the iPhone app:

- reading the ring over Bluetooth **while the app is open**, when you open it or pull to refresh;
- upload to your server, scores, sleep, plugins, diary, trends, alerts list;
- live heart rate for training and guided breathing, measure now;
- local notifications while the app is open.

## What is missing

- **Background reading.** The iPhone app reads the ring in the background with native Swift code. There is no Android version of it: open the app to sync.
- **Push notifications.** The server sends encrypted pushes through Apple only. On Android, alerts arrive when you open the app.
- **Shortcuts automations** are an iOS feature.

## Install

1. Download `ringlife-X.Y.Z.apk` from the [latest release](https://github.com/CristianPale/ringlife/releases/latest). Check it against `ringlife-X.Y.Z.apk.sha256` if you like.
2. Open it on the phone and allow installation from unknown sources when Android asks.
3. On first launch allow Bluetooth ("Nearby devices") and notifications. Then follow the first-run setup: server address, pairing secret, ring.

Updates: install the APK of the new release over the old one. Your settings and queued data stay.

Requirements: Android 7.0 (API 24) or later. Bluetooth permissions: `BLUETOOTH_SCAN` and `BLUETOOTH_CONNECT` from Android 12 (API 31); location on Android 11 and earlier, as Android requires for Bluetooth scanning.

## Build it yourself

```bash
cd mobile
npm ci
npx ng build --configuration production
npx cap sync android
cd android
./gradlew assembleDebug        # app/build/outputs/apk/debug/app-debug.apk
```

A signed release build reads the keystore from the environment: `RINGLIFE_ANDROID_KEYSTORE` (path to the `.jks` file), `RINGLIFE_ANDROID_KEYSTORE_PASSWORD`, `RINGLIFE_ANDROID_KEY_ALIAS` and `RINGLIFE_ANDROID_KEY_PASSWORD`, then `./gradlew assembleRelease`. Without them the release build is unsigned. Change `applicationId` in `mobile/android/app/build.gradle` if you publish your own build.
