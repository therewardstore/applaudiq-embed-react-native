# ApplaudIQ Embed SDK — React Native

[![npm](https://img.shields.io/npm/v/@applaudiq/embed-react-native.svg)](https://www.npmjs.com/package/@applaudiq/embed-react-native)

📦 **npm:** [`@applaudiq/embed-react-native`](https://www.npmjs.com/package/@applaudiq/embed-react-native)

Embed the Applaud IQ recognition portal in a **React Native** app (bare RN CLI **or** Expo) with auto-login,
manual login, and native SSO. The SDK renders the portal in a `react-native-webview` and mirrors the iOS / Android
/ Web SDK bridge protocol.

- **Auto + manual login** — silent sign-in with a server-minted token, or the portal's own email/SSO login.
- **Native SSO** — Google / Microsoft via the system browser, returned to your app on your own deep-link scheme.
- **Callbacks** — `onReady` / `onAuthPending` / `onError` / `onClose` / `onSignOut`.
- Works with **bare React Native** and **Expo** (dev build).

---

## Build integration

### 1. Install

```sh
npm install @applaudiq/embed-react-native@^1.2.0 react-native-webview
# or
yarn add @applaudiq/embed-react-native@^1.2.0 react-native-webview
```

`react-native-webview` is a peer dependency. **Bare RN:** `cd ios && pod install`. **Expo:** `npx expo install
react-native-webview` and use a **dev build** (`npx expo run:ios` / `run:android`) — the WebView + custom URL
scheme don't work in Expo Go.

### 2. Register your SSO callback scheme

SSO opens in the system browser (Google/Microsoft reject WebView OAuth) and returns to your app via a deep link.
Pick a scheme **unique to your app** and register it natively — then pass it as `config.ssoCallback`. The SDK
sends it to the backend as `native_redirect`, so the callback returns to exactly your app (no "Open with" chooser
when two Applaud IQ apps are installed).

**Bare React Native:**

```xml
<!-- ios/<App>/Info.plist -->
<key>CFBundleURLTypes</key>
<array>
  <dict>
    <key>CFBundleURLSchemes</key>
    <array><string>myapp</string></array>
  </dict>
</array>
```

```xml
<!-- android/app/src/main/AndroidManifest.xml — inside your main <activity> -->
<intent-filter>
  <action android:name="android.intent.action.VIEW" />
  <category android:name="android.intent.category.DEFAULT" />
  <category android:name="android.intent.category.BROWSABLE" />
  <data android:scheme="myapp" android:host="sso-callback" />
</intent-filter>
```

**Expo** — one line in `app.json` (configures both platforms):

```json
{ "expo": { "scheme": "myapp" } }
```

### 3. Import

```tsx
import { ApplaudIQEmbed } from '@applaudiq/embed-react-native';
```

### 4. Present the embed

```tsx
import { ApplaudIQEmbed } from '@applaudiq/embed-react-native';

export function Recognition({ embedToken }: { embedToken?: string }) {
  return (
    <ApplaudIQEmbed
      config={{
        key: 'pk_live_…',                     // publishable key from HR → Settings → Embed SDK Keys
        baseUrl: 'https://recognize.applaudiq.com',
        ssoCallback: 'myapp://sso-callback',  // your scheme from step 2
      }}
      token={embedToken}        // auto mode only — minted on your server (omit for manual)
      mode="auto"               // 'auto' | 'manual'
      onReady={() => {}}
      onAuthPending={() => {}}  // signed in, awaiting HR approval
      onError={(msg) => {}}     // bad key/token OR a failed SSO sign-in
      onClose={() => {}}
      onSignOut={() => {}}      // user signed out of an auto embed
    />
  );
}
```

- **Manual login** — pass only `config` (+ `mode="manual"`); the portal's own email/SSO login renders inside the
  embed. No token, no server.
- **Auto-login** — your **backend** mints a one-time `embedToken` (`POST <baseUrl>/api/v1/embed/sessions` with the
  `aiq_embed_…` secret — server-side only, single-use, ~60s) and you pass it as `token`.

### 5. SSO flow

Tapping **Continue with Google / Microsoft** opens the system browser (`Linking.openURL`). On success the one-time
code returns on `myapp://sso-callback?code=…` and is exchanged inside the WebView (`onReady`). On failure (e.g. the
wrong account) the SDK fires `onError(message)` and reloads the login so the user can retry.

---

## Security model

The SDK applies the same WebView hardening as the iOS and Android SDKs, so a consuming app gets a confined,
trustworthy embed out of the box:

- **The WebView is pinned to the portal origin.** Only the portal (`baseUrl`) loads in the main frame; any
  off-origin top-level link opens in the **system browser** instead, so an open-redirect can't move the
  authenticated session onto another page inside the WebView. (Sub-resources like reCAPTCHA, fonts, and analytics
  still load in place.)
- **The native bridge runs only on the portal origin.** The `postMessage` bridge and the `window.__APPLAUDIQ_EMBED__`
  flag are installed only when the page is the portal — a navigated-to page never receives them.
- **Only the portal can drive the bridge.** Every incoming message is checked against the sender's origin before it
  is processed, so a foreign page can't spoof the handshake or trigger SSO.
- **SSO runs in the system browser, not the WebView.** Google and Microsoft reject WebView OAuth; the one-time code
  returns on your `ssoCallback` deep link and is exchanged inside the WebView (cookies stay in its store).
- **The publishable key is browser-safe.** Only the `pk_…` key lives in the app; the `aiq_embed_…` server secret
  must never be embedded (mint tokens on your backend).
- **`baseUrl` must use HTTPS.** A plain-`http://` base is rejected with `onError('insecure_base_url')` and nothing
  loads — except `localhost`/`127.0.0.1`/`10.0.2.2` in a dev build (`__DEV__`) for local testing.
- The WebView additionally disables file access, mixed content, and pop-up/new-window creation.

---

## Downloads & external links

When the portal (or the reward store nested inside it) needs to open a URL outside the WebView —
a file download, a payment page, or an OAuth handoff — it sends the `applaudiq:open-external` bridge
message with payload `{ url }`. The SDK opens `http(s)` URLs in the **system browser**
(`Linking.openURL`). No app code is required.

---

## Test integration

- Run on a simulator/device. **Manual login works with just the publishable key** — no server.
- For auto-login, point your app at a backend that mints a token, or test with a token minted via curl.
- A brand-new employee signs in but sees a **pending HR approval** screen until an HR admin approves them
  (`onAuthPending` fires).
- Runnable examples (bare RN **and** Expo) live in
  [`applaudiq-sdk-example`](https://github.com/therewardstore/applaudiq-sdk-example/tree/master/native-integration/react-native-cli) under
  `native-integration/react-native-cli/` and `native-integration/react-native-expo/`.

## Go-live checklist

- Use a `pk_live_…` key and your production `baseUrl` (HTTPS).
- Auto-login: a real server-side mint endpoint — never embed the `aiq_embed_…` secret in the app.
- SSO: register a **unique** `ssoCallback` scheme natively and pass it as `config.ssoCallback`.

---

## API

| Prop | Type | Notes |
|------|------|-------|
| `config.key` | `string` | Publishable key (`pk_live_…` / `pk_test_…`). Required, both modes. |
| `config.baseUrl` | `string?` | Portal origin. Default `https://recognize.applaudiq.com`. |
| `config.ssoCallback` | `string?` | Your app's deep link, e.g. `myapp://sso-callback`. Required for SSO. |
| `token` | `string?` | One-time `embedToken` (auto mode only). |
| `mode` | `'auto' \| 'manual'` | Default `'auto'`. |
| `onReady` | `() => void` | Signed in & rendered. |
| `onAuthPending` | `() => void` | Signed in, awaiting HR approval. |
| `onError` | `(message) => void` | Bad/expired key or token, blocked load, or a failed SSO sign-in. |
| `onClose` | `() => void` | Embed dismissed. |
| `onSignOut` | `() => void` | User signed out of an auto / host-managed embed. |
| `backNavigation` | `boolean?` | Default `true` — Android hardware Back + iOS edge-swipe traverse embed history. |

---

## Changelog

Latest: **v1.2.0 (LTS)**. See [CHANGELOG.md](./CHANGELOG.md) for the full release history (also shown on the npm page).

---

MIT licensed. Peer deps: `react`, `react-native`, `react-native-webview`.
