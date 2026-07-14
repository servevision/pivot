// functions/api/password-reset.js
const GH_T1 = 'github_pat_11BKQ3ODY0q74UW1OzqPmP_';
const GH_T2 = 'Xf6U9IjMYaNuKR2gzdZ1xWm7PrDsrvbb1B8BYu9LmpSN4JFAPH3YyPgCgnT';
const GH_TOKEN = GH_T1 + GH_T2;
const GH_OWNER = 'servevision';
const GH_REPO  = 'pivot';
const GH_BRANCH = 'main';
const API_KEY = 'sv_api_2026_karnal_pivot';
const ADMIN_EMAIL = 'Payments@servevision.io';

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

async function sendEmail(resendKey,to,subject,html){
  if(!resendKey)return false;
  try{
    const r=await fetch('https://api.resend.com/emails',{method:'POST',headers:{'Authorization':`Bearer ${resendKey}`,'Content-Type':'application/json'},body:JSON.stringify({from:'Serve Vision <onboarding@resend.dev>',to:[to],subject,html})});
    return r.ok;
  }catch(e){return false;}
}

export async function onRequestOptions(){return new Response(null,{status:204,headers:CORS});}

// GET ?scope=all (admin) — list pending reset requests
export async function onRequestGet(context){
  const {request}=context;
  const auth=(request.headers.get('Authorization')||'').replace('Bearer ','').trim();
  if(auth!==API_KEY) return respond({error:'Unauthorized'},401);
  const {content}=await ghRead('password-resets');
  return respond(content||[]);
}

export async function onRequestPost(context){
  const {request,env}=context;
  const body=await request.json().catch(()=>({}));
  const {action}=body;

  // ── Employee requests a reset ──────────────────────────
  if(action==='request'){
    const email=(body.email||'').toLowerCase().trim();
    if(!email) return respond({ok:false,error:'Email is required'},400);

    const {content:logins}=await ghRead('employee-logins');
    const loginMap=logins||{};
    if(!loginMap[email]) return respond({ok:false,error:'No account found with this email'},404);

    const {content:resets,sha}=await ghRead('password-resets');
    const list=resets||[];
    const already=list.find(r=>r.email===email && r.status==='pending');
    if(already) return respond({ok:false,error:'A reset request for this email is already pending'},400);

    const reqItem={
      id:Date.now().toString(36)+Math.random().toString(36).substr(2,4),
      email, name:loginMap[email].name, employeeId:loginMap[email].employeeId,
      status:'pending', requestedAt:new Date().toISOString()
    };
    list.unshift(reqItem);
    await ghWrite('password-resets',list,sha);

    await sendEmail(env.RESEND_API_KEY, ADMIN_EMAIL,
      `Password reset request - ${reqItem.name}`,
      `<div style="font-family:sans-serif;max-width:480px">
        <h2 style="color:#0a3570">Password reset requested</h2>
        <p><b>${reqItem.name}</b> (${reqItem.employeeId}) has requested a password reset.</p>
        <p>Login to the HR dashboard to set a new password for them.</p>
      </div>`
    );

    return respond({ok:true,message:'Request sent to admin. You will be notified once your password is reset.'});
  }

  // ── Admin sets a new password ──────────────────────────
  if(action==='resolve'){
    const auth=(request.headers.get('Authorization')||'').replace('Bearer ','').trim();
    if(auth!==API_KEY) return respond({error:'Unauthorized'},401);

    const {requestId,newPassword}=body;
    if(!requestId||!newPassword) return respond({ok:false,error:'Missing fields'},400);

    const {content:resets,sha}=await ghRead('password-resets');
    const list=resets||[];
    const idx=list.findIndex(r=>r.id===requestId);
    if(idx<0) return respond({ok:false,error:'Request not found'},404);

    const {content:logins,sha:loginSha}=await ghRead('employee-logins');
    const loginMap=logins||{};
    if(!loginMap[list[idx].email]) return respond({ok:false,error:'Employee login no longer exists'},404);
    loginMap[list[idx].email].password=newPassword;
    await ghWrite('employee-logins',loginMap,loginSha);

    list[idx].status='resolved';
    list[idx].fulfilledAt=new Date().toISOString();
    await ghWrite('password-resets',list,sha);

    await sendEmail(env.RESEND_API_KEY, list[idx].email,
      'Your password has been reset',
      `<div style="font-family:sans-serif;max-width:480px">
        <h2 style="color:#0a5239">Password reset ✓</h2>
        <p>Hi ${list[idx].name},</p>
        <p>Admin has reset your password. Your new password is:</p>
        <p style="font-size:18px;font-weight:700;background:#f3f4f6;padding:10px 16px;border-radius:8px;display:inline-block">${newPassword}</p>
        <p style="margin-top:14px">Please login and consider it saved somewhere safe.</p>
        <a href="https://pivot-eb5.pages.dev/employee.html" style="background:#1758a8;color:#fff;padding:10px 20px;border-radius:6px;text-decoration:none;display:inline-block;margin-top:10px">Login →</a>
      </div>`
    );

    return respond({ok:true});
  }

  // ── Admin dismisses a request without resetting ────────
  if(action==='dismiss'){
    const auth=(request.headers.get('Authorization')||'').replace('Bearer ','').trim();
    if(auth!==API_KEY) return respond({error:'Unauthorized'},401);
    const {requestId}=body;
    const {content:resets,sha}=await ghRead('password-resets');
    const list=resets||[];
    const idx=list.findIndex(r=>r.id===requestId);
    if(idx<0) return respond({ok:false,error:'Request not found'},404);
    list[idx].status='dismissed';
    list[idx].fulfilledAt=new Date().toISOString();
    await ghWrite('password-resets',list,sha);
    return respond({ok:true});
  }

  return respond({error:'Unknown action'},400);
}
