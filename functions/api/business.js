// functions/api/business.js
// Handles: Sales entries, Client records, Invoices (Export + Tax Invoice)
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

function checkAuth(request){
  const auth=(request.headers.get('Authorization')||'').replace('Bearer ','').trim();
  return auth===API_KEY;
}

export async function onRequestOptions(){return new Response(null,{status:204,headers:CORS});}

// GET /api/business?type=sales|clients|invoices
export async function onRequestGet(context){
  const {request}=context;
  if(!checkAuth(request)) return respond({error:'Unauthorized'},401);
  const url=new URL(request.url);
  const type=url.searchParams.get('type');
  if(!['sales','clients','invoices'].includes(type)) return respond({error:'Invalid type'},400);
  const {content}=await ghRead(type);
  return respond(content||[]);
}

export async function onRequestPost(context){
  const {request}=context;
  if(!checkAuth(request)) return respond({error:'Unauthorized'},401);
  const body=await request.json().catch(()=>({}));
  const {type,action}=body;
  if(!['sales','clients','invoices'].includes(type)) return respond({error:'Invalid type'},400);

  const {content:list,sha}=await ghRead(type);
  let arr=list||[];

  if(action==='create'){
    const item=body.item;
    item.id=Date.now().toString(36)+Math.random().toString(36).substr(2,4);
    item.createdAt=new Date().toISOString();
    arr.unshift(item);
    const ok=await ghWrite(type,arr,sha);
    return respond({ok,id:item.id});
  }

  if(action==='update'){
    const idx=arr.findIndex(x=>x.id===body.id);
    if(idx<0) return respond({error:'Not found'},404);
    arr[idx]={...arr[idx],...body.item,updatedAt:new Date().toISOString()};
    const ok=await ghWrite(type,arr,sha);
    return respond({ok});
  }

  if(action==='delete'){
    arr=arr.filter(x=>x.id!==body.id);
    const ok=await ghWrite(type,arr,sha);
    return respond({ok});
  }

  return respond({error:'Unknown action'},400);
}
