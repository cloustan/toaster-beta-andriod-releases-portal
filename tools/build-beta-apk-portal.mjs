import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const BASE_PATH = '/toaster-andriod-beta';
const outRoot = path.resolve(root, 'cloudflare/toaster-andriod-beta-pages/dist');
const outDir = path.join(outRoot, BASE_PATH.slice(1));
const toasterPagesDir = path.join(root, BASE_PATH.slice(1));

const COPY_FILES = [
  'brand-nav.js',
  'theme-sync.js',
  'auth.js',
  'report.html'
];

const COPY_IMG = [
  'favicon.png',
  'toaster-pill-logo.png',
  'toaster-logo-pill.png',
  'toaster-onboarding.png',
  'appicon.png'
];

const APK_ASSETS_ORIGIN = 'https://assets.toaster.andriod.beta.cloustan.org';

function withBaseHref(html) {
  if (/<base\s/i.test(html)) {
    return html.replace(
      /<base\s[^>]*>/i,
      `<base href="${BASE_PATH}/">`
    );
  }
  return html.replace(/<head([^>]*)>/i, `<head$1>\n    <base href="${BASE_PATH}/">`);
}

function patchPortalHtml(html) {
  let out = withBaseHref(html);
  out = out.replace(
    /return 'https:\/\/assets\.toaster\.andriod\.beta\.cloustan\.org';/g,
    `return '${APK_ASSETS_ORIGIN}';`
  );
  out = out.replace(
    /window\.location\.href = 'https:\/\/toaster\.cloustan\.org';/g,
    `window.location.href = '${BASE_PATH}/';`
  );
  return out;
}

function patchReportHtml(html) {
  return withBaseHref(html);
}

async function writePortalTree(targetDir) {
  await rm(targetDir, { recursive: true, force: true });
  await mkdir(path.join(targetDir, 'img'), { recursive: true });

  const indexHtml = patchPortalHtml(
    await readFile(path.join(root, 'toaster-beta-apk.html'), 'utf8')
  );
  await writeFile(path.join(targetDir, 'index.html'), indexHtml, 'utf8');

  for (const file of COPY_FILES) {
    const raw = await readFile(path.join(root, file), 'utf8');
    const patched = file === 'report.html' ? patchReportHtml(raw) : withBaseHref(raw);
    await writeFile(path.join(targetDir, file), patched, 'utf8');
  }

  for (const file of COPY_IMG) {
    await cp(path.join(root, 'img', file), path.join(targetDir, 'img', file));
  }

  const manifest = JSON.parse(await readFile(path.join(root, 'manifest.json'), 'utf8'));
  manifest.start_url = `${BASE_PATH}/index.html`;
  manifest.scope = `${BASE_PATH}/`;
  manifest.name = 'Toaster Beta for Android';
  manifest.short_name = 'Toaster Beta';
  await writeFile(
    path.join(targetDir, 'manifest.json'),
    JSON.stringify(manifest, null, 2) + '\n',
    'utf8'
  );
}

async function main() {
  await rm(outRoot, { recursive: true, force: true });
  await writePortalTree(outDir);
  await writePortalTree(toasterPagesDir);

  await writeFile(
    path.join(outRoot, '_redirects'),
    `${BASE_PATH} ${BASE_PATH}/ 301\n`,
    'utf8'
  );

  await writeFile(
    path.join(outRoot, 'index.html'),
    `<!DOCTYPE html><html><head><meta http-equiv="refresh" content="0;url=${BASE_PATH}/"><script>location.replace("${BASE_PATH}/")</script></head><body></body></html>\n`,
    'utf8'
  );

  console.log('Beta APK portal built for Cloudflare Pages at:', outDir);
  console.log('Live path:', `https://toaster.cloustan.org${BASE_PATH}/`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
