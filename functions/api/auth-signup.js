// functions/api/auth-signup.js
// Public endpoint: employee signs up, creates a pending request
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};
const GH_BRANCH = 'main';
const ADMIN_EMAIL = 'Payments@servevision.io';

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

async function sendEmail(env, to, subject, html){
  if(!env.RESEND_API_KEY) { console.warn('No RESEND_API_KEY set'); return false; }
  try{
    const r = await fetch('https://api.resend.com/emails',{
      method:'POST',
      headers:{
        'Authorization': `Bearer ${env.RESEND_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        from: 'Serve Vision <onboarding@resend.dev>',
        to: [to],
        subject,
        html
      })
    });
    if(!r.ok){
      const err = await r.text();
      console.error('Resend error:', err);
      return false;
    }
    return true;
  }catch(e){
    console.error('Email send error:', e.message);
    return false;
  }
}

export async function onRequestOptions(){
  return new Response(null,{status:204,headers:CORS});
}

export async function onRequestPost(context){
  const {request,env}=context;
  const body = await request.json().catch(()=>({}));
  const {name, email, password, designation, department, phone} = body;

  if(!name||!email||!password){
    return respond({ok:false,error:'Name, email and password are required'},400);
  }

  // Check if email already has a pending or approved request
  const {content:requests, sha:reqSha} = await ghRead(env,'signup-requests');
  const reqList = requests||[];

  const existing = reqList.find(r=>r.email.toLowerCase()===email.toLowerCase());
  if(existing){
    if(existing.status==='pending') return respond({ok:false,error:'A request with this email is already pending approval'},400);
    if(existing.status==='approved') return respond({ok:false,error:'This email is already registered. Please login.'},400);
  }

  const signupRequest = {
    id: Date.now().toString(36)+Math.random().toString(36).substr(2,4),
    name, email: email.toLowerCase().trim(), password, designation: designation||'', department: department||'', phone: phone||'',
    status: 'pending',
    requestedAt: new Date().toISOString()
  };

  reqList.unshift(signupRequest);
  const ok = await ghWrite(env,'signup-requests',reqList,reqSha);

  // Notify admin
  await sendEmail(env, ADMIN_EMAIL,
    'New employee signup request - Serve Vision HR',
    `<div style="font-family:sans-serif;max-width:480px">
      <h2 style="color:#0a3570">New signup request</h2>
      <p><b>Name:</b> ${name}</p>
      <p><b>Email:</b> ${email}</p>
      <p><b>Designation:</b> ${designation||'-'}</p>
      <p><b>Department:</b> ${department||'-'}</p>
      <p><b>Phone:</b> ${phone||'-'}</p>
      <p>Login to the HR dashboard to approve or reject this request.</p>
    </div>`
  );

  return respond({ok, message:'Your request has been sent to admin for approval. You will receive an email once approved.'});
}
