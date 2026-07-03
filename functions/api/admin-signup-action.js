const GH_T1 = 'github_pat_11BKQ3ODY0q74UW1OzqPmP_';
const GH_T2 = 'Xf6U9IjMYaNuKR2gzdZ1xWm7PrDsrvbb1B8BYu9LmpSN4JFAPH3YyPgCgnT';
const GH_TOKEN = GH_T1 + GH_T2;
const GH_OWNER = 'servevision';
const GH_REPO  = 'pivot';
const GH_BRANCH = 'main';
const API_KEY = 'sv_api_2026_karnal_pivot';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST,OPTIONS',
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

function genEmployeeId(list){
  let max=0;
  list.forEach(e=>{const m=(e.employeeId||'').match(/SV-EMP-(\d+)/);if(m)max=Math.max(max,parseInt(m[1]));}); 
  return 'SV-EMP-'+String(max+1).padStart(3,'0');
}

async function sendEmail(resendKey,to,subject,html){
  if(!resendKey)return false;
  try{
    const r=await fetch('https://api.resend.com/emails',{method:'POST',headers:{'Authorization':`Bearer ${resendKey}`,'Content-Type':'application/json'},body:JSON.stringify({from:'Serve Vision <onboarding@resend.dev>',to:[to],subject,html})});
    return r.ok;
  }catch(e){return false;}
}

export async function onRequestOptions(){return new Response(null,{status:204,headers:CORS});}

export async function onRequestPost(context){
  const {request,env}=context;
  const auth=(request.headers.get('Authorization')||'').replace('Bearer ','').trim();
  if(auth!==API_KEY) return respond({error:'Unauthorized'},401);

  const {requestId,decision}=await request.json();
  const {content:requests,sha:reqSha}=await ghRead('signup-requests');
  const reqList=requests||[];
  const idx=reqList.findIndex(r=>r.id===requestId);
  if(idx<0) return respond({error:'Request not found'},404);
  const reqItem=reqList[idx];

  if(decision==='approve'){
    let employeeId, ok;
    // Retry loop: if the employees.json write fails (e.g. someone else wrote
    // to it a moment ago and the SHA is stale), re-read fresh data and try
    // again, instead of silently continuing with a broken employeeId.
    for(let attempt=0; attempt<5; attempt++){
      const {content:employees,sha:empSha}=await ghRead('employees');
      const empList=employees||[];
      employeeId=genEmployeeId(empList);
      empList.push({
        employeeId,name:reqItem.name,email:reqItem.email,
        designation:reqItem.designation||'',department:reqItem.department||'',
        phone:reqItem.phone||'',dateOfJoining:new Date().toISOString().split('T')[0],
        exitDate:'',salary:0,bankAccountNo:'',bankIFSC:'',bankName:'',
        documents:{},status:'active',createdAt:new Date().toISOString()
      });
      ok = await ghWrite('employees',empList,empSha);
      if(ok) break;
      await new Promise(res=>setTimeout(res, 300 + Math.random()*400)); // brief random backoff before retry
    }
    if(!ok) return respond({error:'Could not create employee record — please try approving again'},500);

    const {content:logins,sha:loginSha}=await ghRead('employee-logins');
    const loginMap=logins||{};
    loginMap[reqItem.email]={password:reqItem.password,employeeId,name:reqItem.name};
    await ghWrite('employee-logins',loginMap,loginSha);

    reqList[idx].status='approved';
    reqList[idx].decidedAt=new Date().toISOString();
    await ghWrite('signup-requests',reqList,reqSha);

    await sendEmail(env.RESEND_API_KEY,reqItem.email,
      'Your Serve Vision account has been approved ✓',
      `<div style="font-family:sans-serif;max-width:480px">
        <h2 style="color:#0a5239">Welcome to Serve Vision! 🎉</h2>
        <p>Hi ${reqItem.name},</p>
        <p>Your account has been <b>approved</b>.</p>
        <p><b>Employee ID:</b> ${employeeId}</p>
        <p>You can now login to the employee portal.</p>
        <a href="https://pivot-eb5.pages.dev/employee.html" style="background:#1758a8;color:#fff;padding:10px 20px;border-radius:6px;text-decoration:none;display:inline-block;margin-top:10px">Login to Portal →</a>
      </div>`
    );
    return respond({ok:true,employeeId});
  }

  if(decision==='reject'){
    reqList[idx].status='rejected';
    reqList[idx].decidedAt=new Date().toISOString();
    await ghWrite('signup-requests',reqList,reqSha);
    await sendEmail(env.RESEND_API_KEY,reqItem.email,
      'Serve Vision account request update',
      `<div style="font-family:sans-serif;max-width:480px">
        <h2 style="color:#791f1f">Account request declined</h2>
        <p>Hi ${reqItem.name}, your request was not approved. Please contact admin.</p>
      </div>`
    );
    return respond({ok:true});
  }

  return respond({error:'Invalid decision'},400);
}
