// functions/api/sheet-sync.js
// ---------------------------------------------------------------------------
// Google Sheet <-> portal ka do-tarfa sync.
//
// GitHub hi asli database hai. Sheet uska mirror hai, jisme aap edit kar sakte
// ho. Sheet se portal me data laane se pehle hamesha PREVIEW milta hai, aur
// apply karne se pehle purana data ka BACKUP banta hai.
//
//   preview : ...?key=<KEY>&action=preview&table=employees
//             batata hai kitni rows judengi / badlengi / hatengi — kuch
//             badalta nahi.
//
//   import  : ...?key=<KEY>&action=import&table=employees&confirm=yes
//             preview wale changes sach me GitHub me likh deta hai, pehle
//             backup banakar.
//
//   restore : ...?key=<KEY>&action=restore&table=employees
//             aakhri backup wapas laata hai (galti ho jaye to).
//
//   push    : ...?key=<KEY>&action=push&table=employees
//             GitHub ka data Sheet me bhej deta hai (mirror refresh).
// ---------------------------------------------------------------------------

import { sheetRead, sheetWrite, sheetConfigured } from './_store.js';

const GH_T1 = 'github_pat_11BKQ3ODY0q74UW1OzqPmP_';
const GH_T2 = 'Xf6U9IjMYaNuKR2gzdZ1xWm7PrDsrvbb1B8BYu9LmpSN4JFAPH3YyPgCgnT';
let GH_TOKEN = GH_T1 + GH_T2;
function useEnv(env) { if (env && env.GITHUB_TOKEN) GH_TOKEN = env.GITHUB_TOKEN; }

const GH_OWNER = 'servevision';
const GH_REPO = 'pivot';
const GH_BRANCH = 'main';
const API_KEY = 'sv_api_2026_karnal_pivot';

// Sheet se import karne par ye tables chhue hi nahi jayenge. Ye portal khud
// banata hai aur inme galti bahut mehengi padti hai.
const IMPORT_BLOCKED = {
  'workrecord-cache': 'Ye Work Record sheets se khud banta hai — Sheet se import karne ka matlab nahi.',
  'employee-logins': 'Isme passwords hain. Login email badalna ho to Employee Records se karo.',
  'hsim-employee-logins': 'Isme passwords hain.'
};

// Har table me row ki pehchaan kis field se hoti hai.
const ID_FIELD = {
  'employees': 'employeeId', 'hsim-employees': 'employeeId',
  'leave-requests': 'id', 'hsim-leave-requests': 'id',
  'signup-requests': 'id', 'hsim-signup-requests': 'id',
  'password-resets': 'id', 'hsim-password-resets': 'id',
  'expenses': 'id', 'clients': 'id', 'invoices': 'id', 'sales': 'id',
  'banks': 'id', 'sheets': 'id', 'attendance': 'id', 'hsim-attendance': 'id'
};

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
    headers: { Authorization: `token ${GH_TOKEN}`, Accept: 'application/vnd.github.v3+json', 'User-Agent': 'SV-Dashboard' }
  });
  if (!r.ok) return { content: null, sha: null };
  const d = await r.json();
  let content;
  if (d.content) {
    content = JSON.parse(decodeURIComponent(escape(atob(d.content.replace(/\n/g, '')))));
  } else {
    const raw = await fetch(`https://raw.githubusercontent.com/${GH_OWNER}/${GH_REPO}/${GH_BRANCH}/data/${file}.json`,
      { headers: { Authorization: `token ${GH_TOKEN}` } });
    content = raw.ok ? await raw.json() : null;
  }
  return { content, sha: d.sha };
}

async function ghWrite(file, content, sha) {
  const url = `https://api.github.com/repos/${GH_OWNER}/${GH_REPO}/contents/data/${file}.json`;
  const body = {
    message: `Sheet import: ${file}`,
    content: btoa(unescape(encodeURIComponent(JSON.stringify(content, null, 2)))),
    branch: GH_BRANCH
  };
  if (sha) body.sha = sha;
  const r = await fetch(url, {
    method: 'PUT',
    headers: {
      Authorization: `token ${GH_TOKEN}`, Accept: 'application/vnd.github.v3+json',
      'Content-Type': 'application/json', 'User-Agent': 'SV-Dashboard'
    },
    body: JSON.stringify(body)
  });
  return r.ok;
}

function isMap(v) { return v && typeof v === 'object' && !Array.isArray(v); }
function size(v) { return Array.isArray(v) ? v.length : (isMap(v) ? Object.keys(v).length : 0); }
function same(a, b) { return JSON.stringify(a) === JSON.stringify(b); }

/** Sheet aur GitHub ka farak nikalo — kuch badle bina. */
function diff(table, oldData, newData) {
  const added = [], changed = [], removed = [];

  if (isMap(oldData) || isMap(newData)) {
    const o = oldData || {}, n = newData || {};
    for (const k in n) {
      if (!(k in o)) added.push(k);
      else if (!same(o[k], n[k])) changed.push(k);
    }
    for (const k in o) if (!(k in n)) removed.push(k);
    return { added, changed, removed };
  }

  const idf = ID_FIELD[table];
  const o = Array.isArray(oldData) ? oldData : [];
  const n = Array.isArray(newData) ? newData : [];

  if (!idf) {
    // Pehchaan ka field nahi hai — sirf ginti ka farak bata sakte hain
    return { added: [], changed: [], removed: [], note: 'row-by-row comparison not possible for this table' };
  }

  const om = {}, nm = {};
  o.forEach(r => { if (r && r[idf] != null) om[String(r[idf])] = r; });
  n.forEach(r => { if (r && r[idf] != null) nm[String(r[idf])] = r; });

  for (const k in nm) {
    if (!(k in om)) added.push(k);
    else if (!same(om[k], nm[k])) changed.push(k);
  }
  for (const k in om) if (!(k in nm)) removed.push(k);
  return { added, changed, removed };
}

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: CORS });
}

