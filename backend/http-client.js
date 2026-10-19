'use strict';
const https=require('node:https');
const {randomUUID}=require('node:crypto');
const DEFAULT_ENV='idhssses-d7gtdzl4f86a805c9';
function failure(code){return Object.assign(new Error('CloudBase SQL request failed'),{code});}
// No redirect following, no transport retries, and never expose upstream bodies/errors.
function transport(url,options,body){
 return new Promise((resolve,reject)=>{
  const req=https.request(url,options,res=>{
   const chunks=[];let size=0;
   res.on('data',chunk=>{size+=chunk.length;if(size>8*1024*1024){res.destroy();reject(failure('HTTP_RESPONSE_TOO_LARGE'));}else chunks.push(chunk);});
   res.on('error',()=>reject(failure('HTTP_NETWORK')));
   res.on('end',()=>resolve({status:res.statusCode,text:Buffer.concat(chunks).toString('utf8')}));
  });
  const timer=setTimeout(()=>req.destroy(failure('HTTP_TIMEOUT')),15000);
  req.on('close',()=>clearTimeout(timer));
  req.on('error',e=>reject(failure(e.code==='HTTP_TIMEOUT'?'HTTP_TIMEOUT':'HTTP_NETWORK')));
  req.end(body);
 });
}
class SqlHttpClient{
 constructor(config,send=transport){
  const env=config.CLOUDBASE_ENV_ID||DEFAULT_ENV;
  if(!/^[a-z0-9][a-z0-9-]{2,80}$/.test(env)||!config.CLOUDBASE_APIKEY||/[\r\n]/.test(config.CLOUDBASE_APIKEY))throw failure('HTTP_CONFIG');
  this.url=`https://${env}.api.tcloudbasegateway.com/v1/rdb/exec-pgsql`;
  this.key=config.CLOUDBASE_APIKEY;this.send=send;
 }
 async query(sql,parameters=[]){
  if(parameters.some(p=>p!==null&&!['string','number','boolean'].includes(typeof p)))throw failure('HTTP_PARAMETER');
  const body=JSON.stringify({sql,parameters,role:'cloudbase_postgres'});
  let response;
  try{response=await this.send(this.url,{method:'POST',headers:{Authorization:`Bearer ${this.key}`,'Content-Type':'application/json','Accept':'application/json','Content-Length':Buffer.byteLength(body),'X-Request-Id':randomUUID()}},body);}catch{throw failure('HTTP_NETWORK');}
  let data;try{data=JSON.parse(response.text);}catch{throw failure('HTTP_INVALID_RESPONSE');}
  if(response.status!==200){
   // Only a documented database abort may trigger transaction replay.
   const code=response.status===400&&/^DATABASE_[A-Z0-9]{5}$/.test(data?.code)?data.code.slice(9):`HTTP_${Number(response.status)||500}`;
   throw failure(code);
  }
  if(!Array.isArray(data))throw failure('HTTP_INVALID_RESPONSE');
  return {rows:data};
 }
}
module.exports={SqlHttpClient};
