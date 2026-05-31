# toaster-andriod-beta-releases

Cloudflare Worker for Toaster Android beta APK distribution (R2 + CORS + versioning). **Does not host the onboarding UI** — that is on [Cloudflare Pages](../toaster-andriod-beta-pages/README.md).

- **Portal:** https://toaster.cloustan.org/toaster-andriod-beta/
- **APK CDN:** https://assets.toaster.andriod.beta.cloustan.org/
- **Public GET**: `releases.json`, APK files, S3-style `?list-type=2`
- **Authenticated POST** (CI / GitHub Actions): upload APKs and refresh manifest

## Deploy

```bash
cd toaster
npm run cf:deploy:andriod-beta-releases
npm run cf:deploy:andriod-beta-pages
npm run cf:deploy:andriod-beta-path
```

Set upload secret (required for POST):

```bash
npx wrangler secret put RELEASE_UPLOAD_SECRET --config ./cloudflare/toaster-andriod-beta-releases/wrangler.jsonc
```

### How authentication works

1. You store a random token in the Worker as **`RELEASE_UPLOAD_SECRET`** (Wrangler secret — not in git).
2. CI or your machine sends **`Authorization: Bearer <that-token>`** on `POST /api/releases/apk` or `POST /api/releases/manifest`.
3. The Worker compares the bearer token to `RELEASE_UPLOAD_SECRET` (constant-time). Wrong or missing token → **401**.
4. **GET** requests (download page, APK files, `releases.json`) stay **public** — no auth.

Local copy after first setup (gitignored): `cloudflare/toaster-andriod-beta-releases/.release-upload-secret.local`  
GitHub Actions: add the same value as repo secret `RELEASE_UPLOAD_SECRET`.

## APK naming

Use `toaster-beta-{versionCode}.apk` (e.g. `toaster-beta-4.apk`), matching `versionCode` in `android/app/build.gradle`.

## Authenticated upload (GitHub Actions)

```bash
curl -X POST "https://assets.toaster.andriod.beta.cloustan.org/api/releases/apk" \
  -H "Authorization: Bearer $RELEASE_UPLOAD_SECRET" \
  -H "X-Apk-Filename: toaster-beta-5.apk" \
  -H "Content-Type: application/vnd.android.package-archive" \
  --data-binary @app-release.apk
```

Response includes regenerated `releases.json` (`latest`, `builds`, `generatedAt`).

## Local dev

```bash
npm run cf:dev:andriod-beta-releases
```

Portal locally: build Pages output and use `wrangler pages dev`, or open `toaster-beta-apk.html` with `?local=1` for the APK Worker on `http://127.0.0.1:8787`.

Uses `--remote` so `wrangler dev` reads the real `toaster-android-beta` bucket.
