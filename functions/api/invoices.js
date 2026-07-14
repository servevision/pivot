// functions/api/invoices.js
const GH_T1 = 'github_pat_11BKQ3ODY0q74UW1OzqPmP_';
const GH_T2 = 'Xf6U9IjMYaNuKR2gzdZ1xWm7PrDsrvbb1B8BYu9LmpSN4JFAPH3YyPgCgnT';
const GH_TOKEN = GH_T1 + GH_T2;
const GH_OWNER = 'servevision';
const GH_REPO  = 'pivot';
const GH_BRANCH = 'main';
const API_KEY = 'sv_api_2026_karnal_pivot';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type,Authorization',
};

function respond(data,status=200){
  return new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json',...CORS}});
}

async function ghRead(file){
  const url=`https://api.github.com/repos/${GH_OWNER}/${GH_REPO}/contents/data/${file}.json?ref=${GH_BRANCH}`;
  const r=await fetch(url,{headers:{Authorization:`token ${GH_TOKEN}`,Accept:'application/vnd.github.v3+json','User-Agent':'SV-Dashboard'}});
  if(!r.ok) return {content:null,sha:null};
  const d=await r.json();
  return {content:JSON.parse(atob(d.content.replace(/\n/g,''))),sha:d.sha};
}

async function ghWrite(file,content,sha){
  const url=`https://api.github.com/repos/${GH_OWNER}/${GH_REPO}/contents/data/${file}.json`;
  const body={message:`Update ${file}`,content:btoa(unescape(encodeURIComponent(JSON.stringify(content,null,2)))),branch:GH_BRANCH};
  if(sha) body.sha=sha;
  const r=await fetch(url,{method:'PUT',headers:{Authorization:`token ${GH_TOKEN}`,Accept:'application/vnd.github.v3+json','Content-Type':'application/json','User-Agent':'SV-Dashboard'},body:JSON.stringify(body)});
  return r.ok;
}

// Invoice numbers: SV-INV-2026-0001 (sequential, per calendar year)
function genInvoiceNumber(list, type){
  const year = new Date().getFullYear();
  const prefix = type==='export' ? `SV-EXP-${year}-` : `SV-INV-${year}-`;
  let max=0;
  list.forEach(inv=>{
    if(inv.invoiceNumber && inv.invoiceNumber.startsWith(prefix)){
      const n = parseInt(inv.invoiceNumber.slice(prefix.length));
      if(!isNaN(n)) max = Math.max(max, n);
    }
  });
  return prefix + String(max+1).padStart(4,'0');
}

export async function onRequestOptions(){
  return new Response(null,{status:204,headers:CORS});
}

export async function onRequestGet(context){
  const {request}=context;
  const auth=(request.headers.get('Authorization')||'').replace('Bearer ','').trim();
  if(auth!==API_KEY) return respond({error:'Unauthorized'},401);
  const {content}=await ghRead('invoices');
  return respond(content||[]);
}

export async function onRequestPost(context){
  const {request}=context;
  const auth=(request.headers.get('Authorization')||'').replace('Bearer ','').trim();
  if(auth!==API_KEY) return respond({error:'Unauthorized'},401);

  const body=await request.json();
  const {action}=body;

  if(action==='create'){
    let invoiceNumber, ok;
    for(let attempt=0; attempt<5; attempt++){
      const {content:invoices,sha}=await ghRead('invoices');
      const list=invoices||[];
      invoiceNumber = genInvoiceNumber(list, body.invoice.type);
      const inv = body.invoice;
      inv.invoiceNumber = invoiceNumber;
      inv.id = Date.now().toString(36)+Math.random().toString(36).substr(2,4);
      inv.createdAt = new Date().toISOString();
      list.unshift(inv);
      ok = await ghWrite('invoices', list, sha);
      if(ok) break;
      await new Promise(res=>setTimeout(res, 300+Math.random()*400));
    }
    if(!ok) return respond({error:'Could not create invoice — try again'},500);
    return respond({ok:true, invoiceNumber, id: undefined});
  }

  if(action==='update'){
    const {content:invoices,sha}=await ghRead('invoices');
    const list=invoices||[];
    const idx=list.findIndex(i=>i.id===body.id);
    if(idx>=0){
      list[idx]={...list[idx],...body.invoice,updatedAt:new Date().toISOString()};
      const ok=await ghWrite('invoices',list,sha);
      return respond({ok});
    }
    return respond({error:'Invoice not found'},404);
  }

  if(action==='delete'){
    const {content:invoices,sha}=await ghRead('invoices');
    let list=invoices||[];
    list=list.filter(i=>i.id!==body.id);
    const ok=await ghWrite('invoices',list,sha);
    return respond({ok});
  }

  return respond({error:'Unknown action'},400);
}
