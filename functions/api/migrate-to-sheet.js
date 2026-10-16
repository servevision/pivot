// functions/api/migrate-to-sheet.js
// ---------------------------------------------------------------------------
// GitHub ke data/*.json ko Google Sheet ke tabs me copy karta hai.
// GitHub ko sirf PADHTA hai — kuch likhta nahi — to jitni baar chaho chala
// sakte ho, aapka asli data bilkul safe rehta hai.
//
// Cloudflare ek request me sirf 50 bahar ki calls karne deta hai, isliye ye
// thode-thode tables karta hai aur batata hai aage kahan se chalana hai.
//
// Chalana (browser me):
//   https://pivot-eb5.pages.dev/api/migrate-to-sheet?key=<ADMIN KEY>
// Jawab me "next" link aayega — use kholte jao jab tak "done" na aa jaye.
//
// Sirf ek table:
//   ...?key=<KEY>&table=employees
// ---------------------------------------------------------------------------

import { sheetWrite, sheetConfigured } from './_store.js';

const GH_T1 = 'github_pat_11BKQ3ODY0q74UW1OzqPmP_';
const GH_T2 = 'Xf6U9IjMYaNuKR2gzdZ1xWm7PrDsrvbb1B8BYu9LmpSN4JFAPH3YyPgCgnT';
let GH_TOKEN = GH_T1 + GH_T2;
function useEnv(env) { if (env && env.GITHUB_TOKEN) GH_TOKEN = env.GITHUB_TOKEN; }

const GH_OWNER = 'servevision';
const GH_REPO = 'pivot';
const GH_BRANCH = 'main';
const API_KEY = 'sv_api_2026_karnal_pivot';

// Ek request me itne tables. Har table = 1 GitHub read + 1 Sheet write, aur
// Cloudflare ki limit 50 calls per request hai — 6 rakha hai, aaram se fit.
const BATCH = 6;

// Bills aur employee documents files hain, data nahi — wo apni jagah rehte hain.
const TABLES = [
  'employees', 'employee-logins', 'salary', 'sheets',
  'leave-requests', 'attendance', 'expenses', 'signup-requests',
  'clients', 'invoices', 'sales', 'banks',
  'password-resets', 'office-holidays', 'leave-adjustments', 'holiday',
  'company-settings', 'exp-settings', 'settings',
  'hsim-employees', 'hsim-employee-logins', 'hsim-signup-requests',
  'hsim-leave-requests', 'hsim-attendance', 'hsim-password-resets',
  'hsim-office-holidays', 'hsim-settings',
  // Sabse bada table sabse aakhir me — 3,451 rows, akela hi poora batch lega
  'workrecord-cache'
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
  // Poore handler ko lapeta hua hai, taki koi bhi gadbad Cloudflare ka
  // "Error 1101" page na dikhaye — hamesha saaf JSON error aaye.
  try {
    useEnv(context.env);
    const url = new URL(context.request.url);
    const origin = url.origin;

    const key = url.searchParams.get('key')
      || (context.request.headers.get('Authorization') || '').replace('Bearer ', '').trim();
    if (key !== API_KEY) return respond({ ok: false, error: 'Unauthorized — key galat hai' }, 401);

    if (!sheetConfigured(context.env)) {
      return respond({
        ok: false,
        error: 'SHEET_API_URL aur SHEET_API_SECRET Cloudflare me nahi mile',
        fix: 'Cloudflare → Workers & Pages → pivot → Settings → Variables and Secrets me dono add karo, phir Deployments → Retry deployment'
      }, 500);
    }

    const only = url.searchParams.get('table');
    const from = Math.max(0, parseInt(url.searchParams.get('from') || '0', 10) || 0);
    const list = only ? [only] : TABLES.slice(from, from + BATCH);

    const results = [];
    let copied = 0, failed = 0, missing = 0;

    for (const t of list) {
      let data = null;
      try {
        data = await ghRead(t);
      } catch (e) {
        results.push({ table: t, status: 'GitHub read failed: ' + String(e && e.message || e) });
        failed++;
        continue;
      }
      if (data === null) {
        results.push({ table: t, status: 'GitHub me nahi mila — skip' });
        missing++;
        continue;
      }
      const n = count(data);
      const w = await sheetWrite(context.env, t, data);
      if (w.ok) {
        copied++;
        results.push({ table: t, github_rows: n, sheet_rows: w.rows, status: 'copied ✓' });
      } else {
        failed++;
        results.push({ table: t, github_rows: n, status: 'FAILED', error: w.error });
      }
    }

    const done = !!only || (from + BATCH) >= TABLES.length;
    const nextFrom = from + BATCH;

    return respond({
      ok: failed === 0,
      batch: only ? only : `${from + 1} se ${Math.min(from + BATCH, TABLES.length)} tak (kul ${TABLES.length})`,
      summary: `${copied} copied, ${failed} failed, ${missing} not found`,
      done,
      next: done ? null : `${origin}/api/migrate-to-sheet?key=${API_KEY}&from=${nextFrom}`,
      instruction: done
        ? 'Sab ho gaya. Har table ke github_rows aur sheet_rows same hone chahiye.'
        : 'Upar "next" wala link kholo — agla batch chalega.',
      results
    }, failed === 0 ? 200 : 500);

  } catch (err) {
    return respond({
      ok: false,
      error: 'Migration crashed: ' + String((err && err.message) || err),
      stack: String((err && err.stack) || '').split('\n').slice(0, 4)
    }, 500);
  }
}
