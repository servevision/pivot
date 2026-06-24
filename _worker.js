
const USER_EMAIL    = 'Payments@servevision.io';
const USER_PASSWORD = 'Karnal#989630';
const GH_BRANCH     = 'main';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type,Authorization',
};

function res(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS },
  });
}

// ── JWT ──────────────────────────────────────────────────
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

async function verifyJWT(token, secret) {
  try {
    const [h, b, s] = token.split('.');
    const msg = `${h}.${b}`;
    const key = await crypto.subtle.importKey(
      'raw', new TextEncoder().encode(secret),
      { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']
    );
    const sigBytes = Uint8Array.from(
      atob(s.replace(/-/g,'+').replace(/_/g,'/')), c => c.charCodeAt(0)
    );
    const valid = await crypto.subtle.verify('HMAC', key, sigBytes, new TextEncoder().encode(msg));
    if (!valid) return null;
    const payload = JSON.parse(atob(b));
    if (payload.exp && Date.now() > payload.exp) return null;
    return payload;
  } catch { return null; }
}

// ── GitHub ───────────────────────────────────────────────
async function ghRead(env, file) {
  const url = `https://api.github.com/repos/${env.GITHUB_OWNER}/${env.GITHUB_REPO}/contents/data/${file}.json?ref=${GH_BRANCH}`;
  const r = await fetch(url, {
    headers: {
      Authorization: `token ${env.GITHUB_TOKEN}`,
      Accept: 'application/vnd.github.v3+json',
      'User-Agent': 'ServevisionDashboard',
    },
  });
  if (!r.ok) return { content: null, sha: null };
  const d = await r.json();
  return {
    content: JSON.parse(atob(d.content.replace(/\n/g, ''))),
    sha: d.sha
  };
}

async function ghWrite(env, file, content, sha) {
  const url = `https://api.github.com/repos/${env.GITHUB_OWNER}/${env.GITHUB_REPO}/contents/data/${file}.json`;
  const body = {
    message: `Update ${file}`,
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

// ── Main Handler ─────────────────────────────────────────
export default {
  async fetch(request, env) {
    const url  = new URL(request.url);
    const path = url.pathname;

    // Preflight
    if (request.method === 'OPTIONS')
      return new Response(null, { status: 204, headers: CORS });

    // Serve static files (non-API)
    if (!path.startsWith('/api/'))
      return fetch(request);

    const apiPath = path.replace('/api', '');

    // ── POST /api/login ──────────────────────────────
    if (apiPath === '/login' && request.method === 'POST') {
      const { email, password } = await request.json().catch(() => ({}));
      if (
        email?.trim().toLowerCase() === USER_EMAIL.toLowerCase() &&
        password === USER_PASSWORD
      ) {
        const secret = env.JWT_SECRET || 'sv_fallback_secret_2026';
        const token = await makeJWT(
          { email: USER_EMAIL, exp: Date.now() + 8 * 60 * 60 * 1000 },
          secret
        );
        return res({ ok: true, token, email: USER_EMAIL });
      }
      return res({ ok: false, error: 'Invalid email or password' }, 401);
    }

    // ── Auth check ───────────────────────────────────
    const auth    = request.headers.get('Authorization') || '';
    const token   = auth.replace('Bearer ', '').trim();
    const secret  = env.JWT_SECRET || 'sv_fallback_secret_2026';
    const payload = token ? await verifyJWT(token, secret) : null;
    if (!payload) return res({ error: 'Unauthorized' }, 401);

    // ── GET /api/ping ────────────────────────────────
    if (apiPath === '/ping')
      return res({ ok: true, user: payload.email, time: new Date().toISOString() });

    // ── /api/data/:table ─────────────────────────────
    const m = apiPath.match(/^\/data\/(sheets|salary|holiday)$/);
    if (!m) return res({ error: 'Not found' }, 404);
    const table = m[1];

    if (request.method === 'GET') {
      const { content } = await ghRead(env, table);
      return res(content ?? (table === 'sheets' ? [] : {}));
    }

    if (request.method === 'POST') {
      const data = await request.json();
      const { sha } = await ghRead(env, table);
      const ok = await ghWrite(env, table, data, sha);
      return res({ ok, saved: true });
    }

    return res({ error: 'Method not allowed' }, 405);
  }
};
