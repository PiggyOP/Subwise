# Building Subwise for Android and iPhone

The native app is in this folder. `../web` is the separate browser website. The native app uses React Native views, SecureStore and the shared Subwise backend; it does not wrap the website in a WebView.

## Current status

- Android and iOS native project generation succeeded.
- Both platforms' JavaScript/Hermes exports succeeded.
- Expo dependency compatibility and configuration tests passed.
- No installable APK, IPA or signed store build has been produced.
- Expo CLI reported no signed-in account on this computer.
- Full Xcode and a Java runtime are missing from the active local toolchain. Android SDK components are present.
- There is no configured reachable mobile backend. A build must not pretend bank, cancellation, AI or email providers are connected.

## Configuration files

| File | Purpose |
| --- | --- |
| `app.json` | Shared app name, icon, phone orientation, versions, native permissions and platform settings |
| `app.config.js` | Per-build app identities and backend validation |
| `eas.json` | Android/iOS development, preview and store build profiles |
| `.env.example` | Public local configuration template |
| `.easignore` | Excludes dependencies, local environment files and generated folders from cloud uploads |

Development uses `in.subwise.mobile.dev`, preview uses `in.subwise.mobile.preview`, and production uses `in.subwise.mobile`. Verify ownership and availability of the production identifiers before store registration. The custom URL schemes differ by variant so they can coexist. Registering a scheme does not implement a financial provider's authorization return flow.

## 1. Connect a real HTTPS backend

Create `.env` from `.env.example`. Replace `EXPO_PUBLIC_API_URL` with the actual backend origin. Do not include `/api`; the client adds it. This URL must be reachable from the phone and use a valid HTTPS certificate.

The phone's `localhost` is the phone, not the laptop. The Vite website port is not the mobile app's server. An Expo/Metro tunnel transports development code; it does not automatically expose the Express API.

Preview/store configuration fails early if the backend is absent, insecure, local-only or a known placeholder. Development may open without a backend, but sign-in will not work until one is configured.

Only public configuration belongs in `EXPO_PUBLIC_*`; it is embedded in the installed app. Bank, cancellation-provider, AI, email and payment secrets stay on the backend.

## 2. Link your Expo project

From this directory:

```sh
npx eas-cli login
npx eas-cli init
```

Sign in yourself; do not paste a password or access token into chat. Use your own Expo account/organisation. If dynamic configuration prevents `init` from writing a project ID, put the actual UUID it reports into `EAS_PROJECT_ID` in your local environment. The config also preserves an existing `extra.eas.projectId` from `app.json`. Never use an invented project ID.

If EAS asks about the absent Git repository, either initialise version control or use Expo's supported `EAS_NO_VCS=1` environment setting for the command. The `.easignore` file limits uploads to this native project.

## 3. Configure EAS environment values

Set `EXPO_PUBLIC_API_URL` in the Expo dashboard for each environment you use: `development`, `preview`, `production`. The corresponding build profiles select them explicitly. Keep the production API separate from test/staging customer data.

Alternatively use `npx eas-cli env:set` with `--name EXPO_PUBLIC_API_URL`, the real `--value`, `--environment preview`, and `--visibility plaintext`. This is a public endpoint, not a secret. Repeat with the appropriate endpoint for other environments. Do not commit real environment files.

## 4. Choose a build

| Goal | Command | Result |
| --- | --- | --- |
| Android developer app | `npx eas-cli build --platform android --profile development` | Development client; needs Metro while developing |
| iPhone developer app | `npx eas-cli build --platform ios --profile development` | Device-signed development client |
| iOS Simulator developer app | `npx eas-cli build --platform ios --profile development-simulator` | Simulator development client |
| Installable Android preview | `npm run build:android:preview` | Standalone APK for a phone or emulator |
| Installable iPhone preview | `npm run build:ios:preview` | Ad hoc device build; signing and device registration required |
| iOS Simulator preview | `npm run build:ios:simulator` | Simulator build; cannot be installed on a physical iPhone |
| Store builds for both | `npm run build:production` | Android AAB and signed iOS distribution build |

A development build is your own app with developer tools. After installing it, run `npm start` to serve the code. For an Expo Go session, use `npm run start:go` with a compatible Expo Go version; this is not a standalone installable Subwise app.

The APK is directly installable; an AAB is for Google Play distribution. Device iOS distribution needs the appropriate Apple signing/provisioning and developer account. Simulator builds do not substitute for iPhone device tests. No cloud build or store upload was started automatically.

## Local compilation instead of cloud builds

Install/configure full Xcode for iOS or a compatible Java runtime and Android toolchain for Android. Then use:

```sh
npm run android
npm run ios
```

The native folders are generated from Expo configuration and ignored by version control/cloud uploads. After changing native configuration or switching variants, regenerate with the intended variant before local compilation. Avoid hand-editing generated native files; put lasting changes in Expo configuration or config plugins.

## Validation

```sh
npm run check
npm run test:config
npm run config
npm run bundle
```

`npm run bundle` exports JavaScript/Hermes and assets, not an APK or IPA. Real-device checks, store billing, financial-provider deep-link return handling, dependency-advisory resolution and release hardening remain required. Packaging does not grant bank access or cancellation permission.

Official references: [EAS build profiles](https://docs.expo.dev/build/eas-json/), [Android APKs](https://docs.expo.dev/build-reference/apk/), [development builds](https://docs.expo.dev/develop/development-builds/introduction/), [app configuration](https://docs.expo.dev/workflow/configuration/).
