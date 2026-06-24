const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type,Authorization',
};

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: CORS });
}

export async function onRequestGet() {
  return new Response(JSON.stringify({ ok: true, time: new Date().toISOString() }), {
    headers: { 'Content-Type': 'application/json', ...CORS }
  });
}
