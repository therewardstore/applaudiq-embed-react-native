/**
 * @applaudiq/embed-react-native — renders the full Applaud IQ portal in a
 * react-native-webview with auto / manual login + native SSO. Mirrors the web,
 * iOS, and Android SDK bridge protocol.
 *
 *   <ApplaudIQEmbed
 *     config={{ key: 'pk_live_xxx', ssoCallback: 'myapp://sso-callback' }}
 *     token={embedToken}              // auto mode — from your backend /embed/sessions
 *     mode="auto"                     // 'auto' | 'manual'
 *     onReady={...} onAuthPending={...} onError={...} onClose={...} onSignOut={...}
 *   />
 *
 * SSO opens in the SYSTEM BROWSER (Google/Microsoft reject WebView OAuth). The
 * one-time code returns on YOUR app's `ssoCallback` deep link (registered natively —
 * RN CLI: Info.plist / AndroidManifest; Expo: `scheme` in app.json) and is exchanged
 * inside the WebView. On failure (?error=) the SDK fires onError + reloads the login.
 *
 * Peer deps: react, react-native, react-native-webview.
 */
import React, { useCallback, useEffect, useRef } from 'react';
import { BackHandler, Linking, Platform, View } from 'react-native';
import {
  WebView,
  type WebViewMessageEvent,
  type WebViewNavigation,
} from 'react-native-webview';

/** The `onShouldStartLoadWithRequest` arg = navigation + the iOS-only `isTopFrame` flag. */
type ShouldStartLoadRequest = WebViewNavigation & { isTopFrame?: boolean };

export interface EmbedConfig {
  /** Publishable key (`pk_live_…` / `pk_test_…`) from HR → Settings → Embed SDK Keys. */
  key: string;
  /** Portal origin. Defaults to https://recognize.applaudiq.com. */
  baseUrl?: string;
  /**
   * YOUR app's SSO callback deep link, e.g. `myapp://sso-callback`. Register the scheme
   * natively (RN CLI: iOS Info.plist `CFBundleURLTypes` + Android manifest intent-filter;
   * Expo: `"scheme": "myapp"` in app.json). The SDK sends it to the backend as
   * `native_redirect` so the SSO callback returns to exactly your app — no "Open with"
   * chooser when two Applaud IQ apps are installed. Required for SSO.
   */
  ssoCallback?: string;
}

export interface ApplaudIQEmbedProps {
  config: EmbedConfig;
  token?: string;
  mode?: 'auto' | 'manual';
  onReady?: () => void;
  onClose?: () => void;
  /** Bad/expired key or token, blocked load, OR a failed SSO sign-in. */
  onError?: (message: string) => void;
  onAuthPending?: () => void;
  /** The user signed out of an auto / host-managed embed — tear down your app's session. */
  onSignOut?: () => void;
  /**
   * When true (default), the platform back affordance traverses the embed's in-app
   * history: Android hardware Back goes back in the WebView (until the root), and the
   * iOS left-edge swipe is enabled. Set false to keep the platform default.
   */
  backNavigation?: boolean;
}

const DEFAULT_BASE = 'https://recognize.applaudiq.com';
const SSO_PROVIDERS = ['google', 'microsoft'];

// ---- pure URL/parse helpers (mirror iOS EmbedInternals / Android EmbedInternals) ----

