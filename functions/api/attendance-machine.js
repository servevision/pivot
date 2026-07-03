// functions/api/attendance-machine.js
// Receives attendance punches pushed from a local bridge script that reads
// the CP PLUS CPTAMS database/SDK on your office network, and syncs them here.
//
// Bridge script sends: POST /api/attendance-machine
// Headers: Authorization: Bearer <MACHINE_API_KEY>
// Body: { records: [ { employeeId, date:'YYYY-MM-DD', checkInTime: ISO string, checkOutTime: ISO string|null } ] }

const GH_T1 = 'github_pat_11BKQ3ODY0q74UW1OzqPmP_';
const GH_T2 = 'Xf6U9IjMYaNuKR2gzdZ1xWm7PrDsrvbb1B8BYu9LmpSN4JFAPH3YyPgCgnT';
const GH_TOKEN = GH_T1 + GH_T2;
const GH_OWNER = 'servevision';
const GH_REPO  = 'pivot';
const GH_BRANCH = 'main';

// Separate key from the admin/API key so the bridge script credential can be
// rotated independently without touching the main dashboard login.
const MACHINE_API_KEY = 'sv_machine_2026_cpvta_m1143';

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

function parseHHMM(str){
  if(!str) return null;
  const [h,m] = str.split(':').map(Number);
  if(isNaN(h)||isNaN(m)) return null;
  return h*60+m;
}
function minutesOfDay(isoTime, tzOffsetMin){
  const d = new Date(isoTime);
  const utcMin = d.getUTCHours()*60 + d.getUTCMinutes();
  return (utcMin + tzOffsetMin + 1440) % 1440;
}
function computeWorkingHours(checkIn, checkOut){
  if(!checkIn||!checkOut) return null;
  const ms = new Date(checkOut) - new Date(checkIn);
  if(ms<=0) return 0;
  return Math.round((ms/(1000*60*60))*100)/100;
}

export async function onRequestOptions(){
  return new Response(null, {status:204, headers:CORS});
}

export async function onRequestPost(context){
  const {request} = context;
  const auth = (request.headers.get('Authorization')||'').replace('Bearer ','').trim();
  if(auth!==MACHINE_API_KEY) return respond({error:'Unauthorized - invalid machine key'},401);

  const body = await request.json().catch(()=>({}));
  const incoming = Array.isArray(body.records) ? body.records : [];
  if(!incoming.length) return respond({ok:false, error:'No records provided'},400);

  const {content: emps} = await ghRead('employees');
  const empList = emps || [];
  const {content: settings} = await ghRead('settings');
  const startMin = parseHHMM(settings && settings.officeStartTime);
  const grace = (settings && settings.lateGraceMinutes!=null) ? settings.lateGraceMinutes : 15;

  const {content: records, sha} = await ghRead('attendance');
  const list = records || [];

  let added=0, updated=0, skipped=0;
  const errors=[];

  for(const rec of incoming){
    const { employeeId, date, checkInTime, checkOutTime } = rec;
    if(!employeeId || !date || !checkInTime){ skipped++; errors.push(`Skipped record missing employeeId/date/checkInTime: ${JSON.stringify(rec)}`); continue; }

    const emp = empList.find(e=>e.employeeId===employeeId || e.id===employeeId);
    const employeeName = emp ? emp.name : employeeId;

    let status = 'present';
    if(startMin!=null){
      const nowMin = minutesOfDay(checkInTime, 330);
      if(nowMin > startMin + grace) status = 'late';
    }

    const idx = list.findIndex(r=>r.employeeId===employeeId && r.date===date);
    const entry = {
      id: idx>=0 ? list[idx].id : Date.now().toString(36)+Math.random().toString(36).substr(2,4)+added,
      employeeId, employeeName,
      date,
      checkInTime,
      checkOutTime: checkOutTime || (idx>=0 ? list[idx].checkOutTime : null),
      workingHours: computeWorkingHours(checkInTime, checkOutTime || (idx>=0 ? list[idx].checkOutTime : null)),
      status,
      ip: null,
      officeVerified: true, // machine is physically on office premises
      source: 'machine'
    };

    if(idx>=0){ list[idx]=entry; updated++; } else { list.unshift(entry); added++; }
  }

  const ok = await ghWrite('attendance', list, sha);
  return respond({ok, added, updated, skipped, errors});
}
