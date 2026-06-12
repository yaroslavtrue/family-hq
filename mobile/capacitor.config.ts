import type { CapacitorConfig } from '@capacitor/cli';

// Family HQ native shell. The web UI (frontend/) is BUNDLED into the app (webDir:
// 'www', filled by scripts/sync-web.mjs) — UI updates ship via Google Play releases,
// not server.url. The app talks to the backend API at an absolute origin (set in
// frontend/app.js via API_BASE under a window.Capacitor guard); CORS is enabled
// server-side. No server.url here on purpose (keeps the app self-contained → passes
// Play "minimum functionality" cleanly, and the native widget is the real native
// value).
const config: CapacitorConfig = {
  appId: 'com.familyhq.app',
  appName: 'Family HQ',
  webDir: 'www',
};

export default config;
