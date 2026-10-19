const {PGlite}=require('@electric-sql/pglite');
const fs=require('node:fs');const path=require('node:path');
const {SqlHttpClient}=require('../backend/http-client');const {HttpStore}=require('../backend/http-store');
const schema=fs.readFileSync(path.join(__dirname,'../database/001-managed-schema.sql'),'utf8');
const migration=fs.readFileSync(path.join(__dirname,'../database/002-http-transactions.sql'),'utf8');
async function openStore(filename){
 let db;
 if(process.env.BRIDGE_NATIVE_HTTP_TEST==='1'){
  const {Pool}=require('../backend/node_modules/pg');
  const pool=new Pool({host:'127.0.0.1',port:Number(process.env.BRIDGE_TEST_PGPORT||55439),database:'bridge_qa',user:'postgres',max:4});
  db={query:(...a)=>pool.query(...a),exec:sql=>pool.query(sql),close:()=>pool.end()};
 }else{db=new PGlite(filename);await db.waitReady;}
 await db.exec(`DO $$ BEGIN IF NOT EXISTS(SELECT FROM pg_roles WHERE rolname='cloudbase_postgres') THEN CREATE ROLE cloudbase_postgres NOLOGIN NOSUPERUSER NOCREATEROLE; END IF; END $$;`);
 await db.exec(schema);await db.exec(migration);
 if(process.env.BRIDGE_NATIVE_HTTP_TEST==='1'){
  await db.query('ALTER ROLE cloudbase_postgres LOGIN');await db.close();
  const {Pool}=require('../backend/node_modules/pg');
  const pool=new Pool({host:'127.0.0.1',port:Number(process.env.BRIDGE_TEST_PGPORT||55439),database:'bridge_qa',user:'cloudbase_postgres',max:4});
  db={query:(...a)=>pool.query(...a),close:()=>pool.end()};
 }else await db.query('SET ROLE cloudbase_postgres');
 const requests=[];
 const client=new SqlHttpClient({CLOUDBASE_APIKEY:'test-only-placeholder'},async(url,options,body)=>{
  const b=JSON.parse(body);requests.push(b);
  try{const r=await db.query(b.sql,b.parameters);return {status:200,text:JSON.stringify(r.rows)};}
  catch(e){return {status:400,text:JSON.stringify({code:'DATABASE_'+e.code,message:'redacted'})};}
 });
 const store=new HttpStore(client);store.close=()=>db.close();store.testDb=db;store.requests=requests;return store;
}
module.exports={openStore,schema,migration};