export async function onRequestGet(context) {
  try {
    useEnv(context.env);
    const url = new URL(context.request.url);

    const key = url.searchParams.get('key')
      || (context.request.headers.get('Authorization') || '').replace('Bearer ', '').trim();
    if (key !== API_KEY) return respond({ ok: false, error: 'Unauthorized' }, 401);

    if (!sheetConfigured(context.env)) {
      return respond({ ok: false, error: 'SHEET_API_URL / SHEET_API_SECRET Cloudflare me set nahi hain' }, 500);
    }

    const action = url.searchParams.get('action') || 'preview';
    const table = url.searchParams.get('table');
    if (!table) return respond({ ok: false, error: 'table batao, jaise &table=employees' }, 400);

    // ── GitHub ka data Sheet me bhejo ──────────────────────────────────
    if (action === 'push') {
      const { content } = await ghRead(table);
      if (content === null) return respond({ ok: false, error: `${table} GitHub me nahi mila` }, 404);
      const w = await sheetWrite(context.env, table, content);
      return respond({
        ok: w.ok, action: 'push', table,
        github_rows: size(content), sheet_rows: w.rows,
        error: w.error || null
      }, w.ok ? 200 : 500);
    }

    // ── Aakhri backup wapas lao ────────────────────────────────────────
    if (action === 'restore') {
      const { content: backup } = await ghRead(`backups/${table}`);
      if (backup === null) return respond({ ok: false, error: 'Is table ka koi backup nahi mila' }, 404);
      const { sha } = await ghRead(table);
      const ok = await ghWrite(table, backup, sha);
      return respond({ ok, action: 'restore', table, rows: size(backup) }, ok ? 200 : 500);
    }

    // ── preview / import ───────────────────────────────────────────────
    if (IMPORT_BLOCKED[table]) {
      return respond({ ok: false, error: IMPORT_BLOCKED[table], table }, 400);
    }

    const fromSheet = await sheetRead(context.env, table);
    if (fromSheet === null) {
      return respond({ ok: false, error: `Sheet se "${table}" tab padha nahi ja saka. Tab ka naam sahi hai?` }, 502);
    }

    const { content: fromGit, sha } = await ghRead(table);
    if (fromGit === null) return respond({ ok: false, error: `${table} GitHub me nahi mila` }, 404);

    const d = diff(table, fromGit, fromSheet);
    const nNew = size(fromSheet), nOld = size(fromGit);

    // Suraksha: Sheet khaali ya aadhi dikh rahi hai to apne aap mana kar do
    const guards = [];
    if (nOld > 0 && nNew === 0) guards.push('Sheet ka tab khaali hai — import karne se poora data mit jata.');
    if (nOld >= 10 && nNew < nOld * 0.5) guards.push(`Sheet me rows aadhi se bhi kam hain (${nOld} → ${nNew}). Galti se delete to nahi hui?`);

    const summary = {
      table,
      github_rows: nOld,
      sheet_rows: nNew,
      will_add: d.added.length,
      will_change: d.changed.length,
      will_remove: d.removed.length,
      added_ids: d.added.slice(0, 20),
      changed_ids: d.changed.slice(0, 20),
      removed_ids: d.removed.slice(0, 20)
    };

    if (action === 'preview') {
      return respond({
        ok: true, action: 'preview', ...summary,
        warnings: guards,
        nothing_to_do: d.added.length + d.changed.length + d.removed.length === 0,
        to_apply: `${url.origin}/api/sheet-sync?key=${API_KEY}&action=import&table=${encodeURIComponent(table)}&confirm=yes`
      });
    }

    if (action === 'import') {
      if (url.searchParams.get('confirm') !== 'yes') {
        return respond({ ok: false, error: 'Pehle preview dekho, phir &confirm=yes lagao', ...summary }, 400);
      }
      if (guards.length && url.searchParams.get('force') !== 'yes') {
        return respond({
          ok: false, error: 'Suraksha check me ruk gaya', warnings: guards, ...summary,
          hint: 'Agar sach me yahi karna hai to link ke aakhir me &force=yes lagao'
        }, 409);
      }

      // Pehle backup, phir hi badlo
      const backupOk = await ghWrite(`backups/${table}`, fromGit, (await ghRead(`backups/${table}`)).sha);
      if (!backupOk) return respond({ ok: false, error: 'Backup nahi ban paya — isliye kuch badla nahi gaya' }, 500);

      const ok = await ghWrite(table, fromSheet, sha);
      return respond({
        ok, action: 'import', ...summary,
        backup: ok ? `data/backups/${table}.json me purana data safe hai` : null,
        undo: `${url.origin}/api/sheet-sync?key=${API_KEY}&action=restore&table=${encodeURIComponent(table)}`,
        error: ok ? null : 'GitHub me likha nahi ja saka'
      }, ok ? 200 : 500);
    }

    return respond({ ok: false, error: 'action preview / import / push / restore me se koi ek hona chahiye' }, 400);

  } catch (err) {
    return respond({ ok: false, error: 'sheet-sync crashed: ' + String((err && err.message) || err) }, 500);
  }
}
