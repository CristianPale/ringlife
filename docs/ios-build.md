# Building the iOS app

RingLife has no App Store listing. To use the iOS app, you build it and sign it with your own Apple developer account. You can build it on a Mac with Xcode, or on GitHub Actions macOS runners and install it from TestFlight.

The app UI is in Italian. Some names below (settings sections, the Shortcuts action) are quoted as they appear in the app.

The source of the app is in `mobile/`: Ionic and Angular, packaged with Capacitor. The iOS project is `mobile/ios/App/App.xcodeproj`. iPhone is the main platform. Android builds, but it is not the platform the project tests on (see [Android](#android)).

## Requirements

- **A physical iPhone.** The iOS simulator has no Bluetooth, so the app cannot reach the ring there.
- **An Apple account.**
  - With a free Apple ID, Xcode can install the app on your own iPhone. The install expires after 7 days. Run it again from Xcode to renew it.
  - TestFlight and the GitHub Actions workflow need the paid Apple Developer Program.
- **The iPhone runs iOS 15 or later.** The project's deployment target is 15.0. The Shortcuts action «Leggi l'anello» needs iOS 16.
- **The ring is free.** The ring accepts one Bluetooth central at a time. Disconnect the vendor app, and any other app that talks to the ring, before you use RingLife.
- **For a local build:** a Mac with Xcode 26 or later, Node.js 22.22.3 or later (`engines` in `mobile/package.json`; CI uses Node 24), and npm.
- **For a CI build:** a GitHub repository with Actions enabled. You do not need a Mac.

The app also needs the RingLife server for scores and history. See [api.md](api.md) and [home-assistant.md](home-assistant.md). On first launch the setup assistant asks for the server address and the pairing secret.

## Choose your own bundle identifier

A bundle identifier is unique across all Apple developer accounts. The repository uses `com.ringlife.app`, which belongs to the original author's team. You cannot sign or upload with it. Pick your own, for example `com.example.ringlife`, and change it in these places:

| Where | What to change |
|---|---|
| `mobile/capacitor.config.ts` | `appId` |
| `mobile/ios/App/App.xcodeproj/project.pbxproj` | `PRODUCT_BUNDLE_IDENTIFIER`, in both the Debug and the Release configuration of the `App` target. In Xcode: target `App`, Signing & Capabilities, Bundle Identifier. |
| `mobile/ios/App/App.xcodeproj/project.pbxproj` | `PRODUCT_BUNDLE_IDENTIFIER` of the `RingLifeNotifications` target: your bundle identifier plus `.notifications`. CI signs it with that name. |
| GitHub repository variable | `IOS_BUNDLE_ID` (CI builds only, see below) |

`npx cap sync ios` does not copy `appId` into the Xcode project. Change both files.

The background task identifiers `com.ringlife.app.refresh` and `com.ringlife.app.night` appear in `mobile/ios/App/App/Info.plist` (`BGTaskSchedulerPermittedIdentifiers`) and in `mobile/ios/App/App/RingBackgroundPlugin.swift` (`RingBackgroundTask.identifier` and `NightReadTask.identifier`). You can keep them. If you rename them to match your bundle identifier, change both places with the same value.

The keychain group `com.ringlife.shared` (app and extension entitlements, `RingLifeKeychainGroup` in the app `Info.plist`) is prefixed with your team ID at build time. You can keep it.

The server sends push notifications to the topic `com.ringlife.app` by default. With your own bundle identifier, set the Home Assistant app option `apns_topic` to it (environment variable `RINGLIFE_APNS_TOPIC` outside Home Assistant).

The Android `applicationId` in `mobile/android/app/build.gradle` is independent. You only need to change it to publish on a store.

Choose the bundle identifier once. It cannot change after the first upload to App Store Connect.

## Build locally on a Mac

```bash
cd mobile
npm ci
npx ng build --configuration production   # output in mobile/www
npx cap sync ios                          # copies the web build and plugins into the iOS project
npx cap open ios                          # opens mobile/ios/App/App.xcodeproj in Xcode
```

The iOS project uses Swift Package Manager for the Capacitor plugins. Xcode resolves the packages the first time you open the project. No CocoaPods step is needed.

In Xcode:

1. Select the `App` target, then Signing & Capabilities.
2. Keep "Automatically manage signing" on. The committed project uses automatic signing.
3. Select your team. With a free Apple ID, this is your "Personal Team".
4. Check the bundle identifier (see the previous section).
5. Connect the iPhone and select it as the run destination.
6. Press Run.

On the iPhone:

- Turn on Developer Mode: Settings, Privacy & Security, Developer Mode. iOS asks for a restart.
- With a free Apple ID, trust the developer certificate: Settings, General, VPN & Device Management.
- Allow Bluetooth when the app asks. Allow notifications if you want the ring battery alerts.

Xcode writes your team into `project.pbxproj` as `DEVELOPMENT_TEAM`. You do not need to commit that change.

To upload to TestFlight from the Mac instead of CI, use Product, Archive, then Distribute App, App Store Connect. Each upload needs a build number higher than the previous one (see [Version and build numbers](#version-and-build-numbers)).

Repeat `npx ng build --configuration production` and `npx cap sync ios` after every change to the web code.

## Build in GitHub Actions without a Mac

The workflow `.github/workflows/ios-testflight.yml` (name: **iOS TestFlight**) builds the app on a GitHub macOS runner, signs it, and uploads it to TestFlight. It runs only when you start it, or when the release workflow calls it. It never runs on push.

The steps:

1. Selects the newest stable Xcode on the runner.
2. Checks that `IOS_BUNDLE_ID` is set and that `mobile/ios/App/App.xcodeproj` exists.
3. Runs `npm ci`, `npx ng build --configuration production` and `npx cap sync ios`.
4. Resolves the Swift packages, with up to 3 attempts.
5. Imports the distribution certificate into a temporary keychain and installs the two provisioning profiles: the app and the notification service extension.
6. Sets the build number with `xcrun agvtool new-version -all`.
7. Applies manual signing to the `App` and `RingLifeNotifications` targets with `mobile/scripts/apply-ios-signing.py`.
8. Archives, exports and uploads with `xcodebuild`, authenticated with the App Store Connect API key.
9. Deletes the keychain, the certificate, the profile and the API key from the runner, also when a step fails.
10. A second job, on Linux, writes the TestFlight notes.

GitHub disables workflows in a fork until you enable them on the Actions tab.

### Cost of macOS minutes

In a private repository, each macOS minute counts as 10 minutes of your Actions quota. Start the workflow only when you need a build. In a public repository, standard GitHub-hosted runners are free.

### 1. Register the app

1. On developer.apple.com, open Certificates, Identifiers & Profiles, then Identifiers. Add an App ID of type App, with an explicit bundle ID: your bundle identifier. Enable the **Push Notifications** capability (no certificate needed: the server uses an APNs key, see [Push notifications](#push-notifications)). Optionally enable **Time Sensitive Notifications** too, for alerts with delivery «importante».
2. Add a second App ID for the notification service extension, with the bundle ID `<your bundle identifier>.notifications`. It needs no capabilities.
3. On App Store Connect, open Apps, "+", New App. Select platform iOS and your bundle ID. Choose any SKU.
4. App names on App Store Connect are unique. If "RingLife" is taken, choose another name. The name on the home screen comes from `CFBundleDisplayName` in `Info.plist`, not from App Store Connect.

### 2. Create the App Store Connect API key

1. On App Store Connect, open Users and Access, Integrations, App Store Connect API, Team Keys.
2. Generate a key with the **App Manager** role. This role can upload builds and edit TestFlight test information ("What to Test"). The workflow does both.
3. Note the Key ID and the Issuer ID. The Issuer ID is shown above the list of keys.
4. Download the `.p8` file. Apple lets you download it only once.

### 3. Create the distribution certificate

You can do this on any system with `openssl`, for example Git Bash on Windows. Replace the email and the country code with yours.

```bash
openssl genrsa -out dist.key 2048
openssl req -new -key dist.key -out dist.csr -subj "/CN=RingLife Distribution/emailAddress=you@example.com/C=US"
```

On developer.apple.com, open Certificates, "+", Apple Distribution. Upload `dist.csr` and download `distribution.cer`. Then convert it to a `.p12` file with a password you choose:

```bash
openssl x509 -inform DER -in distribution.cer -out dist.pem
openssl pkcs12 -export -inkey dist.key -in dist.pem -out dist.p12 -passout pass:YOUR_P12_PASSWORD
```

If the workflow later fails to import the `.p12` with a MAC verification error, export it again and add `-legacy` to the `openssl pkcs12` command.

### 4. Create the provisioning profile

On developer.apple.com, open Profiles, "+", Distribution, App Store Connect. Select your App ID and the certificate from step 3. Download the `.mobileprovision` file.

Repeat for the extension App ID (`<your bundle identifier>.notifications`), with the same certificate. You get a second `.mobileprovision` file.

If you add a capability to the App ID later, edit the profile and save it to regenerate it, then update the secret.

The workflow reads the profile names and UUIDs from the files. You do not set them anywhere.

### 5. Encode the files in base64

The secrets hold three files as base64 text on one line.

PowerShell, one file at a time:

```powershell
[Convert]::ToBase64String([IO.File]::ReadAllBytes("dist.p12")) | Set-Clipboard
```

macOS:

```bash
base64 -i dist.p12 | pbcopy
```

Linux:

```bash
base64 -w0 dist.p12
```

Repeat for the two `.mobileprovision` files and for the `.p8` file.

### 6. Add the variable and the secrets on GitHub

Open the repository Settings, Secrets and variables, Actions.

On the **Variables** tab:

| Variable | Value |
|---|---|
| `IOS_BUNDLE_ID` | Your bundle identifier. It must match `appId` in `mobile/capacitor.config.ts` and the app on App Store Connect. |

On the **Secrets** tab:

| Secret | Value |
|---|---|
| `ASC_API_KEY_ID` | Key ID of the API key |
| `ASC_API_ISSUER_ID` | Issuer ID (a UUID) |
| `ASC_API_KEY_P8` | The `.p8` file, in base64 |
| `IOS_TEAM_ID` | Your Team ID, from Membership details on developer.apple.com |
| `IOS_DIST_CERT_P12` | `dist.p12`, in base64 |
| `IOS_DIST_CERT_PASSWORD` | The `.p12` password from step 3 |
| `IOS_PROVISION_PROFILE` | The app `.mobileprovision` file, in base64 |
| `IOS_PROVISION_PROFILE_NOTIFICATIONS` | The extension `.mobileprovision` file, in base64. Without it the signing step fails. |

Keep `dist.key`, `dist.p12`, the `.p8` file and the password in a password manager. Never commit them. The certificate and the profile last one year. Renew them, then update `IOS_DIST_CERT_P12`, `IOS_DIST_CERT_PASSWORD`, `IOS_PROVISION_PROFILE` and `IOS_PROVISION_PROFILE_NOTIFICATIONS`.

### 7. Run the workflow

Open Actions, **iOS TestFlight**, Run workflow. The inputs:

| Input | Meaning |
|---|---|
| `version` | Marketing version, for example `0.2.0`. Empty means the `version` in `mobile/package.json`. Apple accepts `X.Y` or `X.Y.Z` with no leading zeros. |
| `runner` | `macos-26` (default) or `macos-15`. See below. |

The release workflow `.github/workflows/release.yml` (name: **Rilascio**) also calls this workflow, on a version tag. It sets the version from `CHANGELOG.md`, commits it, tags `vX.Y.Z`, builds the server package and the iOS app, and publishes a GitHub release. Use **iOS TestFlight** alone for a test build.

Only one iOS build runs at a time (concurrency group `ios-testflight`). A run times out after 45 minutes.

### Choose the macOS runner

- `macos-26` is the default. GitHub often queues it for capacity. The run then shows "The job was not acquired by Runner of type hosted".
- `macos-15` has Xcode 26 installed next to its default Xcode. Start the workflow again with `runner` = `macos-15` if `macos-26` stays queued. A full run (archive, signing, export, upload) took about 13 minutes there.
- A queued job uses no minutes until a machine picks it up.

### Xcode and SDK

The "Seleziona Xcode" step picks the newest Xcode installed on the runner. It takes only numeric versions such as `Xcode_26.5.app` and skips beta and release candidate builds, because App Store Connect rejects them.

- Xcode 26 or later is required. With an older Xcode the step fails.
- App Store Connect warns (ITMS-90725) that from April 2027 it accepts only builds made with the iOS 27 SDK, which comes with Xcode 27. Until the runner image has Xcode 27, the step builds with Xcode 26 and prints a warning. When GitHub adds Xcode 27 to the image, the step selects it without changes.

### Version and build numbers

- The marketing version (`CFBundleShortVersionString`) is the `version` input or the version in `mobile/package.json`. The archive step passes it as `MARKETING_VERSION`.
- The build number (`CFBundleVersion`) is the UTC time of the build: two-digit year, day of the year, hour and minute, from `date -u +%y%j%H%M`. For example, `263271034` is 2026, day 327, 10:34 UTC.
- This number always grows, whichever workflow starts the build. It stays below 2^31 until 2099.
- The committed project has `CURRENT_PROJECT_VERSION = 1`. For an upload from Xcode, set a higher build number by hand, for example in the same format.

### Signing in CI

The committed project keeps automatic signing, so it opens and runs in Xcode. In CI, `mobile/scripts/apply-ios-signing.py` switches only the Release configuration of the `App` and `RingLifeNotifications` targets to manual signing, each with its profile:

```bash
python3 scripts/apply-ios-signing.py ios/App/App.xcodeproj/project.pbxproj "$IOS_TEAM_ID" \
  "$BUNDLE_ID=$PROFILE_NAME" \
  "$BUNDLE_ID.notifications=$PROFILE_NAME_NOTIFICATIONS"
```

The export options list both profiles under `provisioningProfiles`.

It sets `CODE_SIGN_STYLE = Manual`, `CODE_SIGN_IDENTITY[sdk=iphoneos*] = "Apple Distribution"`, `DEVELOPMENT_TEAM` and `PROVISIONING_PROFILE_SPECIFIER`. The workflow does not pass these settings on the `xcodebuild` command line: there they would also apply to the Swift package resource bundles, which do not support provisioning profiles. The script is idempotent. Its tests run with:

```bash
cd mobile
python3 -m unittest scripts/test_apply_ios_signing.py
```

### TestFlight notes

After the upload, the `notes` job runs on `ubuntu-latest`, where minutes cost less. It uses the same three `ASC_*` secrets and `IOS_BUNDLE_ID`.

1. `python3 scripts/release.py build-notes "$VERSION"` takes the notes from `CHANGELOG.md`. A test build gets the unreleased section («Non rilasciata») when it has entries. Otherwise it gets the section of the version.
2. `scripts/testflight_notes.py` waits until the build appears on App Store Connect (up to 20 minutes, `TESTFLIGHT_WAIT_SECONDS`, default `1200`).
3. It writes the notes in "What to Test" for each language of the build. If the build has no language yet, it creates Italian (`it`). TestFlight accepts at most 4000 characters.

If this job fails, the build stays on TestFlight without notes.

### Install from TestFlight

1. App Store Connect processes the build in 10 to 30 minutes after the upload. The build then appears under TestFlight.
2. Internal testers are users of your App Store Connect team. Internal testing needs no Beta App Review.
3. Add yourself as an internal tester. Install the TestFlight app on the iPhone and install RingLife from it.
4. A TestFlight build expires after 90 days. Build again before that.

## What the iOS project contains

You do not need to add these settings. This section explains them, so you can check them after a change.

### Device and orientation

- iPhone only (`TARGETED_DEVICE_FAMILY = 1`).
- Portrait only.
- Development language Italian (`CFBundleDevelopmentRegion` = `it`).

### Encryption export compliance

The app uses only the encryption built into iOS: HTTPS. `Info.plist` sets `ITSAppUsesNonExemptEncryption` to `NO`, so App Store Connect does not ask the export question for each build. If App Store Connect asks, answer "None of the algorithms mentioned above". Review this answer if you add your own encryption, for example an encrypted local database.

### Info.plist privacy and network keys

| Key | Purpose |
|---|---|
| `NSBluetoothAlwaysUsageDescription` | Italian text that tells the user why the app uses Bluetooth: to connect to the ring and read health data. Without it, iOS terminates the app at the first Bluetooth access, and App Store Connect rejects the build. |
| `NSLocalNetworkUsageDescription` | Italian text for the local network permission. The app reaches the home server on the Wi-Fi network. |
| `NSAppTransportSecurity` / `NSAllowsLocalNetworking` | Allows plain HTTP only to IP addresses, names without a domain and `.local` names. App Transport Security stays on for every other host. |

Bluetooth in the foreground needs no other capability.

### Background reading

The app can read the ring while it is in the background. This is iOS only.

What the project declares:

- `UIBackgroundModes` in `Info.plist`: `bluetooth-central`, `fetch` and `processing`. In Xcode, these appear under Background Modes as "Uses Bluetooth LE accessories", "Background fetch" and "Background processing".
- `BGTaskSchedulerPermittedIdentifiers` in `Info.plist`: `com.ringlife.app.refresh` and `com.ringlife.app.night`.
- Background modes, local notifications and App Intents need no App ID capability. The entitlements file exists for push notifications and the shared keychain (see [Push notifications](#push-notifications)).

How it works:

1. At launch, `AppDelegate.swift` registers a `BGAppRefreshTask` and submits a request (`RingBackgroundTask` in `RingBackgroundPlugin.swift`).
2. The request asks iOS to wake the app **not earlier than** the interval chosen in Impostazioni › Anello: 30 minutes, 1, 2 or 4 hours, or off. The default is 1 hour.
3. iOS decides when to wake the app, and whether to wake it at all. It weighs how often you use the app, the battery, Low Power Mode and the Background App Refresh setting. Expect irregular intervals.
4. When iOS wakes the app, `RingCollector.swift` connects to the ring, sends the same requests as the app, and saves the raw packets. It submits the next request first, so an interrupted run does not stop the cycle.
5. After a saved reading, the native plugin sends the event `backgroundRead` to the web page. If the app is still in the background and the ring is free, the page decodes the saved packets with its TypeScript parsers, uploads them to the server, downloads new alerts and notifies them. It reports each step to the native side (`chainStep`: `decoded`, `uploaded`, `alerts`). The native side ends the background task at the last step, at an error or when the chain time runs out. If the page does not answer within 2 seconds, the task ends at once and the data waits for the next opening.
6. Time limits: in a refresh task the reading stops at 18 seconds and the chain at 8 (iOS gives about 30 seconds); in the Shortcuts action 20 and 8; in the night task 25 and 20.

A second task, `BGProcessingTask` `com.ringlife.app.night`, asks iOS for a run each day not earlier than your usual wake time (from the app goals) plus 40 minutes, with network. iOS grants it when the phone is idle, often while charging. At that time the night is over, so the server can already create the night alerts. It follows the same background reading switch.

Conditions:

- The app must have connected to the ring once in the foreground. The collector does not scan. It uses the ring identifier the app saved, or a ring already connected to iOS.
- Background App Refresh must be on: Settings, General, Background App Refresh, for the system and for RingLife.
- iOS does not wake an app that you closed by swiping it away in the app switcher. For that case the app offers the Shortcuts action «Leggi l'anello» (`RingReadIntent.swift`, iOS 16 or later). Create a personal automation at a time of day in the Shortcuts app that runs this action. It reads the ring without opening the app.
- «Disconnetti» in the app settings pauses all reading, also in the background.
- The collector does not keep a connection open and does not use Core Bluetooth state restoration.
- The collector never writes ring settings. Only the app, at each foreground reading, checks the measurements switched on in the ring and writes them again if the ring lost them.

The in-app guide (`/guida/automazioni`) explains which Shortcuts automations to create: wake time plus 45 minutes, one at midday and one in the evening. Impostazioni › Anello has a button that opens Shortcuts.

Each background attempt, successful or not, goes into a log of the last 20 attempts, with source, outcome, the step where it stopped and how far the chain went (`chain`: `no_page`, `decoded`, `uploaded`, `alerts`, `failed`, `skipped` or `timeout`). Impostazioni › Anello shows the last 5.

The same code sends local notifications when the ring battery reaches 20% and 10%, in the foreground and in the background. iOS asks for the notification permission when the alerts are on.

For the ring protocol behind the requests, see [protocol.md](protocol.md).

### Push notifications

The home server can send alerts as push notifications with encrypted title and text. Server side and payload are in [api.md](api.md#push-notifications). Without push, the app shows alerts as local notifications when it reads the ring, in the foreground or in the background.

What the project contains:

- `App/App.entitlements`: `aps-environment` = `production` (TestFlight builds) and `keychain-access-groups` with `$(AppIdentifierPrefix)com.ringlife.shared`.
- `RingLifeKeychainGroup` in the app `Info.plist`, with the same group, so app and extension read the same key.
- The target `RingLifeNotifications` (`mobile/ios/App/RingLifeNotifications/`): a Notification Service Extension with `NotificationService.swift`, its `Info.plist` and its entitlements (the same keychain group). It is embedded in the app.

How it works:

1. In Impostazioni › Notifiche, «Notifiche dal server di casa» › Attiva, the app creates a random AES-256 key in the shared keychain and sends it to the server with the APNs token.
2. The server encrypts title, text and app page with AES-256-GCM and sends a visible push with the fallback text «Avviso di RingLife» and `mutable-content`.
3. The extension decrypts the payload with the key from the keychain and replaces title and text. If it cannot decrypt, the fallback text stays.

Setup with your own Apple account:

1. Create an APNs key: developer.apple.com, Keys, "+", Apple Push Notifications service (APNs), environment "Sandbox & Production". Download the `.p8` file (only once) and note the Key ID and your Team ID.
2. Set the Home Assistant app options `apns_key`, `apns_key_id` and `apns_team_id` ([home-assistant.md](home-assistant.md#options)) and restart the app.
3. App IDs and profiles as in steps 1 and 4 above: Push Notifications on the app App ID, a second App ID and profile for `<bundle id>.notifications`, the secret `IOS_PROVISION_PROFILE_NOTIFICATIONS`.
4. The time-sensitive notification (delivery «importante») needs the Time Sensitive Notifications capability on the App ID and the matching entitlement (`com.apple.developer.usernotifications.time-sensitive`), which the committed project does not have. Without it, iOS delivers those alerts as normal notifications.
5. With your own bundle identifier, set the option `apns_topic` (see [Choose your own bundle identifier](#choose-your-own-bundle-identifier)).

Check: the settings screen says «Attive». «Manca la configurazione di Apple» means the app has no push entitlement. «Il server di casa non ha ancora la chiave di Apple» means the `apns_*` options are missing. A push that shows only «Avviso di RingLife» means the extension cannot read the key: check the keychain group, then turn push off and on to create a new key.

## Android

`mobile/android/` holds the Capacitor Android project. Each release attaches a signed APK, but the app is tested on iOS only. What works, what is missing and how to install: [android.md](android.md).

- `minSdkVersion` 24, `compileSdkVersion` and `targetSdkVersion` 36 (`mobile/android/variables.gradle`).
- Bluetooth permissions: `BLUETOOTH_SCAN` (with `neverForLocation`) and `BLUETOOTH_CONNECT` from API 31. On API 30 and earlier, `BLUETOOTH`, `BLUETOOTH_ADMIN` and `ACCESS_FINE_LOCATION`.
- No background reading and no battery notifications. The app reads the ring when you open it or return to it.
- The release workflow builds the signed APK on Linux. The `Mobile` workflow (`.github/workflows/mobile.yml`) builds and tests only the web app.

To build it:

```bash
cd mobile
npm ci
npx ng build --configuration production
npx cap sync android
npx cap open android        # opens the project in Android Studio
```

Or from the command line, with an Android SDK installed:

```bash
cd mobile/android
./gradlew assembleDebug
```

## See also

- [README.md](../README.md): what RingLife is and how the parts fit together.
- [CONTRIBUTING.md](../CONTRIBUTING.md): development setup and tests.
- [api.md](api.md): the server API and phone pairing.
- [home-assistant.md](home-assistant.md): installing the server as a Home Assistant app.
- [protocol.md](protocol.md): the ring Bluetooth protocol.
