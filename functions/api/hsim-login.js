export async function onRequestPost(context) {
  const CORS = {'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'Content-Type,Authorization'};
  const { email, password } = await context.request.json().catch(()=>({}));
  if(email?.toLowerCase().trim()==='admin@hsim.in' && password==='Hsim#2026Secure'){
    return new Response(JSON.stringify({ok:true,token:'hsim_api_2026_key_x9f2',email}),
      {headers:{'Content-Type':'application/json',...CORS}});
  }
  return new Response(JSON.stringify({ok:false,error:'Invalid credentials'}),
    {status:401,headers:{'Content-Type':'application/json',...CORS}});
}
export async function onRequestOptions(){
  return new Response(null,{status:204,headers:{'Access-Control-Allow-Origin':'*','Access-Control-Allow-Methods':'GET,POST,OPTIONS','Access-Control-Allow-Headers':'Content-Type,Authorization'}});
}
