import type { CapacitorConfig } from '@capacitor/cli';

// Moya native shell (the productized Family HQ for other families). The web UI
// (frontend/) is BUNDLED into the app (webDir:
// 'www', filled by scripts/sync-web.mjs) — UI updates ship via Google Play releases,
// not server.url. The app talks to the backend API at an absolute origin (set in
// frontend/app.js via API_BASE under a window.Capacitor guard); CORS is enabled
// server-side. No server.url here on purpose (keeps the app self-contained → passes
// Play "minimum functionality" cleanly, and the native widget is the real native
// value).
const config: CapacitorConfig = {
  appId: 'com.moyafamily.app',
  appName: 'Moya',
  webDir: 'www',
  plugins: {
    // Native Google Sign-In (reliable in the WebView, unlike web GIS). serverClientId
    // is the WEB OAuth client ID — the idToken's `aud` must equal the backend's
    // GOOGLE_CLIENT_ID. The Android OAuth client (package + SHA-1) authorizes the build.
    GoogleAuth: {
      scopes: ['profile', 'email'],
      serverClientId: '1030641400311-s5l41k0cefti2v50e4on709au0nj3485.apps.googleusercontent.com',
      forceCodeForRefreshToken: false,
    },
  },
};

export default config;
