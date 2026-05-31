# Toaster Beta Android releases portal

Static GitHub Pages site for downloading the Toaster Android beta APK and walking through install steps.

**Live URL:** https://cloustan.github.io/toaster-beta-andriod-releases-portal/

APK files are served from the Cloudflare Worker + R2 bucket (`toaster-andriod-beta-releases`), not from this repo.

## Update the site from the main Toaster repo

```bash
cd toaster
npm run build:beta-apk-portal
# copy .beta-apk-portal-dist/* into this repository, commit, and push main
```

Pages deploys automatically on push to `main` via `.github/workflows/deploy-pages.yml`.

## GitHub Pages setup (one-time)

1. Repo **Settings → Pages → Build and deployment**: Source = **GitHub Actions**.
2. After the first successful workflow run, the site is available at the URL above.
