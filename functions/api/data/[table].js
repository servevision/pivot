
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type,Authorization',
};
const GH_BRANCH = 'main';

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS },
  });
}

async function verifyJWT(token, secret) {
  try {
    const [header, body, sig] = token.split('.');
    const msg = `${header}.${body}`;
    const key = await crypto.subtle.importKey(
      'raw', new TextEncoder().encode(secret),
      { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']
    );
    const sigBytes = Uint8Array.from(
      atob(sig.replace(/-/g,'+').replace(/_/g,'/')),
      c => c.charCodeAt(0)
    );
    const valid = await crypto.subtle.verify('HMAC', key, sigBytes, new TextEncoder().encode(msg));
    if (!valid) return null;
    const payload = JSON.parse(atob(body));
    if (payload.exp && Date.now() > payload.exp) return null;
    return payload;
  } catch { return null; }
}

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

export async function onRequest(context) {
  const { request, env, params } = context;

  if (request.method === 'OPTIONS')
    return new Response(null, { status: 204, headers: CORS });

  // Auth check
  const authHeader = request.headers.get('Authorization') || '';
  const token = authHeader.replace('Bearer ', '').trim();
  const secret = env.JWT_SECRET || 'sv_secret_fallback';
  const payload = token ? await verifyJWT(token, secret) : null;
  if (!payload) return json({ error: 'Unauthorized' }, 401);

  const table = params.table;
  if (!['sheets', 'salary', 'holiday'].includes(table))
    return json({ error: 'Unknown table' }, 400);

  if (request.method === 'GET') {
    const { content } = await ghRead(env, `data/${table}.json`);
    return json(content ?? (table === 'sheets' ? [] : {}));
  }

  if (request.method === 'POST') {
    const newData = await request.json();
    const { sha } = await ghRead(env, `data/${table}.json`);
    const ok = await ghWrite(env, `data/${table}.json`, newData, sha);
    return json({ ok, saved: true });
  }

  return json({ error: 'Method not allowed' }, 405);
}
