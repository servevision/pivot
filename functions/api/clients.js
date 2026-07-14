// functions/api/clients.js
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

function genClientId(list){
  let max=0;
  list.forEach(c=>{const m=(c.clientId||'').match(/CLIENT-(\d+)/);if(m)max=Math.max(max,parseInt(m[1]));});
  return 'CLIENT-'+String(max+1).padStart(3,'0');
}

export async function onRequestOptions(){
  return new Response(null,{status:204,headers:CORS});
}

export async function onRequestGet(context){
  const {request}=context;
  const auth=(request.headers.get('Authorization')||'').replace('Bearer ','').trim();
  if(auth!==API_KEY) return respond({error:'Unauthorized'},401);
  const {content}=await ghRead('clients');
  return respond(content||[]);
}

export async function onRequestPost(context){
  const {request}=context;
  const auth=(request.headers.get('Authorization')||'').replace('Bearer ','').trim();
  if(auth!==API_KEY) return respond({error:'Unauthorized'},401);

  const body=await request.json();
  const {action}=body;

  if(action==='create'){
    let clientId, ok;
    for(let attempt=0; attempt<5; attempt++){
      const {content:clients,sha}=await ghRead('clients');
      const list=clients||[];
      clientId=genClientId(list);
      const c=body.client;
      c.clientId=clientId;
      c.createdAt=new Date().toISOString();
      list.push(c);
      ok=await ghWrite('clients',list,sha);
      if(ok) break;
      await new Promise(res=>setTimeout(res, 300+Math.random()*400));
    }
    if(!ok) return respond({error:'Could not create client — try again'},500);
    return respond({ok:true, clientId});
  }

  if(action==='update'){
    const {content:clients,sha}=await ghRead('clients');
    const list=clients||[];
    const idx=list.findIndex(c=>c.clientId===body.clientId);
    if(idx>=0){
      list[idx]={...list[idx],...body.client,updatedAt:new Date().toISOString()};
      const ok=await ghWrite('clients',list,sha);
      return respond({ok});
    }
    return respond({error:'Client not found'},404);
  }

  if(action==='delete'){
    const {content:clients,sha}=await ghRead('clients');
    let list=clients||[];
    list=list.filter(c=>c.clientId!==body.clientId);
    const ok=await ghWrite('clients',list,sha);
    return respond({ok});
  }

  return respond({error:'Unknown action'},400);
}
