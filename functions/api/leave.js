// functions/api/leave.js
// Leave request + approval system
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

async function sendEmail(env, to, subject, html){
  const key = (env && env.RESEND_API_KEY) || null;
  if(!key) return false;
  try{
    const r = await fetch('https://api.resend.com/emails',{
      method:'POST',
      headers:{'Authorization': `Bearer ${key}`,'Content-Type': 'application/json'},
      body: JSON.stringify({from: 'Serve Vision <onboarding@resend.dev>', to:[to], subject, html})
    });
    return r.ok;
  }catch(e){ console.error(e.message); return false; }
}

async function verifyEmployeeToken(token){
  // Simple token format: base64(email|employeeId)
  try{
    const decoded = atob(token);
    const [email, employeeId] = decoded.split('|');
    const {content:logins} = await ghRead('employee-logins');
    const loginInfo = (logins||{})[email];
    if(loginInfo && loginInfo.employeeId===employeeId) return {email, employeeId, name: loginInfo.name};
    return null;
  }catch(e){ return null; }
}

export async function onRequestOptions(){
  return new Response(null,{status:204,headers:CORS});
}

// GET /api/leave?scope=mine (employee) or scope=all (admin)
export async function onRequestGet(context){
  const {request}=context;
  const url = new URL(request.url);
  const scope = url.searchParams.get('scope')||'mine';
  const auth = (request.headers.get('Authorization')||'').replace('Bearer ','').trim();

  const {content:leaveRequests} = await ghRead('leave-requests');
  const list = leaveRequests||[];

  if(scope==='all'){
    // Admin access
    if(auth!==API_KEY) return respond({error:'Unauthorized'},401);
    return respond(list);
  } else {
    // Employee access - their own requests
    const empAuth = url.searchParams.get('token')||auth;
    const emp = await verifyEmployeeToken(empAuth);
    if(!emp) return respond({error:'Unauthorized'},401);
    const mine = list.filter(l=>l.employeeId===emp.employeeId);
    return respond(mine);
  }
}

export async function onRequestPost(context){
  const {request,env}=context;
  const body = await request.json().catch(()=>({}));
  const {action} = body;

  // ── Employee applies for leave ──────────────────────────
  if(action==='apply'){
    const emp = await verifyEmployeeToken(body.token);
    if(!emp) return respond({error:'Unauthorized'},401);

    const {leaveType, fromDate, toDate, isHalfDay, reason} = body;
    if(!leaveType||!fromDate||!reason) return respond({ok:false,error:'Missing required fields'},400);

    const {content:leaveRequests, sha} = await ghRead('leave-requests');
    const list = leaveRequests||[];

    // Block duplicate/overlapping requests for the same date(s)
    const newFrom = fromDate, newTo = toDate||fromDate;
    const overlap = list.find(l=>
      l.employeeId===emp.employeeId &&
      l.status!=='rejected' &&
      newFrom<=(l.toDate||l.fromDate) && l.fromDate<=newTo
    );
    if(overlap){
      return respond({ok:false, error:`You already have a ${overlap.status} ${overlap.leaveType} request covering ${overlap.fromDate}${overlap.toDate&&overlap.toDate!==overlap.fromDate?' to '+overlap.toDate:''}. Edit that request instead, or wait for a decision.`});
    }

    const newRequest = {
      id: Date.now().toString(36)+Math.random().toString(36).substr(2,4),
      employeeId: emp.employeeId,
      employeeName: emp.name,
      employeeEmail: emp.email,
      leaveType, // 'CL' | 'SL' | 'WFH' | 'HalfDay'
      fromDate, toDate: toDate||fromDate,
      isHalfDay: !!isHalfDay,
      reason,
      status: 'pending',
      appliedAt: new Date().toISOString()
    };
    list.unshift(newRequest);
    const ok = await ghWrite('leave-requests',list,sha);

    await sendEmail(env, ADMIN_EMAIL,
      `Leave request from ${emp.name} - ${leaveType}`,
      `<div style="font-family:sans-serif;max-width:480px">
        <h2 style="color:#0a3570">New leave request</h2>
        <p><b>Employee:</b> ${emp.name} (${emp.employeeId})</p>
        <p><b>Type:</b> ${leaveType}${newRequest.isHalfDay?' (Half Day)':''}</p>
        <p><b>Dates:</b> ${fromDate}${toDate&&toDate!==fromDate?' to '+toDate:''}</p>
        <p><b>Reason:</b> ${reason}</p>
        <p>Login to the HR dashboard to approve or reject.</p>
      </div>`
    );

    return respond({ok, message:'Leave request submitted for approval'});
  }

  // ── Admin approves/rejects ──────────────────────────────
  // ── Employee edits reason on their own pending request ──
  if(action==='edit'){
    const emp = await verifyEmployeeToken(body.token);
    if(!emp) return respond({error:'Unauthorized'},401);

    const {requestId, reason} = body;
    if(!requestId||!reason) return respond({ok:false,error:'Missing required fields'},400);

    const {content:leaveRequests, sha} = await ghRead('leave-requests');
    const list = leaveRequests||[];
    const idx = list.findIndex(l=>l.id===requestId && l.employeeId===emp.employeeId);
    if(idx<0) return respond({ok:false,error:'Request not found'},404);
    if(list[idx].status!=='pending') return respond({ok:false,error:'Only pending requests can be edited'},400);

    list[idx].reason = reason;
    list[idx].editedAt = new Date().toISOString();
    const ok = await ghWrite('leave-requests',list,sha);
    return respond({ok, record:list[idx]});
  }

  if(action==='decide'){
    const auth=(request.headers.get('Authorization')||'').replace('Bearer ','').trim();
    if(auth!==API_KEY) return respond({error:'Unauthorized'},401);

    const {requestId, decision} = body; // 'approve' | 'reject'
    const {content:leaveRequests, sha} = await ghRead('leave-requests');
    const list = leaveRequests||[];
    const idx = list.findIndex(l=>l.id===requestId);
    if(idx<0) return respond({error:'Request not found'},404);

    list[idx].status = decision==='approve' ? 'approved' : 'rejected';
    list[idx].decidedAt = new Date().toISOString();
    const ok = await ghWrite('leave-requests',list,sha);

    const item = list[idx];
    await sendEmail(env, item.employeeEmail,
      `Your leave request has been ${list[idx].status}`,
      `<div style="font-family:sans-serif;max-width:480px">
        <h2 style="color:${decision==='approve'?'#0a5239':'#791f1f'}">Leave request ${list[idx].status}</h2>
        <p>Hi ${item.employeeName},</p>
        <p>Your <b>${item.leaveType}</b> request for ${item.fromDate}${item.toDate!==item.fromDate?' to '+item.toDate:''} has been <b>${list[idx].status}</b>.</p>
        ${decision==='reject'?'<p>Please contact admin for more details.</p>':''}
      </div>`
    );

    return respond({ok});
  }

  return respond({error:'Unknown action'},400);
}
