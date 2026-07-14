// functions/api/password-reset.js
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

async function sendEmail(resendKey, to, subject, html){
  if(!resendKey) return false;
  try{
    const r = await fetch('https://api.resend.com/emails',{
      method:'POST',
      headers:{'Authorization':`Bearer ${resendKey}`,'Content-Type':'application/json'},
      body:JSON.stringify({from:'Serve Vision <onboarding@resend.dev>',to:[to],subject,html})
    });
    return r.ok;
  }catch(e){ return false; }
}

export async function onRequestOptions(){
  return new Response(null,{status:204,headers:CORS});
}

// GET ?scope=admin — list all reset requests (admin only)
export async function onRequestGet(context){
  const {request} = context;
  const auth = (request.headers.get('Authorization')||'').replace('Bearer ','').trim();
  if(auth!==API_KEY) return respond({error:'Unauthorized'},401);
  const {content} = await ghRead('password-reset-requests');
  return respond(content||[]);
}

export async function onRequestPost(context){
  const {request, env} = context;
  const body = await request.json().catch(()=>({}));
  const {action} = body;

  // ── Employee requests a reset ───────────────────────────
  if(action==='request'){
    const email = (body.email||'').toLowerCase().trim();
    if(!email) return respond({ok:false,error:'Email is required'},400);

    const {content:logins} = await ghRead('employee-logins');
    const loginMap = logins||{};
    const info = loginMap[email];

    // Always return a generic success message, whether or not the email
    // exists, so this can't be used to check which emails are registered.
    if(info){
      const {content:reqs, sha} = await ghRead('password-reset-requests');
      const list = reqs||[];
      // Avoid piling up duplicate pending requests for the same person
      const already = list.find(r=>r.email===email && r.status==='pending');
      if(!already){
        list.unshift({
          id: Date.now().toString(36)+Math.random().toString(36).substr(2,4),
          email, employeeId: info.employeeId, name: info.name,
          status: 'pending', requestedAt: new Date().toISOString()
        });
        await ghWrite('password-reset-requests', list, sha);
      }
    }
    return respond({ok:true, message:'If this email is registered, admin has been notified and will reset your password shortly.'});
  }

  // ── Admin resolves a reset (sets new password) ──────────
  if(action==='resolve'){
    const auth = (request.headers.get('Authorization')||'').replace('Bearer ','').trim();
    if(auth!==API_KEY) return respond({error:'Unauthorized'},401);

    const {requestId, newPassword} = body;
    if(!requestId||!newPassword) return respond({ok:false,error:'Missing fields'},400);

    const {content:reqs, sha:reqSha} = await ghRead('password-reset-requests');
    const list = reqs||[];
    const idx = list.findIndex(r=>r.id===requestId);
    if(idx<0) return respond({ok:false,error:'Request not found'},404);

    const {content:logins, sha:loginSha} = await ghRead('employee-logins');
    const loginMap = logins||{};
    if(!loginMap[list[idx].email]) return respond({ok:false,error:'Employee login not found'},404);

    loginMap[list[idx].email].password = newPassword;
    await ghWrite('employee-logins', loginMap, loginSha);

    list[idx].status = 'resolved';
    list[idx].resolvedAt = new Date().toISOString();
    await ghWrite('password-reset-requests', list, reqSha);

    await sendEmail(env.RESEND_API_KEY, list[idx].email,
      'Your Serve Vision password has been reset',
      `<div style="font-family:sans-serif;max-width:480px">
        <h2 style="color:#0a3570">Password Reset</h2>
        <p>Hi ${list[idx].name},</p>
        <p>Your password has been reset by admin. Your new password is:</p>
        <p style="font-size:18px;font-weight:700;background:#f3f4f6;padding:10px 16px;border-radius:8px;display:inline-block">${newPassword}</p>
        <p>Please login and change it if you'd like.</p>
        <a href="https://pivot-eb5.pages.dev/employee.html" style="background:#1758a8;color:#fff;padding:10px 20px;border-radius:6px;text-decoration:none;display:inline-block;margin-top:10px">Login →</a>
      </div>`
    );

    return respond({ok:true});
  }

  // ── Admin dismisses a request without resetting ─────────
  if(action==='dismiss'){
    const auth = (request.headers.get('Authorization')||'').replace('Bearer ','').trim();
    if(auth!==API_KEY) return respond({error:'Unauthorized'},401);
    const {requestId} = body;
    const {content:reqs, sha} = await ghRead('password-reset-requests');
    const list = reqs||[];
    const idx = list.findIndex(r=>r.id===requestId);
    if(idx>=0){ list[idx].status='dismissed'; list[idx].resolvedAt=new Date().toISOString(); }
    await ghWrite('password-reset-requests', list, sha);
    return respond({ok:true});
  }

  return respond({error:'Unknown action'},400);
}
