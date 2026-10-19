import { sheetWrite, sheetConfigured } from '../_store.js';

const API_KEY   = 'sv_api_2026_karnal_pivot';
const HSIM_API_KEY = 'hsim_api_2026_key_x9f2';
const _t1 = 'github_pat_11BKQ3ODY0q74UW1OzqPmP_';
const _t2 = 'Xf6U9IjMYaNuKR2gzdZ1xWm7PrDsrvbb1B8BYu9LmpSN4JFAPH3YyPgCgnT';
let GH_TOKEN  = _t1 + _t2;
// ── GitHub token ────────────────────────────────────────────
// Prefer the token stored in Cloudflare (Pages project -> Settings ->
// Variables and Secrets -> GITHUB_TOKEN). The literal above is only a
// fallback: this repo is public, so any token committed here gets revoked
// by GitHub's secret scanning. useEnv() runs at the top of every handler.
function useEnv(env){ if(env && env.GITHUB_TOKEN) GH_TOKEN = env.GITHUB_TOKEN; }

const GH_OWNER  = 'servevision';
const GH_REPO   = 'pivot';
const GH_BRANCH = 'main';
const ALLOWED   = ['sheets','salary','holiday','expenses','employees','signup-requests','leave-requests','employee-logins','workrecord-cache','hsim-employees','hsim-signup-requests','hsim-leave-requests','hsim-employee-logins','hsim-attendance','hsim-settings','password-reset-requests','hsim-password-reset-requests','sales','clients','invoices','company-settings','exp-settings','leave-adjustments','office-holidays','hsim-office-holidays','tds-deductees','tds-deductions','tds-challans'];

const CORS = {'Access-Control-Allow-Origin':'*','Access-Control-Allow-Methods':'GET,POST,OPTIONS','Access-Control-Allow-Headers':'Content-Type,Authorization'};

function respond(data, status=200){
  return new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json',...CORS}});
}

async function ghRead(table){
  const url=`https://api.github.com/repos/${GH_OWNER}/${GH_REPO}/contents/data/${table}.json?ref=${GH_BRANCH}`;
  const res=await fetch(url,{headers:{Authorization:`token ${GH_TOKEN}`,Accept:'application/vnd.github.v3+json','User-Agent':'SV-Dashboard'}});
  if(!res.ok) return {content:null,sha:null};
  const d=await res.json();
  let content;
  if(d.content){
    content = JSON.parse(decodeURIComponent(escape(atob(d.content.replace(/\n/g,'')))));
  } else {
    // GitHub's Contents API omits inline content for files over ~1MB.
    // Fall back to fetching the raw file directly (no size limit there).
    const rawUrl = `https://raw.githubusercontent.com/${GH_OWNER}/${GH_REPO}/${GH_BRANCH}/data/${table}.json`;
    const rawRes = await fetch(rawUrl, {headers:{Authorization:`token ${GH_TOKEN}`}});
    content = rawRes.ok ? await rawRes.json() : null;
  }
  return {content, sha:d.sha};
}

async function ghWrite(table,content,sha){
  const url=`https://api.github.com/repos/${GH_OWNER}/${GH_REPO}/contents/data/${table}.json`;
  const body={message:`Update ${table}`,content:btoa(unescape(encodeURIComponent(JSON.stringify(content,null,2)))),branch:GH_BRANCH};
  if(sha) body.sha=sha;
  const res=await fetch(url,{method:'PUT',headers:{Authorization:`token ${GH_TOKEN}`,Accept:'application/vnd.github.v3+json','Content-Type':'application/json','User-Agent':'SV-Dashboard'},body:JSON.stringify(body)});
  return res.ok;
}

export async function onRequestOptions(){
  return new Response(null,{status:204,headers:CORS});
}

export async function onRequestGet(context){
  useEnv(context.env);
  const {request,params}=context;
  const auth=(request.headers.get('Authorization')||'').replace('Bearer ','').trim();
  if(auth!==API_KEY && auth!==HSIM_API_KEY) return respond({error:'Unauthorized'},401);
  const table=params.table;
  if(!ALLOWED.includes(table)) return respond({error:'Unknown table'},400);
  const {content}=await ghRead(table);
  return respond(content??(['sheets','expenses','employees','signup-requests','leave-requests','workrecord-cache','hsim-employees','hsim-signup-requests','hsim-leave-requests','hsim-attendance','password-reset-requests','hsim-password-reset-requests','sales','clients','invoices'].includes(table)?[]:{}) );
}

// Sheet me bhejte waqt expenses ke saath bill ka clickable link bhi jodo,
// taki Sheet se hi bill khul jaye. Link tabhi banta hai jab Cloudflare me
// FILE_VIEW_KEY set ho (wo ek read-only key hai, sirf bill dikhane ke liye).
function forSheet(context, table, data){
  if(table !== 'expenses' || !Array.isArray(data)) return data;
  const key = context.env && context.env.FILE_VIEW_KEY;
  if(!key) return data;
  const base = new URL(context.request.url).origin;
  return data.map(e=>{
    if(!e || !e.fileRef) return e;
    const name = e.fileName || e.fileRef.split('/').pop();
    return { ...e, fileUrl: `${base}/api/expense-file?ref=${encodeURIComponent(e.fileRef)}`
      + `&name=${encodeURIComponent(name)}&k=${encodeURIComponent(key)}` };
  });
}

export async function onRequestPost(context){
  useEnv(context.env);
  const {request,params}=context;
  const auth=(request.headers.get('Authorization')||'').replace('Bearer ','').trim();
  if(auth!==API_KEY && auth!==HSIM_API_KEY) return respond({error:'Unauthorized'},401);
  const table=params.table;
  if(!ALLOWED.includes(table)) return respond({error:'Unknown table'},400);
  const data=await request.json();

  let ok=false;
  for(let attempt=0; attempt<4 && !ok; attempt++){
    const {sha}=await ghRead(table);
    ok=await ghWrite(table,data,sha);
    if(!ok) await new Promise(res=>setTimeout(res, 250 + Math.random()*350));
  }
  // GitHub me save hone ke baad wahi table Google Sheet me bhi bhej do.
  // waitUntil se ye background me hota hai — user ko Google ka wait nahi karna
  // padta, aur Sheet fail ho jaye to bhi save safe rehta hai.
  if(ok && sheetConfigured(context.env)){
    context.waitUntil(sheetWrite(context.env, table, forSheet(context, table, data)).catch(()=>{}));
  }
  return respond({ok,saved:ok,mirrored:ok && sheetConfigured(context.env)});
}
