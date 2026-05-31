# toaster-beta-andriod-releases-portal

Mirror of the Toaster Android beta portal (Cloudflare Pages), R2 release Worker, and path route Worker.

## Live URLs

| URL | Purpose |
|-----|---------|
| https://toaster.cloustan.org/toaster-andriod-beta/ | Beta onboarding UI (Cloudflare Pages) |
| https://assets.toaster.andriod.beta.cloustan.org/ | APK downloads + `releases.json` (R2 Worker) |

## Build static site

```bash
node tools/build-beta-apk-portal.mjs
```

Built output is in `site/` (synced from `cloudflare/toaster-andriod-beta-pages/dist`).

## Deploy Workers

```bash
npx wrangler deploy --config cloudflare/toaster-andriod-beta-releases/wrangler.jsonc
npx wrangler pages deploy site --project-name toaster-andriod-beta
npx wrangler deploy --config cloudflare/toaster-andriod-beta-pages/route-worker/wrangler.jsonc
```

Canonical development: https://github.com/cloustan/toaster
