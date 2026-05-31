/**
 * Proxies toaster.cloustan.org/toaster-andriod-beta/* to the Cloudflare Pages deployment.
 */
export default {
  async fetch(request, env) {
    const base = String(env.BASE_PATH || '/toaster-andriod-beta').replace(/\/$/, '');
    const pagesHost = String(env.PAGES_HOST || 'toaster-andriod-beta.pages.dev');
    const url = new URL(request.url);

    if (!url.pathname.startsWith(base)) {
      return new Response('Not found', { status: 404 });
    }

    const upstream = new URL(request.url);
    upstream.hostname = pagesHost;
    upstream.protocol = 'https:';

    const init = {
      method: request.method,
      headers: request.headers,
      redirect: 'manual'
    };
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      init.body = request.body;
    }

    const response = await fetch(upstream, init);
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('Location');
      if (location) {
        const headers = new Headers(response.headers);
        const next = new URL(location, upstream);
        if (next.hostname === pagesHost) {
          next.hostname = url.hostname;
          next.protocol = url.protocol;
          headers.set('Location', next.toString());
        }
        return new Response(response.body, { status: response.status, headers });
      }
    }
    return response;
  }
};
