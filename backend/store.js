const {RETENTION_MS,firstReplySQL,pruneLettersSQL,pruneVotesSQL}=require('./retention');
const {pruneOrphanChunks}=require('./attachments');
'use strict';
const TABLES=['meta','accounts','sessions','audit','feedback','challenges','notices','polls','votes','tickets','limits','activity'];
const temporary=['sessions','challenges','tickets','limits','activity','meta'];
function tableOK(table){if(!TABLES.includes(table))throw Error('Unknown record type');}
function filter(table,where={}){
 tableOK(table);const values=[table],clauses=['entity=$1'];
 for(const [key,value] of Object.entries(where)){
  if(key==='active_at'&&Number.isFinite(value)){values.push(value-RETENTION_MS);clauses.push(`((${firstReplySQL}) IS NULL OR (${firstReplySQL})>$${values.length})`);continue;}
  if(key==='published_before'&&Number.isFinite(value)){values.push(value);clauses.push(`COALESCE((payload->>'publish_at')::bigint,0)<=$${values.length}`);continue;}
  if(key==='ends_after'&&Number.isFinite(value)){values.push(value);clauses.push(`(payload->>'ends_at')::bigint>$${values.length}`);continue;}
  if(key==='closed_at'&&Number.isFinite(value)){values.push(value);clauses.push(`(state='closed' OR (payload->>'ends_at')::bigint<=$${values.length})`);continue;}
  if(!['state','status','category'].includes(key)||typeof value!=='string')throw Error('Unsupported filter');
  values.push(value);clauses.push(`${key==='category'?"payload->>'category'":key}=$${values.length}`);
 }
 return {values,sql:clauses.join(' AND ')};
}
class Store{
 constructor(db,root=db,inTransaction=false){this.db=db;this.root=root;this.inTransaction=inTransaction;}
 async get(table,id){tableOK(table);return (await this.db.query('SELECT payload FROM bridge_private.records WHERE entity=$1 AND id=$2',[table,id])).rows[0]?.payload??null;}
 async set(table,id,value){
  tableOK(table);
  await this.db.query(`INSERT INTO bridge_private.records(entity,id,payload,created_at,expires_at,state,status)
   VALUES($1,$2,$3::jsonb,$4,$5,$6,$7) ON CONFLICT(entity,id) DO UPDATE SET
   payload=excluded.payload,created_at=excluded.created_at,expires_at=excluded.expires_at,state=excluded.state,status=excluded.status`,
   [table,id,JSON.stringify(value),value.created_at??0,value.expiresAt??null,value.state??null,value.status??null]);
 }
 async remove(table,id){tableOK(table);await this.db.query('DELETE FROM bridge_private.records WHERE entity=$1 AND id=$2',[table,id]);}
 async list(table,where={},limit=100,skip=0,sort='created'){
  if(!Number.isInteger(limit)||limit<1||limit>1000||!Number.isInteger(skip)||skip<0)throw Error('Invalid page');
  const f=filter(table,where),n=f.values.length;
  const order=sort==='oldest'?'created_at ASC':sort==='most'?"COALESCE((payload->>'student_count')::int,1) DESC,created_at DESC":sort==='latest'?"COALESCE((payload->>'updated_at')::bigint,created_at) DESC":'created_at DESC';
  // Lists contain attachment metadata only. Downloading a file reads its parent record separately.
  const projection=table==='feedback'?`(payload-'messages') || jsonb_build_object('first_reply_at',(${firstReplySQL}),'reply_count',CASE WHEN payload ? 'messages' THEN (SELECT count(*) FROM jsonb_array_elements(payload->'messages') m WHERE m->>'role'='staff') ELSE CASE WHEN COALESCE(payload->>'reply','')='' THEN 0 ELSE 1 END END)`:table==='notices'?"jsonb_set(payload,'{attachments}',COALESCE((SELECT jsonb_agg(f-'data') FROM jsonb_array_elements(payload->'attachments') f),'[]'::jsonb))":table==='polls'?"jsonb_set(payload,'{options}',(SELECT jsonb_agg((o-'image') || CASE WHEN o ? 'image' THEN jsonb_build_object('image',(o->'image')-'data') ELSE '{}'::jsonb END) FROM jsonb_array_elements(payload->'options') o))":'payload';
  return (await this.db.query(`SELECT ${projection} AS payload FROM bridge_private.records WHERE ${f.sql} ORDER BY ${order},id ASC LIMIT $${n+1} OFFSET $${n+2}`,[...f.values,limit,skip])).rows.map(r=>r.payload);
 }
 async count(table,where={}){const f=filter(table,where);return Number((await this.db.query(`SELECT count(*) AS total FROM bridge_private.records WHERE ${f.sql}`,f.values)).rows[0].total);}
 async transaction(fn){
  if(this.inTransaction)throw Error('Nested transactions are not supported');
  for(let attempt=0;attempt<5;attempt++){
   const client=await this.root.connect();let retry=false,broken=false;
   try{
    await client.query('BEGIN ISOLATION LEVEL SERIALIZABLE');
    await client.query("SET LOCAL lock_timeout = '3000ms'");
    await client.query("SET LOCAL statement_timeout = '8000ms'");
    const result=await fn(new Store(client,this.root,true));
    await client.query('COMMIT');return result;
   }catch(error){
    try{await client.query('ROLLBACK');}catch{broken=true;}
    // Retry only known aborted transactions, never an uncertain network commit.
    retry=['40001','40P01','23505'].includes(error.code)&&attempt<4&&!broken;
    if(!retry)throw error;
   }finally{client.release(broken);}
   if(retry)await new Promise(resolve=>setTimeout(resolve,15*(attempt+1)+Math.floor(Math.random()*20)));
  }
 }
 async prune(at,limit=20){
  if(!Number.isInteger(limit)||limit<1||limit>100)throw Error('Invalid cleanup limit');
  await this.db.query(`WITH expired AS (
   SELECT entity,id FROM bridge_private.records WHERE entity=ANY($1::text[]) AND expires_at<$2
   ORDER BY expires_at LIMIT $3 FOR UPDATE SKIP LOCKED
  ) DELETE FROM bridge_private.records r USING expired e
    WHERE r.entity=e.entity AND r.id=e.id AND r.expires_at<$2`,[temporary,new Date(at),limit]);
  await this.db.query(pruneOrphanChunks,[at-86400000,limit]);
  await this.db.query(pruneLettersSQL,[at-RETENTION_MS,limit]);
  await this.db.query(pruneVotesSQL,[limit]);
 }
}
module.exports={Store,TABLES};
