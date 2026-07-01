// functions/api/employee-login.js
// Employee login - separate from admin login
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};
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

export async function onRequestOptions(){
  return new Response(null,{status:204,headers:CORS});
}

export async function onRequestPost(context){
  const {request,env}=context;
  const {email,password} = await request.json().catch(()=>({}));
  if(!email||!password) return respond({ok:false,error:'Email and password required'},400);

  const {content:logins} = await ghRead(env,'employee-logins');
  const loginMap = logins||{};
  const info = loginMap[email.toLowerCase().trim()];

  if(!info || info.password!==password){
    return respond({ok:false,error:'Invalid email or password'},401);
  }

  // Simple token: base64(email|employeeId)
  const token = btoa(`${email.toLowerCase().trim()}|${info.employeeId}`);

  return respond({ok:true, token, email, employeeId: info.employeeId, name: info.name});
}
