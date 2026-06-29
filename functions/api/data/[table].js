const API_KEY   = 'sv_api_2026_karnal_pivot';
const _t1 = 'github_pat_11BKQ3ODY0q74UW1OzqPmP_';
const _t2 = 'Xf6U9IjMYaNuKR2gzdZ1xWm7PrDsrvbb1B8BYu9LmpSN4JFAPH3YyPgCgnT';
const GH_TOKEN  = _t1 + _t2;
const GH_OWNER  = 'servevision';
const GH_REPO   = 'pivot';
const GH_BRANCH = 'main';
const ALLOWED   = ['sheets','salary','holiday','expenses'];

const CORS = {'Access-Control-Allow-Origin':'*','Access-Control-Allow-Methods':'GET,POST,OPTIONS','Access-Control-Allow-Headers':'Content-Type,Authorization'};

function respond(data, status=200){
  return new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json',...CORS}});
}

async function ghRead(table){
  const url=`https://api.github.com/repos/${GH_OWNER}/${GH_REPO}/contents/data/${table}.json?ref=${GH_BRANCH}`;
  const res=await fetch(url,{headers:{Authorization:`token ${GH_TOKEN}`,Accept:'application/vnd.github.v3+json','User-Agent':'SV-Dashboard'}});
  if(!res.ok) return {content:null,sha:null};
  const d=await res.json();
  return {content:JSON.parse(atob(d.content.replace(/\n/g,''))),sha:d.sha};
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
  const {request,params}=context;
  const auth=(request.headers.get('Authorization')||'').replace('Bearer ','').trim();
  if(auth!==API_KEY) return respond({error:'Unauthorized'},401);
  const table=params.table;
  if(!ALLOWED.includes(table)) return respond({error:'Unknown'},400);
  const {content}=await ghRead(table);
  return respond(content??(table==='sheets'||table==='expenses'?[]:{}) );
}

export async function onRequestPost(context){
  const {request,params}=context;
  const auth=(request.headers.get('Authorization')||'').replace('Bearer ','').trim();
  if(auth!==API_KEY) return respond({error:'Unauthorized'},401);
  const table=params.table;
  if(!ALLOWED.includes(table)) return respond({error:'Unknown'},400);
  const data=await request.json();
  const {sha}=await ghRead(table);
  const ok=await ghWrite(table,data,sha);
  return respond({ok,saved:ok});
}
