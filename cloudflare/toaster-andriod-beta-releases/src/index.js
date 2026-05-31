import {
  isToasterAllowedOrigin,
  corsAllowOriginHeader
} from '../../worker-cors-origins.mjs';

const MANIFEST_KEYS = new Set(['releases.json']);

const APK_NAME_RE = /^toaster-beta-\d+\.apk$/i;

function extractBuildNumber(filename) {
  const name = String(filename || '').split('/').pop();
  const matches = name.match(/\d+/g);
  if (!matches || !matches.length) return 0;
  return Math.max(...matches.map(Number));
}

function corsHeaders(request, extraMethods = 'GET, HEAD, OPTIONS') {
  const origin = request.headers.get('Origin');
  const allow = isToasterAllowedOrigin(origin)
    ? origin
    : corsAllowOriginHeader(request);
  return {
    'Access-Control-Allow-Origin': allow,
    'Access-Control-Allow-Methods': extraMethods,
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Apk-Filename',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin'
  };
}

function jsonResponse(request, body, status = 200, extraMethods) {
  const headers = new Headers(corsHeaders(request, extraMethods));
  headers.set('Content-Type', 'application/json; charset=utf-8');
  headers.set('Cache-Control', status === 200 ? 'public, max-age=60' : 'no-store');
  return new Response(JSON.stringify(body), { status, headers });
}

function safeEqual(a, b) {
  const left = String(a || '');
  const right = String(b || '');
  if (left.length !== right.length) return false;
  const enc = new TextEncoder();
  const ba = enc.encode(left);
  const bb = enc.encode(right);
  let diff = 0;
  for (let i = 0; i < ba.length; i++) diff |= ba[i] ^ bb[i];
  return diff === 0;
}

function isAuthorized(request, env) {
  const secret = env.RELEASE_UPLOAD_SECRET;
  if (!secret) return false;
  const header = request.headers.get('Authorization') || '';
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  return token && safeEqual(token, secret);
}

async function listApkObjects(bucket) {
  const releases = [];
  let cursor;
  do {
    const page = await bucket.list({ cursor, limit: 1000 });
    for (const obj of page.objects) {
      if (!/\.apk$/i.test(obj.key)) continue;
      const build = extractBuildNumber(obj.key);
      releases.push({
        file: obj.key,
        build,
        label: 'Build ' + build,
        uploadedAt: obj.uploaded ? new Date(obj.uploaded).toISOString() : ''
      });
    }
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);

  releases.sort((a, b) => {
    if (b.build !== a.build) return b.build - a.build;
    return String(b.file).localeCompare(String(a.file));
  });
  return releases;
}

async function buildManifest(bucket) {
  const builds = await listApkObjects(bucket);
  const latest = builds[0] ? builds[0].file : null;
  return { latest, builds, generatedAt: new Date().toISOString() };
}

async function persistManifest(bucket, manifest) {
  await bucket.put('releases.json', JSON.stringify(manifest, null, 2), {
    httpMetadata: { contentType: 'application/json; charset=utf-8' }
  });
}

function normalizeApkKey(raw) {
  const key = String(raw || '')
    .trim()
    .replace(/^\/+/, '');
  if (!APK_NAME_RE.test(key)) return null;
  return key;
}

