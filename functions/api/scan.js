const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type,Authorization',
};
const API_KEY = 'sv_api_2026_karnal_pivot';

function respond(data, status=200){
  return new Response(JSON.stringify(data), {
    status, headers: {'Content-Type':'application/json', ...CORS}
  });
}

export async function onRequestOptions(){
  return new Response(null, {status:204, headers:CORS});
}

export async function onRequestPost(context){
  const {request, env} = context;

  // Auth check
  const auth = (request.headers.get('Authorization')||'').replace('Bearer ','').trim();
  if(auth !== API_KEY) return respond({error:'Unauthorized'}, 401);

  try {
    const body = await request.json();
    const {mediaType, b64Data} = body;

    if(!b64Data) return respond({error:'No file data'}, 400);

    const isImage = mediaType && mediaType.startsWith('image/');

    // Call Claude API from Cloudflare (no CORS issue)
    const claudeResp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 500,
        messages: [{
          role: 'user',
          content: [
            isImage ? {
              type: 'image',
              source: {type:'base64', media_type:mediaType, data:b64Data}
            } : {
              type: 'document',
              source: {type:'base64', media_type:'application/pdf', data:b64Data}
            },
            {
              type: 'text',
              text: `Analyze this invoice/receipt. Return ONLY a JSON object (no markdown):
{
  "name": "short expense description",
  "usd": 0.00,
  "inr": 0.00,
  "date": "YYYY-MM-DD",
  "category": "one of: Software / SaaS, Server / Hosting, Domain, Marketing, Tools, Travel, Office, Other",
  "notes": "invoice number or key detail"
}
Rules: If amount in INR only, set usd=inr/84. If USD only, set inr=usd*84. If date not found use today. Return valid JSON only.`
            }
          ]
        }]
      })
    });

    if(!claudeResp.ok){
      const err = await claudeResp.text();
      console.error('Claude API error:', err);
      return respond({error: 'Claude API failed: ' + claudeResp.status}, 500);
    }

    const claudeData = await claudeResp.json();
    const text = claudeData.content?.[0]?.text || '{}';

    let parsed = {};
    try {
      const clean = text.replace(/```json|```/g,'').trim();
      parsed = JSON.parse(clean);
    } catch(e) {
      return respond({error: 'Parse failed', raw: text}, 500);
    }

    return respond({ok: true, data: parsed});

  } catch(e) {
    return respond({error: e.message}, 500);
  }
}
