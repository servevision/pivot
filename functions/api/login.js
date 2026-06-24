const USER_EMAIL    = 'Payments@servevision.io';
const USER_PASSWORD = 'Karnal#989630';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type,Authorization',
};

function res(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status, headers: { 'Content-Type': 'application/json', ...CORS },
  });
}

async function makeJWT(payload, secret) {
  const h = btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const b = btoa(JSON.stringify(payload));
  const msg = `${h}.${b}`;
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(msg));
  const s = btoa(String.fromCharCode(...new Uint8Array(sig)))
    .replace(/\+/g,'-').replace(/\//g,'_').replace(/=/g,'');
  return `${msg}.${s}`;
}

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: CORS });
}

export async function onRequestPost(context) {
  const { request, env } = context;
  const { email, password } = await request.json().catch(() => ({}));
  if (
    email?.trim().toLowerCase() === USER_EMAIL.toLowerCase() &&
    password === USER_PASSWORD
  ) {
    const secret = env.JWT_SECRET || 'sv_fallback_2026';
    const token = await makeJWT(
      { email: USER_EMAIL, exp: Date.now() + 8 * 60 * 60 * 1000 },
      secret
    );
    return res({ ok: true, token, email: USER_EMAIL });
  }
  return res({ ok: false, error: 'Invalid email or password' }, 401);
}
