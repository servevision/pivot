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
// ---------------------------------------------------------------------------

function cfg(env) {
  const url = env && env.SHEET_API_URL;
  const secret = env && env.SHEET_API_SECRET;
  if (!url || !secret) {
    throw new Error('Sheet is not configured — set SHEET_API_URL and SHEET_API_SECRET in Cloudflare');
  }
  return { url, secret };
}

/**
 * Ek tab ka poora data padho.
 * Array tables ke liye array, map tables ke liye object milta hai.
 * Fail hone par null (kabhi khaali array nahi) — taki caller galti se
 * khaali data ko "sab delete ho gaya" samajh kar overwrite na kar de.
 */
export async function sheetRead(env, table) {
  const { url, secret } = cfg(env);
  const u = `${url}?action=get&table=${encodeURIComponent(table)}&secret=${encodeURIComponent(secret)}`;
  try {
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
 * true tabhi lautega jab Sheet ne sach me likh diya ho.
 */
export async function sheetWrite(env, table, data) {
  const { url, secret } = cfg(env);
  try {
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      redirect: 'follow',
      body: JSON.stringify({ action: 'set', table, secret, data })
    });
    if (!r.ok) return false;
    const d = await r.json();
    return !!(d && d.ok === true);
  } catch (e) {
    return false;
  }
}

/** Sheet me kaun-kaun se tab hain. */
export async function sheetTables(env) {
  const { url, secret } = cfg(env);
  const u = `${url}?action=tables&secret=${encodeURIComponent(secret)}`;
  try {
    const r = await fetch(u, { redirect: 'follow' });
    if (!r.ok) return null;
    const d = await r.json();
    return (d && d.ok) ? d.tables : null;
  } catch (e) {
    return null;
  }
}
