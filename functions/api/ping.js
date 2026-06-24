
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type,Authorization',
};

export async function onRequest(context) {
  if (context.request.method === 'OPTIONS')
    return new Response(null, { status: 204, headers: CORS });
  return new Response(JSON.stringify({ ok: true, time: new Date().toISOString() }), {
    headers: { 'Content-Type': 'application/json', ...CORS }
  });
}
