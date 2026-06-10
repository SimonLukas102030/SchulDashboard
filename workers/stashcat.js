// CORS proxy for stashcat / schul.cloud API
// Deploy: npx wrangler deploy workers/stashcat.js --name stashcat-proxy --compatibility-date 2024-09-23

const ALLOWED = /^https:\/\/(api\.stashcat\.com|api\.schul\.cloud)\//i;

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

    const upstream = await fetch(target, {
      method:  req.method,
      headers: { 'Content-Type': req.headers.get('Content-Type') ?? 'application/x-www-form-urlencoded' },
      body:    req.body,
    });

    const body = await upstream.arrayBuffer();
    return new Response(body, {
      status:  upstream.status,
      headers: { ...Object.fromEntries(upstream.headers), ...cors() },
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
