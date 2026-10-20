'use strict';
const {Store:ReadStore,TABLES}=require('./store');
const copy=v=>JSON.parse(JSON.stringify(v));
function valid(table,id){if(!TABLES.includes(table)||typeof id!=='string'||id.length<1||id.length>160)throw Error('Invalid record key');}
class Transaction{
 constructor(store){this.store=store;this.reads=new Map();this.writes=new Map();}
 async get(table,id){
  valid(table,id);const key=JSON.stringify([table,id]);
  if(this.writes.has(key))return copy(this.writes.get(key).payload);
  if(!this.reads.has(key))this.reads.set(key,{entity:table,id,payload:await this.store.get(table,id)});
  // Business code may mutate returned objects; preserve the original read for validation.
  return copy(this.reads.get(key).payload);
 }
 async set(table,id,value){
  valid(table,id);if(!value||typeof value!=='object'||Array.isArray(value))throw Error('Invalid payload');
  this.writes.set(JSON.stringify([table,id]),{entity:table,id,payload:copy(value)});
 }
 async remove(table,id){valid(table,id);this.writes.set(JSON.stringify([table,id]),{entity:table,id,payload:null});}
 async transaction(){throw Error('Nested transactions are not supported');}
 async list(){throw Error('Transactional range reads are not supported');}
 async count(){throw Error('Transactional range reads are not supported');}
}
class HttpStore extends ReadStore{
 constructor(db){super(db);}
 async get(table,id){valid(table,id);return super.get(table,id);}
 async transaction(fn){
  for(let attempt=0;attempt<5;attempt++){
   const tx=new Transaction(this);
   const result=await fn(tx);
   try{
    const r=await this.db.query('SELECT bridge_private.commit_records($1::jsonb,$2::jsonb) AS committed',[JSON.stringify([...tx.reads.values()]),JSON.stringify([...tx.writes.values()])]);
    if(r.rows.length!==1||r.rows[0].committed!==true)throw Object.assign(Error('Invalid commit response'),{code:'HTTP_INVALID_RESPONSE'});
    return result;
   }catch(error){
    if(!['40001','40P01'].includes(error.code)||attempt===4)throw error;
    await new Promise(resolve=>setTimeout(resolve,15*(attempt+1)+Math.floor(Math.random()*20)));
   }
  }
 }
 async set(table,id,value){return this.transaction(tx=>tx.set(table,id,value));}
 async remove(table,id){return this.transaction(tx=>tx.remove(table,id));}
}
module.exports={HttpStore};
