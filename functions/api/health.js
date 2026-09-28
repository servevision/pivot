// functions/api/health.js
// Read-only diagnostic: says whether the GitHub token currently works and
// where it came from. It never returns the token, any credential, or any
// employee data — only a yes/no plus GitHub's status code, so it is safe to
// open in a browser when something stops saving.
//
// Open:  https://pivot-eb5.pages.dev/api/health

const GH_OWNER  = 'servevision';
const GH_REPO   = 'pivot';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type,Authorization',
};

export async function onRequestOptions(){
  return new Response(null,{status:204,headers:CORS});
}

export async function onRequestGet(context){
  const env = context.env || {};
  const token = env.GITHUB_TOKEN || '';

  const out = {
    checkedAt: new Date().toISOString(),
    tokenSource: token ? 'cloudflare-env' : 'missing',
    tokenLooksSet: !!token,
    githubStatus: null,
    canRead: false,
    canWrite: false,
    verdict: ''
  };

  if(!token){
    out.verdict = 'GITHUB_TOKEN is not set in Cloudflare. Add it under Settings -> Variables and Secrets, then redeploy.';
    return json(out);
  }

  try{
    // Repo metadata tells us both that the token is valid and whether it is
    // allowed to push — without writing anything.
    const r = await fetch(`https://api.github.com/repos/${GH_OWNER}/${GH_REPO}`,{
      headers:{Authorization:`token ${token}`,Accept:'application/vnd.github.v3+json','User-Agent':'SV-Dashboard'}
    });
    out.githubStatus = r.status;

    if(r.status === 401){
      out.verdict = 'GitHub rejected the token (401). It is expired or revoked — generate a new one and update GITHUB_TOKEN in Cloudflare.';
      return json(out);
    }
    if(r.status === 404){
      out.verdict = 'Token is valid but cannot see this repository (404). Give it access to servevision/pivot.';
      return json(out);
    }
    if(!r.ok){
      out.verdict = `GitHub returned ${r.status}. Try again in a minute.`;
      return json(out);
    }

    const d = await r.json();
    out.canRead  = true;
    // NOTE: repo metadata reports what the ACCOUNT may do, which for a
    // fine-grained token can differ from what the TOKEN itself is allowed to
    // do. Only ?write=1 proves the save path actually works.
    out.accountCanPush = !!(d.permissions && d.permissions.push);

    const url = new URL(context.request.url);
    if(url.searchParams.get('write') === '1'){
      const probe = await writeProbe(token);
      out.writeStatus  = probe.status;
      out.writeMessage = probe.message;
      out.canWrite     = probe.ok;
      out.verdict = probe.ok
        ? 'All good — the dashboard can read and save.'
        : (probe.status === 403
            ? 'Reads work but writes are refused (403). The token\'s "Contents" permission is Read-only — set it to "Read and write".'
            : `Reads work but the write test failed (${probe.status}). ${probe.message||''}`);
    } else {
      out.verdict = out.accountCanPush
        ? 'Token is valid and can read. Add ?write=1 to this URL to test saving.'
        : 'Token is valid but the account has no push access to this repo.';
    }
  }catch(e){
    out.verdict = 'Could not reach GitHub: ' + (e && e.message);
  }

  return json(out);
}

// Writes a tiny throwaway file through exactly the same GitHub call the
// dashboard uses, so a failure here is the same failure the app hits.
// It touches only data/health-check.json — never real data.
async function writeProbe(token){
  const path = 'data/health-check.json';
  const api  = `https://api.github.com/repos/${GH_OWNER}/${GH_REPO}/contents/${path}`;
  const hdr  = {Authorization:`token ${token}`,Accept:'application/vnd.github.v3+json','User-Agent':'SV-Dashboard'};
  try{
    let sha = null;
    const cur = await fetch(`${api}?ref=main`,{headers:hdr});
    if(cur.ok) sha = (await cur.json()).sha;

    const body = {
      message: 'Health check write test',
      content: btoa(JSON.stringify({checkedAt:new Date().toISOString()},null,2)),
      branch: 'main'
    };
    if(sha) body.sha = sha;

    const r = await fetch(api,{method:'PUT',headers:{...hdr,'Content-Type':'application/json'},body:JSON.stringify(body)});
    let message = '';
    if(!r.ok){ try{ message = (await r.json()).message || ''; }catch(e){} }
    return {ok:r.ok, status:r.status, message};
  }catch(e){
    return {ok:false, status:0, message:(e && e.message) || 'request failed'};
  }
}

function json(data){
  return new Response(JSON.stringify(data,null,2),{
    headers:{'Content-Type':'application/json','Cache-Control':'no-store',...CORS}
  });
}
