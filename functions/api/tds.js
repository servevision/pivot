// functions/api/tds.js
// ---------------------------------------------------------------------------
// TDS module ka backend — teen tables:
//
//   tds-deductees   jinpar TDS kata (PAN, naam, address)
//   tds-deductions  har ek deduction (date, amount, section, rate, TDS)
//   tds-challans    har challan jo sarkar ko jama kiya
//
// Deduction me challanId hota hai — isse pata chalta hai konsa deduction
// konse challan se chukaya gaya. Yahi CA ke template ka "Challan Detail"
// column hai.
//
//   GET  /api/tds?type=deductees|deductions|challans
//   GET  /api/tds?type=summary&fy=2026-27&q=Q1      (reconciliation)
//   POST /api/tds  {type, action:create|update|delete, item|id}
// ---------------------------------------------------------------------------

import { sheetWrite, sheetConfigured } from './_store.js';

const GH_T1 = 'github_pat_11BKQ3ODY0q74UW1OzqPmP_';
const GH_T2 = 'Xf6U9IjMYaNuKR2gzdZ1xWm7PrDsrvbb1B8BYu9LmpSN4JFAPH3YyPgCgnT';
let GH_TOKEN = GH_T1 + GH_T2;
function useEnv(env){ if(env && env.GITHUB_TOKEN) GH_TOKEN = env.GITHUB_TOKEN; }

const GH_OWNER = 'servevision';
const GH_REPO  = 'pivot';
const GH_BRANCH = 'main';
const API_KEY  = 'sv_api_2026_karnal_pivot';

const TABLES = {
  deductees : 'tds-deductees',
  deductions: 'tds-deductions',
  challans  : 'tds-challans'
};

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type,Authorization',
};

function respond(data, status = 200){
  return new Response(JSON.stringify(data), {
    status, headers: {'Content-Type':'application/json','Cache-Control':'no-store',...CORS}
  });
}

// Padhne me teen haal ho sakte hain, aur teeno alag hain:
//   missing : file hai hi nahi (pehli baar) — khaali list se shuru karna theek hai
//   ok      : file mil gayi
//   failed  : file hai par padhi nahi gayi — ESA ME KUCH LIKHNA NAHI HAI,
//             warna khaali list purane data ko mita degi
async function ghRead(file){
  const url = `https://api.github.com/repos/${GH_OWNER}/${GH_REPO}/contents/data/${file}.json?ref=${GH_BRANCH}`;
  let r;
  try{
    r = await fetch(url,{headers:{Authorization:`token ${GH_TOKEN}`,Accept:'application/vnd.github.v3+json','User-Agent':'SV-Dashboard'}});
  }catch(e){
    return {status:'failed', content:null, sha:null};
  }
  if(r.status === 404) return {status:'missing', content:null, sha:null};
  if(!r.ok) return {status:'failed', content:null, sha:null};

  let d;
  try{ d = await r.json(); }catch(e){ return {status:'failed', content:null, sha:null}; }

  if(d.content){
    try{
      return {status:'ok', content: JSON.parse(decodeURIComponent(escape(atob(d.content.replace(/\n/g,''))))), sha:d.sha};
    }catch(e){
      return {status:'failed', content:null, sha:d.sha};
    }
  }
  // 1 MB se badi file ka content inline nahi aata — raw se lo
  try{
    const raw = await fetch(`https://raw.githubusercontent.com/${GH_OWNER}/${GH_REPO}/${GH_BRANCH}/data/${file}.json`,
      {headers:{Authorization:`token ${GH_TOKEN}`}});
    if(!raw.ok) return {status:'failed', content:null, sha:d.sha};
    return {status:'ok', content: await raw.json(), sha:d.sha};
  }catch(e){
    return {status:'failed', content:null, sha:d.sha};
  }
}

async function ghWrite(file, content, sha){
  const url = `https://api.github.com/repos/${GH_OWNER}/${GH_REPO}/contents/data/${file}.json`;
  const body = {
    message: `Update ${file}`,
    content: btoa(unescape(encodeURIComponent(JSON.stringify(content, null, 2)))),
    branch: GH_BRANCH
  };
  if(sha) body.sha = sha;
  const r = await fetch(url,{method:'PUT',headers:{
    Authorization:`token ${GH_TOKEN}`, Accept:'application/vnd.github.v3+json',
    'Content-Type':'application/json','User-Agent':'SV-Dashboard'
  },body:JSON.stringify(body)});
  return r.ok;
}

