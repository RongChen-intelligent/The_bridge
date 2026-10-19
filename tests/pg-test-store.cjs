// Test-only PostgreSQL WASM runtime. Production uses node-postgres and the cloud database.
const {PGlite}=require('@electric-sql/pglite');
const {readFileSync}=require('node:fs');const path=require('node:path');
const {Store}=require('../backend/store');
const schema=readFileSync(path.join(__dirname,'../database/001-schema.sql'),'utf8');
async function openStore(filename){
 const db=new PGlite(filename);await db.waitReady;await db.exec(schema);
 await db.query('SET ROLE bridge_app');
 // PGlite has a single connection. Serialize checkouts, not the application handlers.
 let queue=Promise.resolve();
 const pool={async connect(){
  const prior=queue;let release;queue=new Promise(resolve=>{release=resolve;});await prior;
  return {query:(...args)=>db.query(...args),release};
 },async query(...args){const c=await this.connect();try{return await c.query(...args);}finally{c.release();}}};
 const store=new Store(pool);store.close=()=>db.close();store.testDb=db;return store;
}
module.exports={openStore,schema};
