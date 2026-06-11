// Deno Deploy CORS proxy for api.stashcat.com
// Deploy: dash.deno.com → New Project → link this file (workers/stashcat-deno.ts)

const ALLOWED = /^https:\/\/(api\.stashcat\.com|api\.schul\.cloud)\//i;

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: CORS });
  }

  const url    = new URL(req.url);
  const target = url.searchParams.get('target');

  if (!target || !ALLOWED.test(target)) {
    return new Response('Forbidden', { status: 403, headers: CORS });
  }

  let upstream: Response;
  try {
    upstream = await fetch(target, {
      method: 'POST',
      headers: {
        'Content-Type':   'application/x-www-form-urlencoded',
        'Origin':         'https://app.schul.cloud',
        'Referer':        'https://app.schul.cloud/',
        'User-Agent':     'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept':         'application/json, text/plain, */*',
        'Accept-Language':'de-DE,de;q=0.9,en;q=0.8',
      },
      body: await req.text(),
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return new Response(JSON.stringify({ error: `Upstream unreachable: ${msg}` }), {
      status:  502,
      headers: { 'Content-Type': 'application/json', ...CORS },
    });
  }

  const contentType = upstream.headers.get('Content-Type') ?? 'application/json';
  return new Response(await upstream.arrayBuffer(), {
    status:  upstream.status,
    headers: { 'Content-Type': contentType, ...CORS },
  });
});
