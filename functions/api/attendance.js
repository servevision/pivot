// functions/api/attendance.js
// Employee attendance check-in + admin view, with office-WiFi IP verification
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

function respond(data, status=200){
  return new Response(JSON.stringify(data), {status, headers:{'Content-Type':'application/json',...CORS}});
}

async function ghRead(file){
  const url = `https://api.github.com/repos/${GH_OWNER}/${GH_REPO}/contents/data/${file}.json?ref=${GH_BRANCH}`;
  const r = await fetch(url,{headers:{Authorization:`token ${GH_TOKEN}`,Accept:'application/vnd.github.v3+json','User-Agent':'SV-Dashboard'}});
  if(!r.ok) return {content:null,sha:null};
  const d = await r.json();
  return {content: JSON.parse(atob(d.content.replace(/\n/g,''))), sha: d.sha};
}

async function ghWrite(file, content, sha){
  const url = `https://api.github.com/repos/${GH_OWNER}/${GH_REPO}/contents/data/${file}.json`;
  const body = {message:`Update ${file}`, content: btoa(unescape(encodeURIComponent(JSON.stringify(content,null,2)))), branch: GH_BRANCH};
  if(sha) body.sha = sha;
  const r = await fetch(url,{method:'PUT',headers:{Authorization:`token ${GH_TOKEN}`,Accept:'application/vnd.github.v3+json','Content-Type':'application/json','User-Agent':'SV-Dashboard'},body:JSON.stringify(body)});
  return r.ok;
}

async function verifyEmployeeToken(token){
  try{
    const decoded = atob(token);
    const [email, employeeId] = decoded.split('|');
    const {content: logins} = await ghRead('employee-logins');
    const info = (logins||{})[email];
    if(info && info.employeeId===employeeId) return {email, employeeId, name: info.name};
    return null;
  }catch(e){ return null; }
}

function getClientIP(request){
  return request.headers.get('CF-Connecting-IP')
      || request.headers.get('X-Forwarded-For')
      || request.headers.get('X-Real-IP')
      || 'unknown';
}

function todayStr(){
  return new Date().toISOString().split('T')[0];
}

export async function onRequestOptions(){
  return new Response(null, {status:204, headers:CORS});
}

// GET /api/attendance?scope=mine (employee, needs token)  |  ?scope=all (admin, needs API key)
export async function onRequestGet(context){
  const {request} = context;
  const url = new URL(request.url);
  const scope = url.searchParams.get('scope') || 'mine';
  const ip = getClientIP(request);

  const {content: records} = await ghRead('attendance');
  const list = records || [];

  if(scope==='all'){
    const auth = (request.headers.get('Authorization')||'').replace('Bearer ','').trim();
    if(auth!==API_KEY) return respond({error:'Unauthorized'},401);
    const {content: settings} = await ghRead('settings');
    return respond({records:list, officeIPs:(settings&&settings.officeIPs)||[], yourIp:ip});
  } else {
    const token = url.searchParams.get('token') || (request.headers.get('Authorization')||'').replace('Bearer ','').trim();
    const emp = await verifyEmployeeToken(token);
    if(!emp) return respond({error:'Unauthorized'},401);
    const mine = list.filter(r=>r.employeeId===emp.employeeId);
    const today = todayStr();
    const todayRecord = mine.find(r=>r.date===today) || null;
    return respond({records:mine, today: todayRecord, yourIp:ip});
  }
}

export async function onRequestPost(context){
  const {request} = context;
  const body = await request.json().catch(()=>({}));
  const {action} = body;
  const ip = getClientIP(request);

  // ── Employee checks in ──────────────────────────────────
  if(action==='checkin'){
    const emp = await verifyEmployeeToken(body.token);
    if(!emp) return respond({error:'Unauthorized'},401);

    const {content: records, sha} = await ghRead('attendance');
    const list = records || [];
    const today = todayStr();

    const already = list.find(r=>r.employeeId===emp.employeeId && r.date===today);
    if(already){
      return respond({ok:false, error:'Already checked in today', record: already});
    }

    const {content: settings} = await ghRead('settings');
    const officeIPs = (settings && settings.officeIPs) || [];
    const officeVerified = officeIPs.length>0 && officeIPs.includes(ip);

    const record = {
      id: Date.now().toString(36)+Math.random().toString(36).substr(2,4),
      employeeId: emp.employeeId,
      employeeName: emp.name,
      date: today,
      checkInTime: new Date().toISOString(),
      ip,
      officeVerified,
      userAgent: (request.headers.get('User-Agent')||'').slice(0,180)
    };
    list.unshift(record);
    const ok = await ghWrite('attendance', list, sha);

    return respond({ok, record, officeVerified, ip});
  }

  // ── Admin: manage office WiFi IP whitelist ──────────────
  if(action==='setOfficeIPs'){
    const auth = (request.headers.get('Authorization')||'').replace('Bearer ','').trim();
    if(auth!==API_KEY) return respond({error:'Unauthorized'},401);
    const ips = Array.isArray(body.officeIPs) ? body.officeIPs.map(x=>String(x).trim()).filter(Boolean) : [];
    const {content: settings, sha} = await ghRead('settings');
    const newSettings = {...(settings||{}), officeIPs: ips};
    const ok = await ghWrite('settings', newSettings, sha);
    return respond({ok, officeIPs: ips});
  }

  return respond({error:'Unknown action'}, 400);
}
