const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type,Authorization',
};
const API_KEY = 'sv_api_2026_karnal_pivot';
const DRIVE_FOLDER_ID = '1s5EyYyHGEbWrI3awv2DePYp4tmBZZJkc';
const SA_EMAIL = 'expense-uploader@servevisionexpenses.iam.gserviceaccount.com';

const _k = [
  '-----BEGIN PRIVATE KEY-----',
  '\nMIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQCydmOs1a1tvTtK',
  '\nZq60cNowHZYjmg8i0ycJdihGaPpqVLy6sLZuqupMjCZZHuydA9cKtrcEvadqmn6D',
  '\n3+1Es4H75wxP1xqmZexYFoD8SU2u7q349HdjEqVdDkpZYStHP30Pr7Xd5/vNV7uH',
  '\nzQq4ogfxHYEpJupubpdbIeVG6zbxAQi4ZBbnKVSHHZNbuwqkR9tlbK5OXjgsRPR1',
  '\nL2cdptSK2LlsNyUSYCf2/1RIAgSN+Be3MpFSE/qXGtH65RWVfIiq4l0Mu5wKrVtC',
  '\nxWwph/1c/jpaKbMasaLC/aOPVeFvX9p7xjY5aW5GFjRoJ/eziNj2GvQEIETmzmu/',
  '\nNFmM7su3AgMBAAECggEAAY/HlNHWrlw403YEbUgistlLkVoMWkXVS7g1xANGZbJ9',
  '\n2jl36svth8TGvfUcP8VIqMGVLSr+3GysOFQZEEjxJxsd00HbnKK75XC+5ys53uap',
  '\ngVdVVrvyGtdJadHG/k+u2DvY3qJFkLz0LT/MdUmiGku5siIuY5rb7ldtfKOxhaA2',
  '\n+liZsQ+Q7p4vqLxoaEp+aZBIpplPc5EuCdzDr+9UVg8dBv8jniXh6fF0jlK4BZiQ',
  '\naXTQj4QJw1zcV4zC4n5BVBGPX6FL6HEVnO9FAb5Tn1qyaUHN5QX3kZn+oO0OAanx',
  '\n5uAN3seBPM0ADmKHg02+LN9oEs0zII4ef3+AIZ/LSQKBgQDioNcasv/PC3sF5jHX',
  '\nGAECb2yxzBxuRLr++92K5XpxCs8rJ6BebgfeoDfgDPzHG7cJ2DYXxlDE8Q4LqSjy',
  '\nn7RW7maFerOmOrGjCBz34j77h/KPbZJVvHFAlLjqerouLajXOqmH4CPwJGe8xjFG',
  '\nac4fbknznWR7meePO1eLS83+7QKBgQDJl3wow35yi2AV2DShT5iAPb5Y9wuRVBnA',
  '\nRb/AWpmWnbLukC+1JovDf4tOdnvflALNNim85X9u3rW8fBDJ2DIlhg7U/e3QTxYQ',
  '\nNOhEyRFx0druOi7q4B81iJ6rPzQLIzJtVJadSmtOPwmYhllYaB/AEye/27C4Rwju',
  '\n2YJuCf48swKBgCqyOLRcAtvEAvJykvM+H3qQ+X5pwPV5V22QkAWKBE5lxfAQcCM6',
  '\nQZtMvhok+D6e1xYwuMgz4aWo8Id74C4NrpEuKvx8yHnJ1wurDKIa6tjCnQ0ujIJA',
  '\nlWmgW1I5uvfWPFgIQkZKERs+EJk9Ea19Y4sCYUZXYcXzke+nM3AX4QBlAoGALjE4',
  '\n8PpCuip3nOnKvX/ImPIM8MPC8c0MjYMt+fyInvuJqaJ+XAr2EZjjKdp6bfOzZKRZ',
  '\nkgAgYB5GFGd1TVrtuq1qLqH04TuN+a613jUYezUz7kyEvasXW6Pvf5ve6AJrpqOw',
  '\nU2BfEDHfmASI6noJdHCvNgY4CzGzuU871M0TZYMCgYEAowSSuX8snQXIsqU08b/k',
  '\nTJwIFsQaJKlAYDmwWvaDe/GUbuHE1Dpl3Ozpxhyb/LrqwKznH6j+xQXa90z/f93r',
  '\nHscQ4wWBK9eQdH+0vbNcxu4INFegE+sweJm2ku57vgXzpvOPmQmrsrEVIt6/UQ6m',
  '\nbiQl3PJWoLkgENOHH7PuzBc=',
  '\n-----END PRIVATE KEY-----\n'
].join('');

