const {test}=require('node:test');const assert=require('node:assert/strict');
const {Store}=require('../backend/store');const {options}=require('../backend/connection');
const {openStore,schema}=require('./pg-test-store.cjs');
test('PostgreSQL schema, access policy, rollback, expiry and injection boundaries',async t=>{
 const s=await openStore();t.after(()=>s.close());
 await s.set('feedback','keep',{title:"'; DROP TABLE records; --",created_at:1,expiresAt:new Date(1),status:'pending'});
 assert.equal((await s.list('feedback',{status:'pending'}))[0].title,"'; DROP TABLE records; --");
 await assert.rejects(()=>s.list('feedback',{"status OR true":'x'}));
 await assert.rejects(()=>s.get('feedback; DROP TABLE records','x'));
 await s.set('sessions','old',{expiresAt:new Date(1)});await s.set('sessions','renewed',{expiresAt:new Date(200)});
 await s.prune(100);assert.equal(await s.get('sessions','old'),null);assert(await s.get('sessions','renewed'));assert(await s.get('feedback','keep'));
 await assert.rejects(()=>s.transaction(async tx=>{await tx.set('meta','rollback',{created_at:1});throw Error('cancel');}),/cancel/);
 assert.equal(await s.get('meta','rollback'),null);
 // Business role cannot alter schema or disable RLS.
 await assert.rejects(()=>s.testDb.query('ALTER TABLE bridge_private.records DISABLE ROW LEVEL SECURITY'),{code:'42501'});
 await s.testDb.query('RESET ROLE');
 await s.testDb.exec('CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN;');
 // Repeat migration does not erase content, and revokes the browser-facing roles.
 await s.testDb.exec(schema);
 for(const role of ['anon','authenticated','service_role']){
  await s.testDb.query('SET ROLE '+role);
  await assert.rejects(()=>s.testDb.query('SELECT * FROM bridge_private.records'),{code:'42501'});
  await s.testDb.query('RESET ROLE');
 }
 await s.testDb.query('SET ROLE bridge_app');assert(await s.get('feedback','keep'));
});
test('transaction retry uses a new checkout and releases every connection',async()=>{
 const calls=[];let connections=0,work=0;
 const pool={async connect(){const id=++connections;return {async query(sql){calls.push([id,sql]);if(sql==='COMMIT'&&id===1)throw Object.assign(Error('conflict'),{code:'40001'});return {rows:[]};},release(broken){calls.push([id,'release',broken]);}};}};
 assert.equal(await new Store(pool).transaction(async()=>++work),2);
 assert.equal(connections,2);assert(calls.some(x=>x[0]===1&&x[1]==='ROLLBACK'));assert.equal(calls.filter(x=>x[1]==='release').length,2);
});
test('unknown commit outcome is not replayed; retries are bounded',async()=>{
 for(const code of ['ECONNRESET','40001']){
  let count=0;
  const pool={async connect(){count++;return {async query(sql){if(sql==='COMMIT')throw Object.assign(Error('failed'),{code});},release(){}};}};
  await assert.rejects(()=>new Store(pool).transaction(async()=>42),{code});assert.equal(count,code==='40001'?5:1);
 }
});
test('database TLS configuration is strict by default; secrets are required',()=>{
 assert.throws(()=>options({}),/Missing/);
 const env={PGHOST:'db.example',PGUSER:'bridge_app',PGPASSWORD:'test-only',PGDATABASE:'postgres'};
 assert.equal(options(env).ssl.rejectUnauthorized,true);assert.equal(options({...env,PGSSLMODE:'require'}).ssl.rejectUnauthorized,false);
 assert.equal(options({...env,PGSSLMODE:'disable'}).ssl,false);assert.throws(()=>options({...env,PGPORT:'bad'}));
});
