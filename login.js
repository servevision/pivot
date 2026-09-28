// functions/api/login.js
// Admin login. More than one admin can sign in — they share the same API key
// but each gets their own identity back, so the dashboard can stamp
// "Approved by <name>" on every leave / WFH / signup decision.
const API_KEY = 'sv_api_2026_karnal_pivot';

const ADMINS = [
  { email:'payments@servevision.io', password:'Karnal#989630', name:'Payments Admin', role:'owner'    },
  { email:'mohit@servevision.io',    password:'Mohit@7777',    name:'Mohit',          role:'approver' }
];

export async function onRequestPost(context) {
  const CORS = {'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'Content-Type,Authorization'};
  const { email, password } = await context.request.json().catch(()=>({}));
  const key = (email||'').toLowerCase().trim();
  const admin = ADMINS.find(a=>a.email===key && a.password===password);
  if(admin){
    return new Response(JSON.stringify({
      ok:true,
      token:API_KEY,
      email:admin.email,
      name:admin.name,
      role:admin.role
    }),{headers:{'Content-Type':'application/json',...CORS}});
  }
  return new Response(JSON.stringify({ok:false,error:'Invalid credentials'}),
    {status:401,headers:{'Content-Type':'application/json',...CORS}});
}
export async function onRequestOptions(){
  return new Response(null,{status:204,headers:{'Access-Control-Allow-Origin':'*','Access-Control-Allow-Methods':'GET,POST,OPTIONS','Access-Control-Allow-Headers':'Content-Type,Authorization'}});
}
