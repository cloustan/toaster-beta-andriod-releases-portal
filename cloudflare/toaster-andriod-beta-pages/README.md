# Toaster Android beta portal (Cloudflare Pages)

Static onboarding UI for the Android beta APK. **APK files stay on the R2 Worker** (`toaster-andriod-beta-releases`), not on Pages.

## URLs

| URL | Role |
|-----|------|
| https://toaster.cloustan.org/toaster-andriod-beta/ | Production portal (Pages + path route Worker) |
| https://toaster-andriod-beta.pages.dev/toaster-andriod-beta/ | Pages preview host |
| https://assets.toaster.andriod.beta.cloustan.org/ | APK + `releases.json` API (R2 Worker) |

## Build & deploy

```bash
cd toaster
npm run build:beta-apk-portal
```

This writes:

- `cloudflare/toaster-andriod-beta-pages/dist/` — for `wrangler pages deploy`
- `toaster-andriod-beta/` — copy into the main **toaster** Pages site (Git deploy to `toaster.cloustan.org`)

### Production on toaster.cloustan.org (recommended)

The `toaster` Pages project already uses `toaster.cloustan.org`. After `npm run build:beta-apk-portal`, commit the generated `toaster-andriod-beta/` folder and push; Pages will serve **https://toaster.cloustan.org/toaster-andriod-beta/**.

### Standalone Pages project (optional preview)

```bash
npm run cf:deploy:andriod-beta-pages
npm run cf:deploy:andriod-beta-path   # only if not using the main toaster Pages folder
```

### APK API (R2 Worker, not Pages)

```bash
npm run cf:deploy:andriod-beta-releases
```
