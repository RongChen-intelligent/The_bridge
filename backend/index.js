'use strict';
const {SqlHttpClient}=require('./http-client');
const {HttpStore}=require('./http-store');const {createApp}=require('./core');
let handler,store;
exports.main=async event=>{
 const cleanup=!event.httpMethod&&event.Type==='Timer'&&event.TriggerName==='bridge-retention-cleanup';
 try{
  if(!handler){
   store=new HttpStore(new SqlHttpClient(process.env));
   handler=createApp({store,config:process.env});
  }
  if(cleanup){const counts=await store.prune(Date.now(),100);console.log('bridge_cleanup_complete',counts);return {ok:true,release:'1.5.0',task:'retention-cleanup',counts};}
  return await handler(event);
 }catch(e){
  console.error(cleanup?'bridge_cleanup_failed':'bridge_init_failed',String(e.code||'Error').slice(0,40));
  return {statusCode:503,isBase64Encoded:false,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'},body:JSON.stringify({error:'后台数据库尚未连接，请联系维护者。 / Backend database unavailable. Contact the maintainer.'})};
 }
};
