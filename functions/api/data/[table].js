const API_KEY = 'sv_api_2026_karnal_pivot';
const GH_BRANCH = 'main';
const CORS = {'Access-Control-Allow-Origin':'*','Access-Control-Allow-Methods':'GET,POST,OPTIONS','Access-Control-Allow-Headers':'Content-Type,Authorization'};

function r(data,status=200){
  return new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json',...CORS}});
}

async function ghRead(env,table){
  const url=`https://api.github.com/repos/${env.GITHUB_OWNER}/${env.GITHUB_REPO}/contents/data/${table}.json?ref=${GH_BRANCH}`;
  const res=await fetch(url,{headers:{Authorization:`token ${env.GITHUB_TOKEN}`,Accept:'application/vnd.github.v3+json','User-Agent':'ServevisionDashboard'}});
  if(!res.ok)return{content:null,sha:null};
  const d=await res.json();
  return{content:JSON.parse(atob(d.content.replace(/\n/g,''))),sha:d.sha};
}

async function ghWrite(env,table,content,sha){
  const url=`https://api.github.com/repos/${env.GITHUB_OWNER}/${env.GITHUB_REPO}/contents/data/${table}.json`;
  const body={message:`Update ${table}`,content:btoa(unescape(encodeURIComponent(JSON.stringify(content,null,2)))),branch:GH_BRANCH};
  if(sha)body.sha=sha;
  const res=await fetch(url,{method:'PUT',headers:{Authorization:`token ${env.GITHUB_TOKEN}`,Accept:'application/vnd.github.v3+json','Content-Type':'application/json','User-Agent':'ServevisionDashboard'},body:JSON.stringify(body)});
  return res.ok;
}

export async function onRequestOptions(){
  return new Response(null,{status:204,headers:CORS});
}

export async function onRequestGet(context){
  const {request,env,params}=context;
  const auth=request.headers.get('Authorization')||'';
  if(auth.replace('Bearer ','').trim()!==API_KEY) return r({error:'Unauthorized'},401);
  const table=params.table;
  if(!['sheets','salary','holiday'].includes(table)) return r({error:'Unknown'},400);
  const {content}=await ghRead(env,table);
  return r(content??(table==='sheets'?[]:{}) );
}

export async function onRequestPost(context){
  const {request,env,params}=context;
  const auth=request.headers.get('Authorization')||'';
  if(auth.replace('Bearer ','').trim()!==API_KEY) return r({error:'Unauthorized'},401);
  const table=params.table;
  if(!['sheets','salary','holiday'].includes(table)) return r({error:'Unknown'},400);
  const data=await request.json();
  const {sha}=await ghRead(env,table);
  const ok=await ghWrite(env,table,data,sha);
  return r({ok,saved:ok});
}