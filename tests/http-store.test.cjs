const {test}=require('node:test');const assert=require('node:assert/strict');
const {SqlHttpClient}=require('../backend/http-client');const {HttpStore}=require('../backend/http-store');
const {openStore,migration}=require('./http-test-store.cjs');
test('HTTP SQL contract binds data, validates responses, never exposes secrets or replays ambiguous failures',async()=>{
 let count=0;
 const c=new SqlHttpClient({CLOUDBASE_APIKEY:'test-secret'},async(url,o,body)=>{
  count++;assert.equal(url,'https://idhssses-d7gtdzl4f86a805c9.api.tcloudbasegateway.com/v1/rdb/exec-pgsql');
  assert.equal(o.headers.Authorization,'Bearer test-secret');assert.equal(o.method,'POST');
  assert.deepEqual(JSON.parse(body),{sql:'SELECT $1 AS value',parameters:["'; DROP TABLE x; --"],role:'cloudbase_postgres'});
  return {status:200,text:'[{"value":1}]'};
 });
 assert.deepEqual((await c.query('SELECT $1 AS value',["'; DROP TABLE x; --"])).rows,[{value:1}]);assert.equal(count,1);
 for(const response of [{status:200,text:'{}'},{status:200,text:'not json'},{status:401,text:'{"message":"test-secret"}'},{status:302,text:'[]'},{status:500,text:'{"code":"DATABASE_40001"}'}]){
  let calls=0;const db=new SqlHttpClient({CLOUDBASE_APIKEY:'test-secret'},async()=>{calls++;return response;});
  await assert.rejects(()=>new HttpStore(db).transaction(async()=>42),e=>!e.message.includes('test-secret'));assert.equal(calls,1);
 }
 let calls=0;const db=new SqlHttpClient({CLOUDBASE_APIKEY:'test-secret'},async()=>{calls++;throw Error('test-secret');});
 await assert.rejects(()=>new HttpStore(db).transaction(async()=>42),{code:'HTTP_NETWORK'});assert.equal(calls,1);
 assert.throws(()=>new SqlHttpClient({CLOUDBASE_APIKEY:'x',CLOUDBASE_ENV_ID:'evil/path'}));assert.throws(()=>new SqlHttpClient({}));
 await assert.rejects(()=>c.query('SELECT $1',[[1,2]]),{code:'HTTP_PARAMETER'});
});
test('HTTP transactions preserve atomicity, detect stale/absent reads, support mutation, and protect private SQL',async t=>{
 const s=await openStore();t.after(()=>s.close());
 await s.set('meta','counter',{count:0});
 await Promise.all(Array.from({length:4},()=>s.transaction(async tx=>{const v=await tx.get('meta','counter');v.count++;await tx.set('meta','counter',v);})));assert.equal((await s.get('meta','counter')).count,4);
 await assert.rejects(()=>s.transaction(async tx=>{await tx.set('meta','rollback',{ok:true});throw Error('cancel');}),/cancel/);assert.equal(await s.get('meta','rollback'),null);
 // A failure after the first DML also rolls that first DML back inside PostgreSQL.
 await assert.rejects(()=>s.transaction(async tx=>{await tx.set('meta','rollback',{ok:true});await tx.set('meta','bad',{created_at:'not-a-number'});}));assert.equal(await s.get('meta','rollback'),null);
 // Deterministically insert a previously absent record between read and commit.
 let attempts=0;await s.transaction(async tx=>{attempts++;const v=await tx.get('meta','race');if(attempts===1)await s.set('meta','race',{count:5});await tx.set('meta','race',{count:(v?.count||0)+1});});
 assert.equal(attempts,2);assert.equal((await s.get('meta','race')).count,6);
 await s.transaction(async tx=>{await tx.set('meta','overlay',{x:1});assert.deepEqual(await tx.get('meta','overlay'),{x:1});await tx.remove('meta','overlay');assert.equal(await tx.get('meta','overlay'),null);});
 await s.set('feedback','injection',{title:"'; DROP TABLE bridge_private.records; --",status:'pending',expiresAt:new Date(1)});
 await s.set('sessions','expired',{expiresAt:new Date(1)});await s.prune(100);assert.equal(await s.get('sessions','expired'),null);assert.equal((await s.list('feedback',{status:'pending'})).length,1);
 await assert.rejects(()=>s.list('feedback',{'status OR true':'x'}));await assert.rejects(()=>s.get('bad','x'));
 assert(s.requests.every(r=>r.role==='cloudbase_postgres'&&!/^BEGIN|^COMMIT|^ROLLBACK/.test(r.sql)));
 await s.testDb.query('RESET ROLE');await s.testDb.exec('CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN; CREATE ROLE cloudbase_read_only_user NOLOGIN;');
 await s.testDb.exec(migration);
 for(const role of ['anon','authenticated','service_role','cloudbase_read_only_user']){
  await s.testDb.query('SET ROLE '+role);
  await assert.rejects(()=>s.testDb.query('SELECT * FROM bridge_private.records'),{code:'42501'});
  await assert.rejects(()=>s.testDb.query("SELECT bridge_private.commit_records('[]','[]')"),{code:'42501'});
  await s.testDb.query('RESET ROLE');
 }
 await s.testDb.query('SET ROLE cloudbase_postgres');assert.equal((await s.get('meta','counter')).count,4);
});
test('retry only proven database aborts, at most five attempts',async()=>{
 for(const code of ['40001','40P01','23505','HTTP_NETWORK']){
  let calls=0;const s=new HttpStore({async query(){calls++;throw Object.assign(Error('failed'),{code});}});
  await assert.rejects(()=>s.transaction(async()=>42),{code});assert.equal(calls,['40001','40P01'].includes(code)?5:1);
 }
});
