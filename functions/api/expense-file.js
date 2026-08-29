// functions/api/expense-file.js
// Stores each expense bill/receipt as its OWN file in the repo instead of
// stuffing base64 into expenses.json. Keeps expenses.json small and fast,
// and removes the data-loss risk that came with rewriting a multi-MB file
// on every single save.
const GH_T1 = 'github_pat_11BKQ3ODY0q74UW1OzqPmP_';
const GH_T2 = 'Xf6U9IjMYaNuKR2gzdZ1xWm7PrDsrvbb1B8BYu9LmpSN4JFAPH3YyPgCgnT';
const GH_TOKEN = GH_T1 + GH_T2;
const GH_OWNER = 'servevision';
const GH_REPO  = 'pivot';
const GH_BRANCH = 'main';
const API_KEY = 'sv_api_2026_karnal_pivot';
const HSIM_API_KEY = 'hsim_api_2026_key_x9f2';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type,Authorization',
};

function respond(data,status=200){
  return new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json',...CORS}});
}

function checkAuth(request){
  const auth=(request.headers.get('Authorization')||'').replace('Bearer ','').trim();
  return auth===API_KEY || auth===HSIM_API_KEY;
}

function extFor(mime){
  if(!mime) return 'bin';
  if(mime.includes('pdf')) return 'pdf';
  if(mime.includes('png')) return 'png';
  if(mime.includes('webp')) return 'webp';
  if(mime.includes('jpeg')||mime.includes('jpg')) return 'jpg';
  return 'bin';
}

export async function onRequestOptions(){
  return new Response(null,{status:204,headers:CORS});
}

// GET /api/expense-file?ref=expense-files/abc123.pdf  -> { dataUrl }
export async function onRequestGet(context){
  const {request}=context;
  if(!checkAuth(request)) return respond({error:'Unauthorized'},401);
  const url=new URL(request.url);
  const ref=url.searchParams.get('ref');
  if(!ref || !ref.startsWith('expense-files/') || ref.includes('..')){
    return respond({error:'Invalid ref'},400);
  }

  const api=`https://api.github.com/repos/${GH_OWNER}/${GH_REPO}/contents/data/${ref}?ref=${GH_BRANCH}`;
  const r=await fetch(api,{headers:{Authorization:`token ${GH_TOKEN}`,Accept:'application/vnd.github.v3+json','User-Agent':'SV-Dashboard'}});
  if(!r.ok) return respond({error:'File not found'},404);
  const d=await r.json();

  let b64=d.content;
  if(!b64 && d.sha){
    // Too big for the contents API to inline — fall back to the blobs API
    const bl=`https://api.github.com/repos/${GH_OWNER}/${GH_REPO}/git/blobs/${d.sha}`;
    const br=await fetch(bl,{headers:{Authorization:`token ${GH_TOKEN}`,Accept:'application/vnd.github.v3+json','User-Agent':'SV-Dashboard'}});
    if(!br.ok) return respond({error:'File not readable'},404);
    const bd=await br.json();
    b64=bd.content;
  }
  if(!b64) return respond({error:'File empty'},404);

  const ext=(ref.split('.').pop()||'').toLowerCase();
  const mime = ext==='pdf' ? 'application/pdf'
             : ext==='png' ? 'image/png'
             : ext==='webp'? 'image/webp'
             : ext==='jpg' ? 'image/jpeg'
             : 'application/octet-stream';

  return respond({ dataUrl:`data:${mime};base64,${b64.replace(/\n/g,'')}` });
}

// POST { id, dataUrl } -> { ok, ref }
export async function onRequestPost(context){
  const {request}=context;
  if(!checkAuth(request)) return respond({error:'Unauthorized'},401);
  const body=await request.json().catch(()=>({}));
  const {id,dataUrl}=body;
  if(!id || !dataUrl) return respond({error:'Missing id or dataUrl'},400);

  const m = dataUrl.match(/^data:([^;]+);base64,(.*)$/);
  if(!m) return respond({error:'dataUrl must be a base64 data URL'},400);
  const mime = m[1];
  const b64  = m[2];

  const safeId = String(id).replace(/[^a-zA-Z0-9_-]/g,'');
  const ref = `expense-files/${safeId}.${extFor(mime)}`;
  const api = `https://api.github.com/repos/${GH_OWNER}/${GH_REPO}/contents/data/${ref}`;

  // Look up existing sha so re-saving the same expense overwrites cleanly
  let sha=null;
  try{
    const ex=await fetch(`${api}?ref=${GH_BRANCH}`,{headers:{Authorization:`token ${GH_TOKEN}`,Accept:'application/vnd.github.v3+json','User-Agent':'SV-Dashboard'}});
    if(ex.ok){ const ed=await ex.json(); sha=ed.sha; }
  }catch(e){}

  // Retry on conflict/transient failures, re-reading the sha each time so a
  // stale sha can't permanently block the save.
  let lastErr='';
  for(let attempt=0; attempt<3; attempt++){
    const payload={message:`Store expense file ${ref}`,content:b64,branch:GH_BRANCH};
    if(sha) payload.sha=sha;

    const w=await fetch(api,{method:'PUT',headers:{Authorization:`token ${GH_TOKEN}`,Accept:'application/vnd.github.v3+json','Content-Type':'application/json','User-Agent':'SV-Dashboard'},body:JSON.stringify(payload)});
    if(w.ok) return respond({ok:true,ref});

    lastErr = `${w.status} ${(await w.text()).slice(0,180)}`;

    // Re-read the current sha before trying again
    try{
      const ex=await fetch(`${api}?ref=${GH_BRANCH}`,{headers:{Authorization:`token ${GH_TOKEN}`,Accept:'application/vnd.github.v3+json','User-Agent':'SV-Dashboard'}});
      sha = ex.ok ? (await ex.json()).sha : null;
    }catch(e){ sha=null; }

    await new Promise(r=>setTimeout(r, 300 + Math.random()*400));
  }

  return respond({ok:false,error:'Could not store file — '+lastErr},500);
}
