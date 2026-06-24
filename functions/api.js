/**
 * Serve Vision HR Dashboard — Cloudflare Pages Function
 * Handles: Login, GitHub data read/write
 * 
 * Environment Variables (set in Cloudflare Pages dashboard):
 *   GITHUB_TOKEN  — GitHub Personal Access Token (repo scope)
 *   JWT_SECRET    — Any random string for JWT signing
 *   GITHUB_OWNER  — servevision
 *   GITHUB_REPO   — Servevisionpivot
 */

// ── Config ──────────────────────────────────────────────
const USER_EMAIL    = 'Payments@servevision.io';
const USER_PASSWORD = 'Karnal#989630';
const GH_BRANCH     = 'main';

// ── CORS Headers ─────────────────────────────────────────
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

// ── Simple JWT (HMAC-SHA256) ─────────────────────────────
async function makeJWT(payload, secret) {
  const header  = btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body    = btoa(JSON.stringify(payload));
  const msg     = `${header}.${body}`;
  const key     = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(msg));
  const sigB64 = btoa(String.fromCharCode(...new Uint8Array(sig)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
  return `${msg}.${sigB64}`;
}

async function verifyJWT(token, secret) {
  try {
    const [header, body, sig] = token.split('.');
    const msg = `${header}.${body}`;
    const key = await crypto.subtle.importKey(
      'raw', new TextEncoder().encode(secret),
      { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']
    );
    const sigBytes = Uint8Array.from(atob(sig.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
    const valid = await crypto.subtle.verify('HMAC', key, sigBytes, new TextEncoder().encode(msg));
    if (!valid) return null;
    const payload = JSON.parse(atob(body));
    if (payload.exp && Date.now() > payload.exp) return null;
    return payload;
  } catch { return null; }
}

// ── GitHub API helper ────────────────────────────────────
async function ghRead(env, path) {
  const url = `https://api.github.com/repos/${env.GITHUB_OWNER}/${env.GITHUB_REPO}/contents/${path}?ref=${GH_BRANCH}`;
  const r = await fetch(url, {
    headers: {
      Authorization: `token ${env.GITHUB_TOKEN}`,
      Accept: 'application/vnd.github.v3+json',
      'User-Agent': 'ServevisionDashboard',
    },
  });
  if (!r.ok) return { content: null, sha: null };
  const data = await r.json();
  const content = JSON.parse(atob(data.content.replace(/\n/g, '')));
  return { content, sha: data.sha };
}

async function ghWrite(env, path, content, sha) {
  const url = `https://api.github.com/repos/${env.GITHUB_OWNER}/${env.GITHUB_REPO}/contents/${path}`;
  const body = {
    message: `Update ${path}`,
    content: btoa(unescape(encodeURIComponent(JSON.stringify(content, null, 2)))),
    branch: GH_BRANCH,
  };
  if (sha) body.sha = sha;
  const r = await fetch(url, {
    method: 'PUT',
    headers: {
      Authorization: `token ${env.GITHUB_TOKEN}`,
      Accept: 'application/vnd.github.v3+json',
      'Content-Type': 'application/json',
      'User-Agent': 'ServevisionDashboard',
    },
    body: JSON.stringify(body),
  });
  return r.ok;
}

// ── Router ───────────────────────────────────────────────
export async function onRequest(context) {
  const { request, env } = context;

  // Preflight
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS });
  }

  const url  = new URL(request.url);
  const path = url.pathname.replace('/api', '');

  // ── POST /api/login ──────────────────────────────────
  if (path === '/login' && request.method === 'POST') {
    const { email, password } = await request.json().catch(() => ({}));
    if (
      email?.trim().toLowerCase() === USER_EMAIL.toLowerCase() &&
      password === USER_PASSWORD
    ) {
      const token = await makeJWT(
        { email: USER_EMAIL, exp: Date.now() + 8 * 60 * 60 * 1000 },
        env.JWT_SECRET
      );
      return json({ ok: true, token, email: USER_EMAIL });
    }
    return json({ ok: false, error: 'Invalid credentials' }, 401);
  }

  // ── Auth check for all other routes ─────────────────
  const authHeader = request.headers.get('Authorization') || '';
  const token = authHeader.replace('Bearer ', '').trim();
  const payload = token ? await verifyJWT(token, env.JWT_SECRET) : null;
  if (!payload) return json({ error: 'Unauthorized' }, 401);

  // ── GET /api/data/:table ─────────────────────────────
  if (path.startsWith('/data/') && request.method === 'GET') {
    const table = path.split('/')[2]; // sheets | salary | holiday
    if (!['sheets', 'salary', 'holiday'].includes(table)) {
      return json({ error: 'Unknown table' }, 400);
    }
    const { content } = await ghRead(env, `data/${table}.json`);
    return json(content ?? (table === 'sheets' ? [] : {}));
  }

  // ── POST /api/data/:table ────────────────────────────
  if (path.startsWith('/data/') && request.method === 'POST') {
    const table = path.split('/')[2];
    if (!['sheets', 'salary', 'holiday'].includes(table)) {
      return json({ error: 'Unknown table' }, 400);
    }
    const newData = await request.json();
    const { sha } = await ghRead(env, `data/${table}.json`);
    const ok = await ghWrite(env, `data/${table}.json`, newData, sha);
    return json({ ok, saved: true });
  }

  // ── GET /api/ping ────────────────────────────────────
  if (path === '/ping') {
    return json({ ok: true, time: new Date().toISOString(), user: payload.email });
  }

  return json({ error: 'Not found' }, 404);
}
