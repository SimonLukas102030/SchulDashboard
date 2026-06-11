// CORS proxy for stashcat / schul.cloud API
// Deploy: npx wrangler deploy workers/stashcat.js --name stashcat-proxy --compatibility-date 2024-09-23

const ALLOWED = /^https:\/\/(api\.stashcat\.com|api\.schul\.cloud)\//i;

// Mimic a real browser request from the official schul.cloud web app.
// api.stashcat.com blocks requests that don't look like they come from app.schul.cloud.
const UPSTREAM_HEADERS = {
  'Content-Type':  'application/x-www-form-urlencoded',
  'Origin':        'https://app.schul.cloud',
  'Referer':       'https://app.schul.cloud/',
  'User-Agent':    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept':        'application/json, text/plain, */*',
  'Accept-Language': 'de-DE,de;q=0.9,en;q=0.8',
};

export default {
  async fetch(req) {
    if (req.method === 'OPTIONS') {
      return new Response(null, { headers: cors() });
    }

    const url    = new URL(req.url);
    const target = url.searchParams.get('target');

    if (!target || !ALLOWED.test(target)) {
      return new Response('Forbidden', { status: 403, headers: cors() });
    }

    let upstream;
    try {
      upstream = await fetch(target, {
        method:  req.method,
        headers: UPSTREAM_HEADERS,
        body:    req.body,
      });
    } catch (e) {
      return new Response(JSON.stringify({ error: `Upstream unreachable: ${e.message}` }), {
        status:  502,
        headers: { 'Content-Type': 'application/json', ...cors() },
      });
    }

    const contentType = upstream.headers.get('Content-Type') ?? 'application/json';
    const body        = await upstream.arrayBuffer();
    return new Response(body, {
      status:  upstream.status,
      headers: { 'Content-Type': contentType, ...cors() },
    });
  },
};

function cors() {
  return {
    'Access-Control-Allow-Origin':  '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}
