# Changelog

All notable changes to `@applaudiq/embed-react-native` are documented here. This project follows
[Semantic Versioning](https://semver.org/).

## [1.0.0]

First published release — full parity with the iOS + Android SDKs, for **bare React Native and Expo**.

- **Auto + manual login** in a `react-native-webview`, mirroring the web/iOS/Android bridge protocol (embed URL
  carries `mode`/`k`/`token`; `window.__APPLAUDIQ_EMBED__` injected at document start).
- **Native SSO, end to end** — `applaudiq:sso-request` opens the system browser
  (`…/auth/sso/{provider}/employee/authorize?native=1&client_id=&login_hint=&native_redirect=…`, provider
  allowlisted to google/microsoft); the one-time code returns on your app's `config.ssoCallback` deep link and is
  **exchanged inside the WebView**, then the portal reloads. On failure (`?error=`) the SDK fires `onError` and
  reloads the login.
- **Per-app callback scheme** via `config.ssoCallback` (registered natively — Info.plist/manifest, or Expo
  `scheme`) so two Applaud IQ apps never collide on the callback.
- **Callbacks:** `onReady` / `onAuthPending` / `onError` / `onClose` / `onSignOut`; `backNavigation` (Android
  hardware Back + iOS edge-swipe).
- **Security (WebView hardening at iOS/Android parity):**
  - Main frame **pinned to the portal origin** — off-origin top-level navigations open in the system browser, not
    in the WebView (`onShouldStartLoadWithRequest`).
  - The native bridge + `window.__APPLAUDIQ_EMBED__` flag are **origin-gated** — installed only on the portal page.
  - Incoming bridge messages are **origin-checked** (sender must be the portal) before being processed.
  - Plain-`http://` `baseUrl` is **rejected** with `onError('insecure_base_url')` (localhost allowed only in
    `__DEV__`).
  - WebView locked down: no mixed content, no file access, no pop-up/new-window creation, no link preview.
