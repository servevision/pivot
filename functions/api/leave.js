// functions/api/leave.js
// Leave request + approval system
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type,Authorization',
};
const API_KEY = 'sv_api_2026_karnal_pivot';
const ADMIN_EMAIL = 'Payments@servevision.io';
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

async function sendEmail(env, to, subject, html){
  if(!env.RESEND_API_KEY) return false;
  try{
    const r = await fetch('https://api.resend.com/emails',{
      method:'POST',
      headers:{'Authorization': `Bearer ${env.RESEND_API_KEY}`,'Content-Type': 'application/json'},
      body: JSON.stringify({from: 'Serve Vision <onboarding@resend.dev>', to:[to], subject, html})
    });
    return r.ok;
  }catch(e){ console.error(e.message); return false; }
}

async function verifyEmployeeToken(token, env){
  // Simple token format: base64(email:employeeId)
  try{
    const decoded = atob(token);
    const [email, employeeId] = decoded.split('|');
    const {content:logins} = await ghRead(env,'employee-logins');
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
  const {request,env}=context;
  const url = new URL(request.url);
  const scope = url.searchParams.get('scope')||'mine';
  const auth = (request.headers.get('Authorization')||'').replace('Bearer ','').trim();

  const {content:leaveRequests} = await ghRead(env,'leave-requests');
  const list = leaveRequests||[];

  if(scope==='all'){
    // Admin access
    if(auth!==API_KEY) return respond({error:'Unauthorized'},401);
    return respond(list);
  } else {
    // Employee access - their own requests
    const empAuth = url.searchParams.get('token')||auth;
    const emp = await verifyEmployeeToken(empAuth, env);
    if(!emp) return respond({error:'Unauthorized'},401);
    const mine = list.filter(l=>l.employeeId===emp.employeeId);
    return respond(mine);
  }
}

export async function onRequestPost(context){
  const {request,env}=context;
  const body = await request.json();
  const {action} = body;

  // ── Employee applies for leave ──────────────────────────
  if(action==='apply'){
    const emp = await verifyEmployeeToken(body.token, env);
    if(!emp) return respond({error:'Unauthorized'},401);

    const {leaveType, fromDate, toDate, isHalfDay, reason} = body;
    if(!leaveType||!fromDate||!reason) return respond({ok:false,error:'Missing required fields'},400);

    const {content:leaveRequests, sha} = await ghRead(env,'leave-requests');
    const list = leaveRequests||[];

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
    const ok = await ghWrite(env,'leave-requests',list,sha);

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
  if(action==='decide'){
    const auth=(request.headers.get('Authorization')||'').replace('Bearer ','').trim();
    if(auth!==API_KEY) return respond({error:'Unauthorized'},401);

    const {requestId, decision} = body; // 'approve' | 'reject'
    const {content:leaveRequests, sha} = await ghRead(env,'leave-requests');
    const list = leaveRequests||[];
    const idx = list.findIndex(l=>l.id===requestId);
    if(idx<0) return respond({error:'Request not found'},404);

    list[idx].status = decision==='approve' ? 'approved' : 'rejected';
    list[idx].decidedAt = new Date().toISOString();
    const ok = await ghWrite(env,'leave-requests',list,sha);

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
