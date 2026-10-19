// Optional native PostgreSQL test helper; never used in production.
const {Pool}=require('../backend/node_modules/pg');
const {readFileSync}=require('node:fs');const path=require('node:path');const {Store}=require('../backend/store');
async function openStore(){
 if(process.env.BRIDGE_NATIVE_TEST!=='1')throw Error('Native QA must be explicitly enabled');
 const config={host:'127.0.0.1',port:Number(process.env.BRIDGE_TEST_PGPORT||55439),database:'bridge_qa',user:'postgres',max:4};
 const admin=new Pool(config);
 try{await admin.query(readFileSync(path.join(__dirname,'../database/001-schema.sql'),'utf8'));}finally{await admin.end();}
 const pool=new Pool({...config,user:'bridge_app'});const store=new Store(pool);store.close=()=>pool.end();return store;
}
module.exports={openStore};
