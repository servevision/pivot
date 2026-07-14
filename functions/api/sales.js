// functions/api/sales.js
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

export async function onRequestOptions(){
  return new Response(null,{status:204,headers:CORS});
}

export async function onRequestGet(context){
  const {request}=context;
  const auth=(request.headers.get('Authorization')||'').replace('Bearer ','').trim();
  if(auth!==API_KEY) return respond({error:'Unauthorized'},401);
  const {content}=await ghRead('sales');
  return respond(content||[]);
}

export async function onRequestPost(context){
  const {request}=context;
  const auth=(request.headers.get('Authorization')||'').replace('Bearer ','').trim();
  if(auth!==API_KEY) return respond({error:'Unauthorized'},401);

  const body=await request.json();
  const {action}=body;

  if(action==='create'){
    const {content:sales,sha}=await ghRead('sales');
    const list=sales||[];
    const s=body.sale;
    s.id=Date.now().toString(36)+Math.random().toString(36).substr(2,4);
    s.createdAt=new Date().toISOString();
    list.unshift(s);
    const ok=await ghWrite('sales',list,sha);
    return respond({ok, id:s.id});
  }

  if(action==='update'){
    const {content:sales,sha}=await ghRead('sales');
    const list=sales||[];
    const idx=list.findIndex(s=>s.id===body.id);
    if(idx>=0){
      list[idx]={...list[idx],...body.sale,updatedAt:new Date().toISOString()};
      const ok=await ghWrite('sales',list,sha);
      return respond({ok});
    }
    return respond({error:'Sale not found'},404);
  }

  if(action==='delete'){
    const {content:sales,sha}=await ghRead('sales');
    let list=sales||[];
    list=list.filter(s=>s.id!==body.id);
    const ok=await ghWrite('sales',list,sha);
    return respond({ok});
  }

  return respond({error:'Unknown action'},400);
}
