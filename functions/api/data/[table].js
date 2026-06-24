const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type,Authorization',
};
const GH_BRANCH = 'main';

function res(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status, headers: { 'Content-Type': 'application/json', ...CORS },
  });
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

async function checkAuth(request, env) {
  const auth  = request.headers.get('Authorization') || '';
  const token = auth.replace('Bearer ', '').trim();
  const secret = env.JWT_SECRET || 'sv_fallback_2026';
  return token ? await verifyJWT(token, secret) : null;
}

async function ghRead(env, table) {
  const url = `https://api.github.com/repos/${env.GITHUB_OWNER}/${env.GITHUB_REPO}/contents/data/${table}.json?ref=${GH_BRANCH}`;
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

async function ghWrite(env, table, content, sha) {
  const url = `https://api.github.com/repos/${env.GITHUB_OWNER}/${env.GITHUB_REPO}/contents/data/${table}.json`;
  const body = {
    message: `Update ${table}`,
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

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: CORS });
}

export async function onRequestGet(context) {
  const { request, env, params } = context;
  const payload = await checkAuth(request, env);
  if (!payload) return res({ error: 'Unauthorized' }, 401);
  const table = params.table;
  if (!['sheets','salary','holiday'].includes(table))
    return res({ error: 'Unknown table' }, 400);
  const { content } = await ghRead(env, table);
  return res(content ?? (table === 'sheets' ? [] : {}));
}

export async function onRequestPost(context) {
  const { request, env, params } = context;
  const payload = await checkAuth(request, env);
  if (!payload) return res({ error: 'Unauthorized' }, 401);
  const table = params.table;
  if (!['sheets','salary','holiday'].includes(table))
    return res({ error: 'Unknown table' }, 400);
  const data = await request.json();
  const { sha } = await ghRead(env, table);
  const ok = await ghWrite(env, table, data, sha);
  return res({ ok, saved: true });
}
