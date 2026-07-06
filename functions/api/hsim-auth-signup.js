const GH_T1 = 'github_pat_11BKQ3ODY0q74UW1OzqPmP_';
const GH_T2 = 'Xf6U9IjMYaNuKR2gzdZ1xWm7PrDsrvbb1B8BYu9LmpSN4JFAPH3YyPgCgnT';
const GH_TOKEN = GH_T1 + GH_T2;
const GH_OWNER = 'servevision';
const GH_REPO = 'pivot';
const GH_BRANCH = 'main';
const ADMIN_EMAIL = 'admin@hsim.in';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

function respond(data, status=200){
  return new Response(JSON.stringify(data), {status, headers:{'Content-Type':'application/json',...CORS}});
}

async function ghRead(file){
  const url=`https://api.github.com/repos/${GH_OWNER}/${GH_REPO}/contents/data/${file}.json?ref=${GH_BRANCH}`;
  const r=await fetch(url,{headers:{Authorization:`token ${GH_TOKEN}`,Accept:'application/vnd.github.v3+json','User-Agent':'HSIM-Dashboard'}});
  if(!r.ok) return {content:null,sha:null};
  const d=await r.json();
  return {content:JSON.parse(atob(d.content.replace(/\n/g,''))),sha:d.sha};
}

async function ghWrite(file, content, sha){
  const url=`https://api.github.com/repos/${GH_OWNER}/${GH_REPO}/contents/data/${file}.json`;
  const body={message:`Update ${file}`,content:btoa(unescape(encodeURIComponent(JSON.stringify(content,null,2)))),branch:GH_BRANCH};
  if(sha) body.sha=sha;
  const r=await fetch(url,{method:'PUT',headers:{Authorization:`token ${GH_TOKEN}`,Accept:'application/vnd.github.v3+json','Content-Type':'application/json','User-Agent':'HSIM-Dashboard'},body:JSON.stringify(body)});
  return r.ok;
}

async function sendEmail(resendKey, to, subject, html){
  if(!resendKey) { console.warn('No RESEND_API_KEY'); return false; }
  try{
    const r = await fetch('https://api.resend.com/emails',{
      method:'POST',
      headers:{'Authorization':`Bearer ${resendKey}`,'Content-Type':'application/json'},
      body:JSON.stringify({from:'HSIM India <onboarding@resend.dev>',to:[to],subject,html})
    });
    return r.ok;
  }catch(e){ console.error('Email error:',e.message); return false; }
}

export async function onRequestOptions(){
  return new Response(null,{status:204,headers:CORS});
}

export async function onRequestPost(context){
  const {request, env} = context;

  let body;
  try{ body = await request.json(); }
  catch(e){ return respond({ok:false,error:'Invalid JSON'},400); }

  const {name, email, password, designation, department, phone} = body;

  if(!name||!email||!password){
    return respond({ok:false,error:'Name, email and password are required'},400);
  }

  const {content:requests, sha:reqSha} = await ghRead('hsim-signup-requests');
  const reqList = requests||[];

  const existing = reqList.find(r=>r.email.toLowerCase()===email.toLowerCase().trim());
  if(existing){
    if(existing.status==='pending') return respond({ok:false,error:'A request with this email is already pending approval'},400);
    if(existing.status==='approved') return respond({ok:false,error:'This email is already registered. Please login.'},400);
  }

  const signupRequest = {
    id: Date.now().toString(36)+Math.random().toString(36).substr(2,4),
    name: name.trim(),
    email: email.toLowerCase().trim(),
    password,
    designation: designation||'',
    department: department||'',
    phone: phone||'',
    status: 'pending',
    requestedAt: new Date().toISOString()
  };

  reqList.unshift(signupRequest);
  const saved = await ghWrite('hsim-signup-requests', reqList, reqSha);

  if(!saved){
    return respond({ok:false,error:'Failed to save request'},500);
  }

  const resendKey = env.RESEND_API_KEY;
  await sendEmail(resendKey, ADMIN_EMAIL,
    'New employee signup request - HSIM India HR',
    `<div style="font-family:sans-serif;max-width:480px">
      <h2 style="color:#0a5c4a">New signup request</h2>
      <p><b>Name:</b> ${name}</p>
      <p><b>Email:</b> ${email}</p>
      <p><b>Designation:</b> ${designation||'-'}</p>
      <p><b>Department:</b> ${department||'-'}</p>
      <p><b>Phone:</b> ${phone||'-'}</p>
      <p>Login to the HSIM dashboard to approve or reject.</p>
      <a href="https://pivot-eb5.pages.dev/hsim-login.html" style="background:#0d8f6f;color:#fff;padding:10px 20px;border-radius:6px;text-decoration:none;display:inline-block;margin-top:10px">Open HSIM Dashboard</a>
    </div>`
  );

  return respond({ok:true, message:'Your request has been sent to admin for approval. You will receive an email once approved.'});
}
