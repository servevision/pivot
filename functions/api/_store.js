// functions/api/_store.js
// ---------------------------------------------------------------------------
// Google Sheet ko database ki tarah padhne/likhne ka helper.
//
// Underscore se shuru hone wali files Cloudflare Pages route nahi karta, to ye
// URL par kabhi expose nahi hoti — sirf doosri API files isse import karti hain.
//
// Cloudflare me ye do variables set hone chahiye:
//   SHEET_API_URL    = Apps Script deployment ka URL (.../exec)
//   SHEET_API_SECRET = wahi secret jo Apps Script ki Script Properties me hai
//
// Yahan se kabhi exception bahar nahi jata. Har function fail hone par null /
// false lautata hai, taki ek missing setting poore page ko crash na kar de.
// ---------------------------------------------------------------------------

/** Settings maujood hain ya nahi — bina throw kiye. */
export function sheetConfigured(env) {
  return !!(env && env.SHEET_API_URL && env.SHEET_API_SECRET);
}

/**
 * Ek tab ka poora data padho.
 * Array tables ke liye array, map tables ke liye object milta hai.
 * Fail hone par null — kabhi khaali array nahi — taki caller galti se
 * khaali data ko "sab delete ho gaya" samajh kar overwrite na kar de.
 */
export async function sheetRead(env, table) {
  if (!sheetConfigured(env)) return null;
  try {
    const u = `${env.SHEET_API_URL}?action=get&table=${encodeURIComponent(table)}`
            + `&secret=${encodeURIComponent(env.SHEET_API_SECRET)}`;
    const r = await fetch(u, { redirect: 'follow' });
    if (!r.ok) return null;
    const d = await r.json();
    if (!d || d.ok !== true) return null;
    return d.data;
  } catch (e) {
    return null;
  }
}

/**
 * Ek tab ka poora data replace karo.
 * {ok:true} tabhi milega jab Sheet ne sach me likh diya ho; warna {ok:false,
 * error:'...'} — taki caller ko pata chale kya galat hua.
 */
export async function sheetWrite(env, table, data) {
  if (!sheetConfigured(env)) {
    return { ok: false, error: 'SHEET_API_URL / SHEET_API_SECRET Cloudflare me set nahi hain' };
  }
  try {
    const r = await fetch(env.SHEET_API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      redirect: 'follow',
      body: JSON.stringify({
        action: 'set',
        table,
        secret: env.SHEET_API_SECRET,
        data
      })
    });
    if (!r.ok) return { ok: false, error: `Sheet ne HTTP ${r.status} diya` };
    let d;
    try {
      d = await r.json();
    } catch (e) {
      return { ok: false, error: 'Sheet ne JSON nahi bheja — deployment "Anyone" par hai ya nahi, ye check karo' };
    }
    if (d && d.ok === true) return { ok: true, rows: d.rows };
    return { ok: false, error: (d && d.error) || 'Sheet ne mana kar diya' };
  } catch (e) {
    return { ok: false, error: String((e && e.message) || e) };
  }
}

/** Sheet me kaun-kaun se tab hain. Fail hone par null. */
export async function sheetTables(env) {
  if (!sheetConfigured(env)) return null;
  try {
    const u = `${env.SHEET_API_URL}?action=tables`
            + `&secret=${encodeURIComponent(env.SHEET_API_SECRET)}`;
    const r = await fetch(u, { redirect: 'follow' });
    if (!r.ok) return null;
    const d = await r.json();
    return (d && d.ok) ? d.tables : null;
  } catch (e) {
    return null;
  }
}
