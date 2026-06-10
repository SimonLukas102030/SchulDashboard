// Cloudflare Worker — WebUntis CORS proxy
// Deploy: wrangler deploy workers/webuntis.js --name webuntis-proxy
// Only proxies requests to *.webuntis.com to prevent abuse.

const ALLOWED = /^https:\/\/[a-z0-9.-]+\.webuntis\.com\//i;
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-Untis-Session',
  'Access-Control-Max-Age': '86400',
};

export default {
  async fetch(request) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS });
    }
    if (request.method !== 'POST') {
      return jsonResp({ error: 'Method not allowed' }, 405);
    }

    const { searchParams } = new URL(request.url);
    const target = searchParams.get('target');

    if (!target || !ALLOWED.test(target)) {
      return jsonResp({ error: 'Invalid or disallowed target URL' }, 400);
    }

    const sessionHeader = request.headers.get('X-Untis-Session') ?? '';
    const [sessionId, school] = sessionHeader.split(',');

    const fwdHeaders = { 'Content-Type': 'application/json' };
    if (sessionId) {
      fwdHeaders['Cookie'] =
        `JSESSIONID=${sessionId}${school ? `; schoolname=${encodeURIComponent(school)}` : ''}`;
    }

    let upstream;
    try {
      upstream = await fetch(target, {
        method: 'POST',
        headers: fwdHeaders,
        body: await request.text(),
      });
    } catch (e) {
      return jsonResp({ error: `Upstream unreachable: ${e.message}` }, 502);
    }

    const body = await upstream.text();
    return new Response(body, {
      status: upstream.status,
      headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  },
};

function jsonResp(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}
