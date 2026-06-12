# Family HQ — mobile (Capacitor)

Native shell that **bundles** the web app (`../frontend`) and ships home-screen
**widgets** (Android now, iOS later). UI updates go out as Google Play releases.

> For the full publishing walkthrough (domain, Play Console, signing, upload),
> see **[GOOGLE_PLAY_RU.md](./GOOGLE_PLAY_RU.md)** (на русском).

## Architecture (short)
- Web UI (`../frontend`) is copied into `www/` by `scripts/sync-web.mjs`, mirroring
  the backend URL map (`/` → index.html, `/static/<x>` → frontend/`<x>`).
- API calls go to an **absolute backend origin** (`API_BASE`, set in
  `../frontend/app.js` under a `window.Capacitor` guard). No `server.url`.
- Auth: the app reuses the existing 30-day session token. `../frontend/auth.js`
  mirrors `fhq_session` into **Capacitor Preferences** so the native widget can read it.
- Widget: native (Android Jetpack Glance / iOS WidgetKit) → `GET /api/love`.

## Prerequisites
- **Node.js 18+**
- **Android Studio** (SDK + Gradle) — required to build/sign/run.

## First-time setup
```bash
cd mobile
npm install
npm run sync:web          # frontend/ -> www/
npx cap add android       # generates android/ (commit it afterwards)
```
Then add the native widget sources (see GOOGLE_PLAY_RU.md / the LoveWidget files)
and open the project:
```bash
npx cap open android
```

## Everyday loop
```bash
npm run sync              # sync web snapshot + cap sync
npx cap open android      # build / run / generate signed .aab in Android Studio
```
Shortcut: `npm run android:open` does sync + open.

## Before each release
1. Bump `versionCode` / `versionName` in `android/app/build.gradle`.
2. `npm run sync:web` (pull the latest frontend).
3. Android Studio → **Build → Generate Signed Bundle (.aab)** → upload to Play
   (Internal testing). See GOOGLE_PLAY_RU.md.

## Notes
- `www/`, `node_modules/`, and signing keystores are git-ignored. Commit `android/`
  (the native project incl. the widget) once generated.
- The service worker (`sw.js`) is harmless when bundled but unnecessary; if it
  misbehaves in the WebView, gate its registration in `app.js` behind `!window.Capacitor`.
- Capacitor version is pinned to 6.x in `package.json`; bump together if you upgrade.
