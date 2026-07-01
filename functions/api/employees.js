// functions/api/employees.js
// Admin-only: CRUD for employee master records
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type,Authorization',
};
const API_KEY = 'sv_api_2026_karnal_pivot';
const GH_BRANCH = 'main';

function respond(data,status=200){
  return new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json',...CORS}});
}

async function ghRead(env,file){
  const url=`https://api.github.com/repos/${env.GITHUB_OWNER}/${env.GITHUB_REPO}/contents/data/${file}.json?ref=${GH_BRANCH}`;
  const r=await fetch(url,{headers:{Authorization:`token ${env.GITHUB_TOKEN}`,Accept:'application/vnd.github.v3+json','User-Agent':'SV-Dashboard'}});
  if(!r.ok) return {content:null,sha:null};
  const d=await r.json();
  return {content:JSON.parse(atob(d.content.replace(/\n/g,''))),sha:d.sha};
}

async function ghWrite(env,file,content,sha){
  const url=`https://api.github.com/repos/${env.GITHUB_OWNER}/${env.GITHUB_REPO}/contents/data/${file}.json`;
  const body={message:`Update ${file}`,content:btoa(unescape(encodeURIComponent(JSON.stringify(content,null,2)))),branch:GH_BRANCH};
  if(sha) body.sha=sha;
  const r=await fetch(url,{method:'PUT',headers:{Authorization:`token ${env.GITHUB_TOKEN}`,Accept:'application/vnd.github.v3+json','Content-Type':'application/json','User-Agent':'SV-Dashboard'},body:JSON.stringify(body)});
  return r.ok;
}

function genEmployeeId(existingEmployees){
  // Find highest existing number in SV-EMP-XXX series
  let maxNum = 0;
  existingEmployees.forEach(e=>{
    const m = (e.employeeId||'').match(/SV-EMP-(\d+)/);
    if(m) maxNum = Math.max(maxNum, parseInt(m[1]));
  });
  const next = maxNum + 1;
  return 'SV-EMP-' + String(next).padStart(3,'0');
}

export async function onRequestOptions(){
  return new Response(null,{status:204,headers:CORS});
}

export async function onRequestGet(context){
  const {request,env}=context;
  const auth=(request.headers.get('Authorization')||'').replace('Bearer ','').trim();
  if(auth!==API_KEY) return respond({error:'Unauthorized'},401);
  const {content}=await ghRead(env,'employees');
  return respond(content||[]);
}

export async function onRequestPost(context){
  const {request,env}=context;
  const auth=(request.headers.get('Authorization')||'').replace('Bearer ','').trim();
  if(auth!==API_KEY) return respond({error:'Unauthorized'},401);

  const body=await request.json();
  const {action} = body;

  const {content:employees,sha}=await ghRead(env,'employees');
  let list = employees||[];

  if(action==='create'){
    const emp = body.employee;
    emp.employeeId = genEmployeeId(list);
    emp.createdAt = new Date().toISOString();
    list.push(emp);
    const ok = await ghWrite(env,'employees',list,sha);
    return respond({ok, employeeId: emp.employeeId});
  }

  if(action==='update'){
    const idx = list.findIndex(e=>e.employeeId===body.employeeId);
    if(idx>=0){
      list[idx] = {...list[idx], ...body.employee, updatedAt:new Date().toISOString()};
      const ok = await ghWrite(env,'employees',list,sha);
      return respond({ok});
    }
    return respond({error:'Employee not found'},404);
  }

  if(action==='delete'){
    list = list.filter(e=>e.employeeId!==body.employeeId);
    const ok = await ghWrite(env,'employees',list,sha);
    return respond({ok});
  }

  if(action==='replace_all'){
    const ok = await ghWrite(env,'employees',body.employees,sha);
    return respond({ok});
  }

  return respond({error:'Unknown action'},400);
}