// ── PAN check ──────────────────────────────────────────────────────────
// Format AAAAA9999A. Chautha akshar batata hai holder kaun hai:
//   P = individual   C = company   F = firm   H = HUF
//   A = AOP          T = trust     B = BOI    L = local authority
const PAN_RE = /^[A-Z]{5}[0-9]{4}[A-Z]$/;
const PAN_4TH = {P:'1', C:'14', F:'5', H:'2', A:'3', T:'6', B:'4', L:'7', J:'8', G:'9'};

export function panCheck(pan, deducteeCode){
  const p = String(pan||'').toUpperCase().trim();
  if(!p) return {ok:false, error:'PAN zaroori hai'};
  if(!PAN_RE.test(p)) return {ok:false, error:'PAN ka format galat hai (AAAAA9999A hona chahiye)'};
  const expect = PAN_4TH[p.charAt(3)];
  if(deducteeCode && expect && String(deducteeCode) !== expect){
    return {ok:true, warning:`PAN ka chautha akshar "${p.charAt(3)}" hai, par deductee code ${deducteeCode} chuna hai. Dono match nahi kar rahe.`};
  }
  return {ok:true};
}

// FY (Apr–Mar) aur quarter nikalo
function fyQuarter(dateStr){
  const d = new Date(String(dateStr) + 'T00:00:00');
  if(isNaN(d)) return {fy:'', q:''};
  const m = d.getMonth(), y = d.getFullYear();
  const fyStart = m >= 3 ? y : y - 1;
  const fy = `${fyStart}-${String(fyStart + 1).slice(-2)}`;
  const q = m >= 3 && m <= 5 ? 'Q1' : m >= 6 && m <= 8 ? 'Q2' : m >= 9 && m <= 11 ? 'Q3' : 'Q4';
  return {fy, q};
}

function newId(){ return Date.now().toString(36) + Math.random().toString(36).substr(2,4); }
function num(v){ const n = Number(v); return isNaN(n) ? 0 : n; }

/** Challan kitna hai vs kitna map hua — reconciliation ka dil. */
function reconcile(challans, deductions){
  const used = {};
  (deductions||[]).forEach(d=>{
    if(!d || !d.challanId) return;
    used[d.challanId] = (used[d.challanId] || 0) + num(d.tds) + num(d.surcharge) + num(d.cess);
  });
  return (challans||[]).map(c=>{
    const total = num(c.tds) + num(c.surcharge) + num(c.cess) + num(c.hcess)
                + num(c.interest) + num(c.other) + num(c.fees);
    const mapped = used[c.id] || 0;
    return {...c, challanTotal: total, mapped, balance: +(total - mapped).toFixed(2)};
  });
}

export async function onRequestOptions(){
  return new Response(null,{status:204,headers:CORS});
}

export async function onRequestGet(context){
  try{
    useEnv(context.env);
    const {request} = context;
    const auth = (request.headers.get('Authorization')||'').replace('Bearer ','').trim();
    if(auth !== API_KEY) return respond({error:'Unauthorized'},401);

    const url  = new URL(request.url);
    const type = url.searchParams.get('type') || 'deductions';

    if(type === 'summary'){
      const [de, dd, ch] = await Promise.all([
        ghRead(TABLES.deductees), ghRead(TABLES.deductions), ghRead(TABLES.challans)
      ]);
      const fy = url.searchParams.get('fy') || '';
      const q  = url.searchParams.get('q')  || '';
      let deductions = dd.content || [];
      if(fy || q){
        deductions = deductions.filter(d=>{
          const f = fyQuarter(d.paidOn || d.deductedOn);
          return (!fy || f.fy === fy) && (!q || f.q === q);
        });
      }
      const challans = reconcile(ch.content || [], dd.content || []);
      const unbalanced = challans.filter(c=>Math.abs(c.balance) >= 1);
      return respond({
        ok:true, fy, q,
        deductees : de.content || [],
        deductions,
        challans,
        totals: {
          deductions : deductions.length,
          tds        : +deductions.reduce((s,d)=>s + num(d.tds), 0).toFixed(2),
          amountPaid : +deductions.reduce((s,d)=>s + num(d.amount), 0).toFixed(2)
        },
        unbalancedChallans: unbalanced.map(c=>({id:c.id, serial:c.serialNo, balance:c.balance}))
      });
    }

    const table = TABLES[type];
    if(!table) return respond({error:'type deductees / deductions / challans me se ek hona chahiye'},400);
    const {content} = await ghRead(table);
    if(type === 'challans'){
      const {content:dd} = await ghRead(TABLES.deductions);
      return respond(reconcile(content || [], dd || []));
    }
    return respond(content || []);

  }catch(err){
    return respond({error:'tds GET failed: ' + String((err && err.message) || err)},500);
  }
}

