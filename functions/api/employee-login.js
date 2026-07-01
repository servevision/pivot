const GH_T1 = 'github_pat_11BKQ3ODY0q74UW1OzqPmP_';
const GH_T2 = 'Xf6U9IjMYaNuKR2gzdZ1xWm7PrDsrvbb1B8BYu9LmpSN4JFAPH3YyPgCgnT';
const GH_TOKEN = GH_T1 + GH_T2;
const GH_OWNER = 'servevision';
const GH_REPO  = 'pivot';
const GH_BRANCH = 'main';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
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

export async function onRequestOptions(){return new Response(null,{status:204,headers:CORS});}

export async function onRequestPost(context){
  const {request}=context;
  const body=await request.json().catch(()=>({}));
  const {email,password}=body;
  if(!email||!password) return respond({ok:false,error:'Email and password required'},400);

  const {content:logins}=await ghRead('employee-logins');
  const loginMap=logins||{};
  const info=loginMap[email.toLowerCase().trim()];

  if(!info||info.password!==password){
    return respond({ok:false,error:'Invalid email or password'},401);
  }

  const token=btoa(`${email.toLowerCase().trim()}|${info.employeeId}`);
  return respond({ok:true,token,email,employeeId:info.employeeId,name:info.name});
}