function b64url(buf) {
  const bytes = new Uint8Array(buf);
  let str = '';
  for (const b of bytes) str += String.fromCharCode(b);
  return btoa(str).replace(/\+/g,'-').replace(/\//g,'_').replace(/=/g,'');
}

async function getAccessToken() {
  const now = Math.floor(Date.now()/1000);
  const header  = b64url(new TextEncoder().encode(JSON.stringify({alg:'RS256',typ:'JWT'})));
  const payload = b64url(new TextEncoder().encode(JSON.stringify({
    iss: SA_EMAIL,
    scope: 'https://www.googleapis.com/auth/drive',
    aud: 'https://oauth2.googleapis.com/token',
    exp: now+3600, iat: now
  })));
  const msg = `${header}.${payload}`;
  const pemBody = _k.replace(/-----BEGIN PRIVATE KEY-----|-----END PRIVATE KEY-----/g,'').replace(/\n/g,'').trim();
  const binaryDer = Uint8Array.from(atob(pemBody), c=>c.charCodeAt(0));
  const cryptoKey = await crypto.subtle.importKey(
    'pkcs8', binaryDer.buffer,
    {name:'RSASSA-PKCS1-v1_5',hash:'SHA-256'}, false, ['sign']
  );
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', cryptoKey, new TextEncoder().encode(msg));
  const jwt = `${msg}.${b64url(sig)}`;
  const resp = await fetch('https://oauth2.googleapis.com/token',{
    method:'POST',
    headers:{'Content-Type':'application/x-www-form-urlencoded'},
    body:`grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${jwt}`
  });
  const data = await resp.json();
  if(!data.access_token) throw new Error('Token failed: '+JSON.stringify(data));
  return data.access_token;
}

async function uploadToDrive(accessToken, fileName, fileData, mimeType) {
  const b64 = fileData.includes(',') ? fileData.split(',')[1] : fileData;
  const fileBytes = Uint8Array.from(atob(b64), c=>c.charCodeAt(0));
  const metadata = JSON.stringify({
    name: fileName,
    parents: [DRIVE_FOLDER_ID]
  });
  const boundary = 'boundary_sv_' + Date.now();
  const enc = new TextEncoder();
  const metaPart = enc.encode(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n`);
  const filePart = enc.encode(`--${boundary}\r\nContent-Type: ${mimeType}\r\n\r\n`);
  const endPart  = enc.encode(`\r\n--${boundary}--`);
  const total = metaPart.length + filePart.length + fileBytes.length + endPart.length;
  const body = new Uint8Array(total);
  let off = 0;
  [metaPart, filePart, fileBytes, endPart].forEach(p=>{body.set(p,off);off+=p.length;});

  // supportsAllDrives=true allows uploading to folders shared with service account
  const resp = await fetch(
    'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&supportsAllDrives=true&fields=id,name,webViewLink',
    {
      method:'POST',
      headers:{
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': `multipart/related; boundary=${boundary}`,
      },
      body
    }
  );
  if(!resp.ok){
    const err = await resp.text();
    throw new Error(`Drive upload failed (${resp.status}): ${err.substring(0,300)}`);
  }
  return await resp.json();
}

function respond(data,status=200){
  return new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json',...CORS}});
}

export async function onRequestOptions(){
  return new Response(null,{status:204,headers:CORS});
}

export async function onRequestPost(context){
  const {request}=context;
  const auth=(request.headers.get('Authorization')||'').replace('Bearer ','').trim();
  if(auth!==API_KEY) return respond({error:'Unauthorized'},401);
  try{
    const {fileName,fileData,mimeType}=await request.json();
    if(!fileName||!fileData||!mimeType) return respond({error:'Missing fields'},400);
    const token=await getAccessToken();
    const result=await uploadToDrive(token,fileName,fileData,mimeType);
    return respond({ok:true,fileId:result.id,fileName:result.name,viewLink:result.webViewLink});
  }catch(e){
    return respond({error:e.message},500);
  }
}