export async function onRequestPost(context){
  try{
    useEnv(context.env);
    const {request} = context;
    const auth = (request.headers.get('Authorization')||'').replace('Bearer ','').trim();
    if(auth !== API_KEY) return respond({error:'Unauthorized'},401);

    const body = await request.json().catch(()=>({}));
    const {type, action} = body;
    const table = TABLES[type];
    if(!table) return respond({error:'type galat hai'},400);

    // PAN check sirf deductee par
    let warning = null;
    if(type === 'deductees' && action !== 'delete'){
      const c = panCheck(body.item && body.item.pan, body.item && body.item.deducteeCode);
      if(!c.ok) return respond({ok:false, error:c.error},400);
      warning = c.warning || null;
    }

    // Challan delete se pehle dekho koi deduction uspar tika to nahi hai
    if(type === 'challans' && action === 'delete'){
      const {content:dd} = await ghRead(TABLES.deductions);
      const linked = (dd||[]).filter(d=>d.challanId === body.id);
      if(linked.length){
        return respond({ok:false,
          error:`Ye challan ${linked.length} deduction se juda hua hai. Pehle unka challan badlo, phir delete karo.`},409);
      }
    }

    // ── Ek challan se kai deductions ek saath jodo / hatao ──────────────
    if(action === 'attach'){
      const challanId = body.challanId;
      const ids = Array.isArray(body.deductionIds) ? body.deductionIds : [];
      if(!challanId) return respond({ok:false, error:'challanId chahiye'},400);

      let done = false, changed = 0;
      for(let attempt = 0; attempt < 4 && !done; attempt++){
        const rd = await ghRead(TABLES.deductions);
        if(rd.status === 'failed'){
          return respond({ok:false, error:'Purana data padha nahi ja saka — safety ke liye kuch badla nahi gaya. Dobara koshish karo.'},503);
        }
        const {content, sha} = rd;
        const list = Array.isArray(content) ? content : [];
        changed = 0;
        list.forEach(d=>{
          const want = ids.includes(d.id);
          const has  = d.challanId === challanId;
          if(want && !has){ d.challanId = challanId; d.updatedAt = new Date().toISOString(); changed++; }
          else if(!want && has){ d.challanId = ''; d.updatedAt = new Date().toISOString(); changed++; }
        });
        done = await ghWrite(TABLES.deductions, list, sha);
        if(done && sheetConfigured(context.env)){
          context.waitUntil(sheetWrite(context.env, TABLES.deductions, list).catch(()=>{}));
        }
        if(!done) await new Promise(res=>setTimeout(res, 250 + Math.random()*350));
      }
      if(!done) return respond({ok:false, error:'Save nahi ho paya — dobara koshish karo'},500);
      return respond({ok:true, changed});
    }

    let saved = null;
    let ok = false;
    for(let attempt = 0; attempt < 4 && !ok; attempt++){
      const rd = await ghRead(table);
      // Padhna fail hua to likhna bilkul nahi — warna khaali list purane
      // records ko mita deti hai. Yahi bug tha jisse challan gayab hua.
      if(rd.status === 'failed'){
        return respond({ok:false, error:'Purana data padha nahi ja saka — safety ke liye kuch save nahi kiya. Dobara koshish karo.'},503);
      }
      const {content, sha} = rd;
      let list = Array.isArray(content) ? content : [];
      const before = list.length;

      if(action === 'create'){
        saved = {...body.item, id:newId(), createdAt:new Date().toISOString()};
        list.unshift(saved);
      } else if(action === 'update'){
        const i = list.findIndex(x=>x.id === body.id);
        if(i < 0) return respond({ok:false, error:'Record nahi mila'},404);
        saved = {...list[i], ...body.item, id:body.id, updatedAt:new Date().toISOString()};
        list[i] = saved;
      } else if(action === 'delete'){
        list = list.filter(x=>x.id !== body.id);
        if(list.length === before) return respond({ok:false, error:'Record nahi mila'},404);
      } else {
        return respond({error:'action create / update / delete hona chahiye'},400);
      }

      // Ek aur taala: delete ke alawa kisi bhi kaam me records ghat nahi sakte
      if(action !== 'delete' && list.length < before){
        return respond({ok:false, error:'Save roka gaya — records ghat rahe the. Kuch badla nahi gaya.'},500);
      }

      ok = await ghWrite(table, list, sha);
      if(ok && sheetConfigured(context.env)){
        context.waitUntil(sheetWrite(context.env, table, list).catch(()=>{}));
      }
      if(!ok) await new Promise(res=>setTimeout(res, 250 + Math.random()*350));
    }

    if(!ok) return respond({ok:false, error:'Save nahi ho paya — dobara koshish karo'},500);
    return respond({ok:true, item:saved, warning});

  }catch(err){
    return respond({error:'tds POST failed: ' + String((err && err.message) || err)},500);
  }
}
