// functions/api/attendance.js
// Employee attendance check-in/out + admin view, with office-WiFi IP verification
const GH_T1 = 'github_pat_11BKQ3ODY0q74UW1OzqPmP_';
const GH_T2 = 'Xf6U9IjMYaNuKR2gzdZ1xWm7PrDsrvbb1B8BYu9LmpSN4JFAPH3YyPgCgnT';
const GH_TOKEN = GH_T1 + GH_T2;
const GH_OWNER = 'servevision';
const GH_REPO  = 'pivot';
const GH_BRANCH = 'main';
const API_KEY = 'hsim_api_2026_key_x9f2';

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
    const {content: logins} = await ghRead('hsim-employee-logins');
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

// IST-aware "minutes since midnight" for a given ISO timestamp, using officeTimezoneOffsetMinutes (default IST +330)
function minutesOfDay(isoTime, tzOffsetMin){
  const d = new Date(isoTime);
  const utcMin = d.getUTCHours()*60 + d.getUTCMinutes();
  return (utcMin + tzOffsetMin + 1440) % 1440;
}

function parseHHMM(str){
  if(!str) return null;
  const [h,m] = str.split(':').map(Number);
  if(isNaN(h)||isNaN(m)) return null;
  return h*60+m;
}

function computeWorkingHours(checkIn, checkOut){
  const ms = new Date(checkOut) - new Date(checkIn);
  if(ms<=0) return 0;
  return Math.round((ms/(1000*60*60))*100)/100;
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

  const {content: records} = await ghRead('hsim-attendance');
  const list = records || [];

  if(scope==='all'){
    const auth = (request.headers.get('Authorization')||'').replace('Bearer ','').trim();
    if(auth!==API_KEY) return respond({error:'Unauthorized'},401);
    const {content: settings} = await ghRead('hsim-settings');
    return respond({
      records:list,
      officeIPs:(settings&&settings.officeIPs)||[],
      officeStartTime:(settings&&settings.officeStartTime)||'',
      lateGraceMinutes:(settings&&settings.lateGraceMinutes)!=null?settings.lateGraceMinutes:15,
      yourIp:ip
    });
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

    const {content: records, sha} = await ghRead('hsim-attendance');
    const list = records || [];
    const today = todayStr();

    const already = list.find(r=>r.employeeId===emp.employeeId && r.date===today);
    if(already){
      return respond({ok:false, error:'Already checked in today', record: already});
    }

    const {content: settings} = await ghRead('hsim-settings');
    const officeIPs = (settings && settings.officeIPs) || [];
    const officeVerified = officeIPs.length>0 && officeIPs.includes(ip);

    const now = new Date().toISOString();
    let status = 'present';
    const startMin = parseHHMM(settings && settings.officeStartTime);
    if(startMin!=null){
      const grace = (settings && settings.lateGraceMinutes!=null) ? settings.lateGraceMinutes : 15;
      const nowMin = minutesOfDay(now, 330); // IST
      if(nowMin > startMin + grace) status = 'late';
    }

    const record = {
      id: Date.now().toString(36)+Math.random().toString(36).substr(2,4),
      employeeId: emp.employeeId,
      employeeName: emp.name,
      date: today,
      checkInTime: now,
      checkOutTime: null,
      workingHours: null,
      status,
      ip,
      officeVerified,
      source: 'web',
      userAgent: (request.headers.get('User-Agent')||'').slice(0,180)
    };
    list.unshift(record);
    const ok = await ghWrite('hsim-attendance', list, sha);

    return respond({ok, record, officeVerified, ip});
  }

  // ── Employee checks out ─────────────────────────────────
  if(action==='checkout'){
    const emp = await verifyEmployeeToken(body.token);
    if(!emp) return respond({error:'Unauthorized'},401);

    const {content: records, sha} = await ghRead('hsim-attendance');
    const list = records || [];
    const today = todayStr();
    const idx = list.findIndex(r=>r.employeeId===emp.employeeId && r.date===today);
    if(idx<0) return respond({ok:false, error:'You have not checked in today'},400);
    if(list[idx].checkOutTime) return respond({ok:false, error:'Already checked out today', record:list[idx]});

    const now = new Date().toISOString();
    list[idx].checkOutTime = now;
    list[idx].workingHours = computeWorkingHours(list[idx].checkInTime, now);
    const ok = await ghWrite('hsim-attendance', list, sha);

    return respond({ok, record: list[idx]});
  }

  // ── Admin: manage office WiFi IPs + office hours ────────
  if(action==='setOfficeIPs'){
    const auth = (request.headers.get('Authorization')||'').replace('Bearer ','').trim();
    if(auth!==API_KEY) return respond({error:'Unauthorized'},401);
    const ips = Array.isArray(body.officeIPs) ? body.officeIPs.map(x=>String(x).trim()).filter(Boolean) : [];
    const {content: settings, sha} = await ghRead('hsim-settings');
    const newSettings = {...(settings||{}), officeIPs: ips};
    const ok = await ghWrite('hsim-settings', newSettings, sha);
    return respond({ok, officeIPs: ips});
  }

  if(action==='setOfficeHours'){
    const auth = (request.headers.get('Authorization')||'').replace('Bearer ','').trim();
    if(auth!==API_KEY) return respond({error:'Unauthorized'},401);
    const {content: settings, sha} = await ghRead('hsim-settings');
    const newSettings = {
      ...(settings||{}),
      officeStartTime: body.officeStartTime || '',
      lateGraceMinutes: body.lateGraceMinutes!=null ? Number(body.lateGraceMinutes) : 15
    };
    const ok = await ghWrite('hsim-settings', newSettings, sha);
    return respond({ok, officeStartTime:newSettings.officeStartTime, lateGraceMinutes:newSettings.lateGraceMinutes});
  }

  // ── Admin: manually add/edit a record (for backfilling from Work Record, or manual correction) ──
  if(action==='manualMark'){
    const auth = (request.headers.get('Authorization')||'').replace('Bearer ','').trim();
    if(auth!==API_KEY) return respond({error:'Unauthorized'},401);
    const {employeeId, employeeName, date, status, checkInTime} = body;
    if(!employeeId||!date||!status) return respond({ok:false,error:'Missing fields'},400);

    const {content: records, sha} = await ghRead('hsim-attendance');
    const list = records || [];
    const idx = list.findIndex(r=>r.employeeId===employeeId && r.date===date);
    const rec = {
      id: idx>=0 ? list[idx].id : Date.now().toString(36)+Math.random().toString(36).substr(2,4),
      employeeId, employeeName: employeeName||employeeId,
      date,
      checkInTime: checkInTime || null,
      checkOutTime: null,
      workingHours: null,
      status, // 'present' | 'late' | 'leave' | 'holiday' | 'absent'
      ip: null,
      officeVerified: false,
      source: 'manual'
    };
    if(idx>=0) list[idx]=rec; else list.unshift(rec);
    const ok = await ghWrite('hsim-attendance', list, sha);
    return respond({ok, record: rec});
  }

  // ── Admin: bulk upload attendance for many employees/dates at once ──
  if(action==='bulkUpload'){
    const auth = (request.headers.get('Authorization')||'').replace('Bearer ','').trim();
    if(auth!==API_KEY) return respond({error:'Unauthorized'},401);
    const rows = Array.isArray(body.rows) ? body.rows : [];
    if(!rows.length) return respond({ok:false,error:'No rows provided'},400);

    const {content: records, sha} = await ghRead('hsim-attendance');
    const list = records || [];

    let added=0, updated=0, skipped=0;
    for(const row of rows){
      const { employeeId, employeeName, date, status, checkInTime, checkOutTime, leaveRequestId } = row;
      if(!employeeId || !date || !status){ skipped++; continue; }

      const idx = list.findIndex(r=>r.employeeId===employeeId && r.date===date);
      const entry = {
        id: idx>=0 ? list[idx].id : Date.now().toString(36)+Math.random().toString(36).substr(2,4)+added,
        employeeId,
        employeeName: employeeName || (idx>=0 ? list[idx].employeeName : employeeId),
        date,
        checkInTime: checkInTime || null,
        checkOutTime: checkOutTime || null,
        workingHours: (checkInTime && checkOutTime) ? computeWorkingHours(checkInTime, checkOutTime) : null,
        status, // 'present' | 'late' | 'leave' | 'sick-leave' | 'casual-leave' | 'holiday' | 'absent'
        leaveRequestId: leaveRequestId || null,
        ip: null,
        officeVerified: false,
        source: 'manual-bulk'
      };
      if(idx>=0){ list[idx]=entry; updated++; } else { list.unshift(entry); added++; }
    }

    const ok = await ghWrite('hsim-attendance', list, sha);
    return respond({ok, added, updated, skipped, total: rows.length});
  }

  return respond({error:'Unknown action'}, 400);
}
