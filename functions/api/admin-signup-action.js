// functions/api/admin-signup-action.js
// Admin-only: approve/reject a signup request
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST,OPTIONS',
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
  let maxNum = 0;
  existingEmployees.forEach(e=>{
    const m = (e.employeeId||'').match(/SV-EMP-(\d+)/);
    if(m) maxNum = Math.max(maxNum, parseInt(m[1]));
  });
  return 'SV-EMP-' + String(maxNum+1).padStart(3,'0');
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

export async function onRequestOptions(){
  return new Response(null,{status:204,headers:CORS});
}

export async function onRequestPost(context){
  const {request,env}=context;
  const auth=(request.headers.get('Authorization')||'').replace('Bearer ','').trim();
  if(auth!==API_KEY) return respond({error:'Unauthorized'},401);

  const {requestId, decision} = await request.json(); // decision: 'approve' | 'reject'

  const {content:requests, sha:reqSha} = await ghRead(env,'signup-requests');
  const reqList = requests||[];
  const idx = reqList.findIndex(r=>r.id===requestId);
  if(idx<0) return respond({error:'Request not found'},404);

  const reqItem = reqList[idx];

  if(decision==='approve'){
    // Create employee record
    const {content:employees, sha:empSha} = await ghRead(env,'employees');
    const empList = employees||[];
    const employeeId = genEmployeeId(empList);

    const newEmployee = {
      employeeId,
      name: reqItem.name,
      email: reqItem.email,
      designation: reqItem.designation||'',
      department: reqItem.department||'',
      phone: reqItem.phone||'',
      dateOfJoining: new Date().toISOString().split('T')[0],
      exitDate: '',
      salary: 0,
      bankAccountNo: '',
      bankIFSC: '',
      bankName: '',
      documents: [],
      status: 'active',
      createdAt: new Date().toISOString()
    };
    empList.push(newEmployee);
    await ghWrite(env,'employees',empList,empSha);

    // Create login credentials
    const {content:logins, sha:loginSha} = await ghRead(env,'employee-logins');
    const loginMap = logins||{};
    loginMap[reqItem.email] = { password: reqItem.password, employeeId, name: reqItem.name };
    await ghWrite(env,'employee-logins',loginMap,loginSha);

    // Update request status
    reqList[idx].status='approved';
    reqList[idx].decidedAt = new Date().toISOString();
    await ghWrite(env,'signup-requests',reqList,reqSha);

    // Email employee
    await sendEmail(env, reqItem.email,
      'Your Serve Vision account has been approved',
      `<div style="font-family:sans-serif;max-width:480px">
        <h2 style="color:#0a5239">Welcome to Serve Vision!</h2>
        <p>Hi ${reqItem.name},</p>
        <p>Your account request has been <b>approved</b>.</p>
        <p><b>Employee ID:</b> ${employeeId}</p>
        <p>You can now login to the HR dashboard using your email and password.</p>
        <p><a href="https://pivot-eb5.pages.dev" style="background:#1758a8;color:#fff;padding:10px 20px;border-radius:6px;text-decoration:none">Login now</a></p>
      </div>`
    );

    return respond({ok:true, employeeId});
  }

  if(decision==='reject'){
    reqList[idx].status='rejected';
    reqList[idx].decidedAt = new Date().toISOString();
    await ghWrite(env,'signup-requests',reqList,reqSha);

    await sendEmail(env, reqItem.email,
      'Serve Vision account request update',
      `<div style="font-family:sans-serif;max-width:480px">
        <h2 style="color:#791f1f">Account request declined</h2>
        <p>Hi ${reqItem.name},</p>
        <p>Unfortunately your account request was not approved at this time.</p>
        <p>Please contact your administrator for more details.</p>
      </div>`
    );

    return respond({ok:true});
  }

  return respond({error:'Invalid decision'},400);
}
