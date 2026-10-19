'use strict';
const {SqlHttpClient}=require('./http-client');
const {HttpStore}=require('./http-store');const {createApp}=require('./core');
let handler,store,lastCleanup=0;
exports.main=async event=>{
 try{
  if(!handler){
   store=new HttpStore(new SqlHttpClient(process.env));
   // Validate the migration and write-role access before reporting a healthy service.
   await store.transaction(async()=>{});
   handler=createApp({store,config:process.env});
  }
  if(!event.httpMethod&&event.Type==='Timer'&&event.TriggerName==='bridge-retention-cleanup'){await store.prune(Date.now(),100);return {ok:true,release:'1.4.0',task:'retention-cleanup'};}
  const response=await handler(event);
  if(response.statusCode<500&&Date.now()-lastCleanup>60000){lastCleanup=Date.now();try{await store.prune(Date.now());}catch(e){console.error('bridge_cleanup_failed',String(e.code||'Error').slice(0,40));}}
  return response;
 }catch(e){
  console.error('bridge_init_failed',String(e.code||'Error').slice(0,40));
  return {statusCode:503,isBase64Encoded:false,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'},body:JSON.stringify({error:'后台数据库尚未连接，请联系维护者。 / Backend database unavailable. Contact the maintainer.'})};
 }
};
