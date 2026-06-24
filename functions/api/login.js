
const USER_EMAIL    = 'Payments@servevision.io';
const USER_PASSWORD = 'Karnal#989630';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type,Authorization',
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS },
  });
}

async function makeJWT(payload, secret) {
  const header = btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body   = btoa(JSON.stringify(payload));
  const msg    = `${header}.${body}`;
  const key    = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const sig    = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(msg));
  const sigB64 = btoa(String.fromCharCode(...new Uint8Array(sig)))
    .replace(/\+/g,'-').replace(/\//g,'_').replace(/=/g,'');
  return `${msg}.${sigB64}`;
}

export async function onRequest(context) {
  const { request, env } = context;
  if (request.method === 'OPTIONS')
    return new Response(null, { status: 204, headers: CORS });

  if (request.method !== 'POST')
    return json({ error: 'Method not allowed' }, 405);

  const { email, password } = await request.json().catch(() => ({}));

  if (
    email?.trim().toLowerCase() === USER_EMAIL.toLowerCase() &&
    password === USER_PASSWORD
  ) {
    const token = await makeJWT(
      { email: USER_EMAIL, exp: Date.now() + 8 * 60 * 60 * 1000 },
      env.JWT_SECRET || 'sv_secret_fallback'
    );
    return json({ ok: true, token, email: USER_EMAIL });
  }
  return json({ ok: false, error: 'Invalid credentials' }, 401);
}