function s3ListXml(keys) {
  const items = keys
    .map((key) => `  <Contents><Key>${escapeXml(key)}</Key></Contents>`)
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<ListBucketResult>\n${items}\n</ListBucketResult>`;
}

function escapeXml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

async function handleReleasePost(request, env) {
  const cors = corsHeaders(request, 'GET, HEAD, OPTIONS, POST');
  const methods = 'GET, HEAD, OPTIONS, POST';

  if (!isAuthorized(request, env)) {
    return jsonResponse(request, { error: 'Unauthorized' }, 401, methods);
  }

  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, '') || '/';

  if (path === '/api/releases/manifest') {
    let manifest;
    try {
      manifest = await request.json();
    } catch {
      return jsonResponse(request, { error: 'Expected JSON manifest body' }, 400, methods);
    }
    await persistManifest(env.BETA_APK_BUCKET, manifest);
    return jsonResponse(request, { ok: true, stored: 'releases.json' }, 200, methods);
  }

  if (path === '/api/releases/apk' || path === '/api/releases') {
    const filename =
      request.headers.get('X-Apk-Filename') ||
      url.searchParams.get('file') ||
      url.searchParams.get('filename');
    const key = normalizeApkKey(filename);
    if (!key) {
      return jsonResponse(
        request,
        {
          error: 'Invalid or missing APK filename',
          expected: 'toaster-beta-{versionCode}.apk',
          hint: 'Set X-Apk-Filename header or ?file= query param'
        },
        400,
        methods
      );
    }

    const body = await request.arrayBuffer();
    if (!body || !body.byteLength) {
      return jsonResponse(request, { error: 'Empty APK body' }, 400, methods);
    }

    await env.BETA_APK_BUCKET.put(key, body, {
      httpMetadata: {
        contentType: 'application/vnd.android.package-archive'
      }
    });

    const manifest = await buildManifest(env.BETA_APK_BUCKET);
    await persistManifest(env.BETA_APK_BUCKET, manifest);

    return jsonResponse(
      request,
      {
        ok: true,
        file: key,
        build: extractBuildNumber(key),
        manifest
      },
      200,
      methods
    );
  }

  return jsonResponse(request, { error: 'Not found' }, 404, methods);
}

async function handlePublicGet(request, env) {
  const cors = corsHeaders(request);
  const url = new URL(request.url);
  let key = decodeURIComponent(url.pathname.replace(/^\/+/, ''));

  if (!key || key === '/') {
    return Response.redirect('https://toaster.cloustan.org/toaster-andriod-beta/', 302);
  }

  if (url.searchParams.has('list-type')) {
    const builds = await listApkObjects(env.BETA_APK_BUCKET);
    const xml = s3ListXml(builds.map((b) => b.file));
    const headers = new Headers(cors);
    headers.set('Content-Type', 'application/xml; charset=utf-8');
    return new Response(request.method === 'HEAD' ? null : xml, { headers });
  }

  if (MANIFEST_KEYS.has(key)) {
    const stored = await env.BETA_APK_BUCKET.get(key);
    if (stored) {
      const headers = new Headers(cors);
      stored.writeHttpMetadata(headers);
      headers.set('Content-Type', 'application/json; charset=utf-8');
      headers.set('etag', stored.httpEtag);
      if (request.method === 'HEAD') {
        return new Response(null, { headers });
      }
      return new Response(stored.body, { headers });
    }
    const manifest = await buildManifest(env.BETA_APK_BUCKET);
    return jsonResponse(request, manifest);
  }

  if (!/\.apk$/i.test(key)) {
    return jsonResponse(request, { error: 'Not found', key }, 404);
  }

  const object = await env.BETA_APK_BUCKET.get(key);
  if (!object) {
    return jsonResponse(request, { error: 'Not found', key }, 404);
  }

  const headers = new Headers(cors);
  object.writeHttpMetadata(headers);
  headers.set('etag', object.httpEtag);
  if (/\.apk$/i.test(key)) {
    headers.set('Content-Disposition', `attachment; filename="${key.split('/').pop()}"`);
  }

  if (request.method === 'HEAD') {
    return new Response(null, { headers });
  }

  return new Response(object.body, { headers });
}

export default {
  async fetch(request, env) {
    const cors = corsHeaders(request, 'GET, HEAD, OPTIONS, POST');

    try {
      if (request.method === 'OPTIONS') {
        return new Response(null, { status: 204, headers: cors });
      }

      const url = new URL(request.url);
      const path = url.pathname.replace(/\/+$/, '') || '/';

      if (request.method === 'POST' && path.startsWith('/api/releases')) {
        return handleReleasePost(request, env);
      }

      if (request.method === 'GET' || request.method === 'HEAD') {
        return handlePublicGet(request, env);
      }

      return new Response('Method Not Allowed', { status: 405, headers: cors });
    } catch (err) {
      return jsonResponse(
        request,
        { error: 'Internal error', message: err && err.message ? err.message : 'Unknown' },
        500,
        'GET, HEAD, OPTIONS, POST'
      );
    }
  }
};