/** `scheme://host[:port]` for a URL, or null if it can't be parsed (mirror Android `originOf`). */
function originOf(url: string | null | undefined): string | null {
  if (!url) return null;
  const m = url.match(/^([a-z][a-z0-9.+-]*):\/\/([^/?#]+)/i);
  if (!m) return null;
  return `${m[1].toLowerCase()}://${m[2].toLowerCase()}`;
}

/** Same scheme+host(+port) (mirror Android `sameOrigin`). Both must parse. */
function sameOrigin(a: string | null | undefined, b: string | null | undefined): boolean {
  const oa = originOf(a);
  const ob = originOf(b);
  return oa != null && oa === ob;
}

/**
 * The portal must be served over TLS. `http://` is allowed only for localhost-class hosts and only
 * in a dev build (`__DEV__`) — mirrors iOS `isPortalURL` (#if DEBUG) / Android `isSecureBaseUrl`
 * (FLAG_DEBUGGABLE). Rejecting a plain-http `baseUrl` stops an attacker origin from hosting the embed.
 */
function isSecureBaseUrl(url: string): boolean {
  const m = url.match(/^([a-z][a-z0-9.+-]*):\/\/([^/?#:]+)/i);
  if (!m) return false;
  const scheme = m[1].toLowerCase();
  const host = m[2].toLowerCase();
  if (scheme === 'https') return true;
  const localhost = host === 'localhost' || host === '127.0.0.1' || host === '10.0.2.2';
  // eslint-disable-next-line no-undef
  return scheme === 'http' && localhost && typeof __DEV__ !== 'undefined' && __DEV__;
}

/** `<baseUrl>/embed?mode={auto|manual}&k={key}` (+ `&token=` in auto, + `&env=test` for pk_test_ keys). */
function buildEmbedUrl(base: string, mode: string, key: string, token?: string): string {
  const m = mode === 'manual' ? 'manual' : 'auto';
  let url = `${base}/embed?mode=${m}`;
  if (key) url += `&k=${encodeURIComponent(key)}`;
  if (m === 'auto' && token) url += `&token=${encodeURIComponent(token)}`;
  if (key && key.startsWith('pk_test_')) url += `&env=test`;
  return url;
}

/** `<baseUrl>/api/v1/auth/sso/{provider}/employee/authorize?native=1[&client_id=][&login_hint=][&native_redirect=]`. */
function buildSsoUrl(
  base: string,
  provider: string,
  clientId?: string | null,
  email?: string | null,
  nativeRedirect?: string | null,
): string {
  const p = SSO_PROVIDERS.includes(provider.toLowerCase()) ? provider.toLowerCase() : 'google';
  let url = `${base}/api/v1/auth/sso/${p}/employee/authorize?native=1`;
  if (clientId && clientId !== 'null') url += `&client_id=${encodeURIComponent(clientId)}`;
  if (email) url += `&login_hint=${encodeURIComponent(email)}`;
  if (nativeRedirect) url += `&native_redirect=${encodeURIComponent(nativeRedirect)}`;
  return url;
}

/** True when `url` is THIS app's SSO callback (scheme + host match `callback`), regardless of query. */
function isSsoCallback(url: string | null, callback: string | undefined): boolean {
  if (!url || !callback) return false;
  return url.split('?')[0] === callback.split('?')[0];
}

/** Pull a single decoded query param from the callback deep link; null otherwise. */
function callbackParam(url: string, key: 'code' | 'error'): string | null {
  // Stop at `&` AND `#`: the browser/OS appends an empty `#` fragment to the custom-scheme callback,
  // and a query value never contains a raw `#` (it'd be %23), so the fragment must not be captured.
  const m = url.match(new RegExp(`[?&]${key}=([^&#]+)`));
  if (!m || !m[1]) return null;
  // Query values encode spaces as `+` (form-urlencoding); decodeURIComponent only handles `%20`, so
  // normalize `+`→space first or the gateway's error message renders with literal `+` between words.
  const raw = m[1].replace(/\+/g, ' ');
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

// Injected at document start: forward window.parent.postMessage → RN, and set the native
// flag/mode the portal reads (isNativeEmbed / embedMode). ORIGIN-GATED — the bridge installs only
// on the portal origin (mirror iOS `forMainFrameOnly:true` + Android `onPageStarted` sameOrigin),
// so a navigated-to off-origin page never receives the bridge or the native flag.
function injectedBridge(mode: string, origin: string | null): string {
  const m = mode === 'manual' ? 'manual' : 'auto';
  return `
    if (window.location.origin === ${JSON.stringify(origin || '')}) {
      window.parent = window.parent || window;
      window.parent.postMessage = function(data){
        try { window.ReactNativeWebView.postMessage(JSON.stringify(data)); } catch(e){}
      };
      window.__APPLAUDIQ_EMBED__ = { mode: ${JSON.stringify(m)}, native: true };
    }
    true;
  `;
}

export function ApplaudIQEmbed(props: ApplaudIQEmbedProps): React.ReactElement {
  const {
    config,
    token,
    mode = 'auto',
    onReady,
    onClose,
    onError,
    onAuthPending,
    onSignOut,
    backNavigation = true,
  } = props;
  const base = (config.baseUrl || DEFAULT_BASE).replace(/\/$/, '');
  const baseOrigin = originOf(base);
  const secureBase = isSecureBaseUrl(base);
  const embedUrl = buildEmbedUrl(base, mode, config.key, token);
  const ref = useRef<WebView>(null);
  const canGoBack = useRef(false);
  const ssoInFlight = useRef(false);
  const readyFired = useRef(false);
  const insecureFired = useRef(false);

  // The portal MUST be served over TLS (https; http only for localhost in a dev build). A plain-http
  // baseUrl is rejected before anything loads — fire onError once and render nothing, never the
  // WebView. Mirrors iOS onError("insecure_base_url") / Android isSecureBaseUrl.
  useEffect(() => {
    if (!secureBase && !insecureFired.current) {
      insecureFired.current = true;
      onError?.('insecure_base_url');
    }
  }, [secureBase, onError]);

  // Android hardware Back → step back in the embed's WebView history (until the root,
  // where the default exit/pop runs). iOS uses the edge-swipe prop on <WebView> below.
  useEffect(() => {
    if (!backNavigation || Platform.OS !== 'android') return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (canGoBack.current) {
        ref.current?.goBack();
        return true;
      }
      return false;
    });
    return () => sub.remove();
  }, [backNavigation]);

  const sendToEmbed = useCallback((type: string, payload?: unknown) => {
    const msg = JSON.stringify({ source: 'applaudiq-sdk', type, payload });
    ref.current?.injectJavaScript(
      `window.dispatchEvent(new MessageEvent('message',{data:${msg},origin:location.origin}));true;`,
    );
  }, []);

  // Redeem the one-time SSO code INSIDE the WebView (same-origin fetch) so the session
  // cookies land in the WebView's own store, then reload so the authenticated portal renders.
  const completeSSO = useCallback(
    (code: string) => {
      const js = `(async function(){
        try {
          const r = await fetch('/api/v1/employee/auth/sso/exchange', {
            method:'POST', credentials:'include',
            headers:{'Content-Type':'application/json'},
            body: JSON.stringify({ code: ${JSON.stringify(code)} })
          });
          if (!r.ok) throw new Error('sso_exchange_failed');
          window.location.replace('/');
        } catch(e) {
          window.ReactNativeWebView.postMessage(JSON.stringify({
            source:'applaudiq-embed', type:'applaudiq:error', payload:{ message:'sso_exchange_failed' }
          }));
        }
      })(); true;`;
      ref.current?.injectJavaScript(js);
    },
    [],
  );

  const openSSO = useCallback(
    (provider: string, clientId?: string | null, email?: string | null) => {
      const url = buildSsoUrl(base, provider, clientId, email, config.ssoCallback);
      ssoInFlight.current = true;
      void Linking.openURL(url).catch(() => {
        ssoInFlight.current = false;
      });
    },
    [base, config.ssoCallback],
  );

  // SSO deep-link return: <ssoCallback>?code=… (success) or ?error=… (failure).
  useEffect(() => {
    const handle = (url: string | null) => {
      if (!url || !ssoInFlight.current) return; // ignore stray deep links when no SSO is pending
      if (!isSsoCallback(url, config.ssoCallback)) return;
      const code = callbackParam(url, 'code');
      if (code) {
        ssoInFlight.current = false;
        completeSSO(code);
        return;
      }
      // Failure / identity-mismatch: surface it to the host AND show the failure on the FRAMEABLE embed page,
      // which renders the "Authentication Failed" card (parity with the web/iOS/Android/Capacitor SDKs). The
      // portal's /sso-callback page is X-Frame-Options: DENY so it can't be reused by the Capacitor iframe; all
      // SDKs route SSO errors through the embed page. "Return to login" retries in the embed login.
      ssoInFlight.current = false;
      const msg = callbackParam(url, 'error') || 'sso_failed';
      onError?.(msg);
      const errUrl = `${embedUrl}&sso_error=${encodeURIComponent(msg)}`;
      ref.current?.injectJavaScript(`window.location.replace(${JSON.stringify(errUrl)});true;`);
    };
    const sub = Linking.addEventListener('url', (e) => handle(e.url));
    void Linking.getInitialURL().then(handle);
    return () => sub.remove();
  }, [config.ssoCallback, completeSSO, onError, embedUrl]);

  const onMessage = useCallback(
    (e: WebViewMessageEvent) => {
      // Only the portal origin may drive the native bridge — a navigated-away / off-origin page must
      // not spoof the handshake or trigger SSO. Mirrors iOS frameInfo.securityOrigin.host check +
      // Android sameOrigin(webView.url, baseUrl).
      if (!sameOrigin(e.nativeEvent.url, base)) return;
      let d: {
        source?: string;
        type?: string;
        payload?: { provider?: string; clientId?: unknown; email?: string; message?: string };
      };
      try {
        d = JSON.parse(e.nativeEvent.data);
      } catch {
        return;
      }
      if (d.source !== 'applaudiq-embed') return;
      switch (d.type) {
        case 'applaudiq:ready':
        case 'applaudiq:authenticated':
          if (mode === 'auto' && token) sendToEmbed('applaudiq:init-token', { token });
          if (!readyFired.current) {
            readyFired.current = true;
            onReady?.();
          }
          break;
        case 'applaudiq:auth-pending':
          onAuthPending?.();
          break;
        case 'applaudiq:error':
          onError?.(d.payload?.message || 'error');
          break;
        case 'applaudiq:close':
          onClose?.();
          break;
        case 'applaudiq:signout':
          onSignOut?.();
          break;
        case 'applaudiq:sso-request': {
          const raw = (d.payload?.provider || 'google').toLowerCase();
          const provider = SSO_PROVIDERS.includes(raw) ? raw : 'google';
          const rawClient = d.payload?.clientId;
          const clientId =
            rawClient == null ? null : typeof rawClient === 'string' ? rawClient : String(rawClient);
          openSSO(provider, clientId, d.payload?.email || null);
          break;
        }
        case 'applaudiq:resize':
          break; // no-op on full-screen native
      }
    },
    [base, mode, token, sendToEmbed, openSSO, onReady, onError, onClose, onAuthPending, onSignOut],
  );

  // Pin the MAIN FRAME to the portal origin: off-origin top-level navigations open in the SYSTEM
  // browser (not in-WebView), so an open-redirect can't move the authenticated session + bridge onto
  // an attacker page. Sub-resources (reCAPTCHA, fonts, analytics) load in place. Mirrors iOS
  // decidePolicyFor + Android shouldOverrideUrlLoading/route().
  const onShouldStartLoadWithRequest = useCallback(
    (req: ShouldStartLoadRequest): boolean => {
      // react-native-webview sets isTopFrame on iOS; on Android this fires for main-frame nav only.
      if (req.isTopFrame === false) return true;
      const url = req.url || '';
      if (url.startsWith('about:') || url.startsWith('data:') || sameOrigin(url, base)) return true;
      if (url.startsWith('http://') || url.startsWith('https://')) void Linking.openURL(url);
      return false;
    },
    [base],
  );

  // Insecure baseUrl → render nothing (onError already fired). Never load the WebView over plain http.
  if (!secureBase) return <View />;

  return (
    <WebView
      ref={ref}
      source={{ uri: embedUrl }}
      injectedJavaScriptBeforeContentLoaded={injectedBridge(mode, baseOrigin)}
      onMessage={onMessage}
      onShouldStartLoadWithRequest={onShouldStartLoadWithRequest}
      onNavigationStateChange={(s) => {
        canGoBack.current = s.canGoBack;
      }}
      allowsBackForwardNavigationGestures={backNavigation}
      allowsLinkPreview={false}
      // Confine top-level loads to the portal origin (defense-in-depth; the nav guard above is the
      // real enforcement). Sub-resources are not affected by originWhitelist.
      originWhitelist={[base]}
      // Lock the WebView down (mirror Android WebSettings): no mixed content, no file access, no
      // popups/new-windows. domStorage + JS stay on — the portal is a JS app and needs them.
      mixedContentMode="never"
      allowFileAccess={false}
      allowFileAccessFromFileURLs={false}
      allowUniversalAccessFromFileURLs={false}
      setSupportMultipleWindows={false}
      javaScriptCanOpenWindowsAutomatically={false}
      domStorageEnabled
      javaScriptEnabled
    />
  );
}

export default ApplaudIQEmbed;
