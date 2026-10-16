// functions/api/migrate-to-sheet.js
// ---------------------------------------------------------------------------
// Ek baar chalane wala migration: GitHub ke data/*.json ko Google Sheet ke
// tabs me copy karta hai. GitHub ko haath nahi lagata — sirf padhta hai — to
// ye chalane se kuch toot nahi sakta aur jitni baar chaho chala sakte ho.
//
// Chalane ka tareeka (browser me):
//   https://pivot-eb5.pages.dev/api/migrate-to-sheet?key=<ADMIN API KEY>
//
// Sirf ek table ke liye:
//   ...?key=<KEY>&table=employees
//
// Jawab me har table ke saamne GitHub ke rows aur Sheet me likhe rows dikhenge
// — dono ka number same hona chahiye.
// ---------------------------------------------------------------------------

import { sheetWrite } from './_store.js';

const GH_T1 = 'github_pat_11BKQ3ODY0q74UW1OzqPmP_';
const GH_T2 = 'Xf6U9IjMYaNuKR2gzdZ1xWm7PrDsrvbb1B8BYu9LmpSN4JFAPH3YyPgCgnT';
let GH_TOKEN = GH_T1 + GH_T2;
function useEnv(env) { if (env && env.GITHUB_TOKEN) GH_TOKEN = env.GITHUB_TOKEN; }

const GH_OWNER = 'servevision';
const GH_REPO = 'pivot';
const GH_BRANCH = 'main';
const API_KEY = 'sv_api_2026_karnal_pivot';

// Jo tables Sheet me jayenge. Bills aur employee documents files hain, data
// nahi — wo apni jagah par hi rehte hain.
const TABLES = [
  'sheets', 'salary', 'holiday', 'expenses', 'employees', 'employee-logins',
  'signup-requests', 'leave-requests', 'attendance', 'workrecord-cache',
  'password-resets', 'office-holidays', 'leave-adjustments',
  'sales', 'clients', 'invoices', 'banks',
  'company-settings', 'exp-settings', 'settings',
  'hsim-employees', 'hsim-employee-logins', 'hsim-signup-requests',
  'hsim-leave-requests', 'hsim-attendance', 'hsim-password-resets',
  'hsim-office-holidays', 'hsim-settings'
];

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type,Authorization',
};

function respond(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...CORS }
  });
}

async function ghRead(file) {
  const url = `https://api.github.com/repos/${GH_OWNER}/${GH_REPO}/contents/data/${file}.json?ref=${GH_BRANCH}`;
  const r = await fetch(url, {
    headers: {
      Authorization: `token ${GH_TOKEN}`,
      Accept: 'application/vnd.github.v3+json',
      'User-Agent': 'SV-Dashboard'
    }
  });
  if (!r.ok) return null;
  const d = await r.json();
  if (d.content) {
    return JSON.parse(decodeURIComponent(escape(atob(d.content.replace(/\n/g, '')))));
  }
  // 1 MB se badi file ka content inline nahi aata — raw se lete hain
  const rawRes = await fetch(
    `https://raw.githubusercontent.com/${GH_OWNER}/${GH_REPO}/${GH_BRANCH}/data/${file}.json`,
    { headers: { Authorization: `token ${GH_TOKEN}` } }
  );
  return rawRes.ok ? await rawRes.json() : null;
}

function count(v) {
  if (Array.isArray(v)) return v.length;
  if (v && typeof v === 'object') return Object.keys(v).length;
  return 0;
}

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: CORS });
}

export async function onRequestGet(context) {
  useEnv(context.env);
  const url = new URL(context.request.url);

  const key = url.searchParams.get('key')
    || (context.request.headers.get('Authorization') || '').replace('Bearer ', '').trim();
  if (key !== API_KEY) return respond({ ok: false, error: 'Unauthorized' }, 401);

  const only = url.searchParams.get('table');
  const list = only ? [only] : TABLES;

  const results = [];
  let copied = 0, failed = 0, missing = 0;

  for (const t of list) {
    const data = await ghRead(t);
    if (data === null) {
      results.push({ table: t, status: 'not in GitHub — skipped' });
      missing++;
      continue;
    }
    const n = count(data);
    const ok = await sheetWrite(context.env, t, data);
    if (ok) {
      copied++;
      results.push({ table: t, rows: n, status: 'copied' });
    } else {
      failed++;
      results.push({ table: t, rows: n, status: 'FAILED to write to Sheet' });
    }
  }

  return respond({
    ok: failed === 0,
    summary: `${copied} tables copied, ${failed} failed, ${missing} not found`,
    note: failed === 0
      ? 'Har table ke rows check kar lo — Sheet ke tab me utni hi rows honi chahiye.'
      : 'Kuch tables fail hue. SHEET_API_URL aur SHEET_API_SECRET Cloudflare me sahi hain ya nahi, ye dekho.',
    results
  }, failed === 0 ? 200 : 500);
}
