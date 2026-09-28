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
    out.canWrite = !!(d.permissions && d.permissions.push);
    out.verdict  = out.canWrite
      ? 'All good — the dashboard can read and save.'
      : 'Token works but has no write access. Set its Contents permission to "Read and write".';
  }catch(e){
    out.verdict = 'Could not reach GitHub: ' + (e && e.message);
  }

  return json(out);
}

function json(data){
  return new Response(JSON.stringify(data,null,2),{
    headers:{'Content-Type':'application/json','Cache-Control':'no-store',...CORS}
  });
}
