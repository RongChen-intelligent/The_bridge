const {test}=require('node:test');const assert=require('node:assert/strict');
const {openStore,migration}=require('./http-test-store.cjs');
test('health is read-only without a write migration and timer runs bounded cleanup',async t=>{
 const s=await openStore();t.after(()=>s.close());
 const clientModule=require('../backend/http-client');
 t.mock.method(clientModule,'SqlHttpClient',function(){return s.db;});
 const previous=process.env.PUBLIC_ORIGIN;process.env.PUBLIC_ORIGIN='https://campus.test';
 t.after(()=>{if(previous===undefined)delete process.env.PUBLIC_ORIGIN;else process.env.PUBLIC_ORIGIN=previous;});
 const {main}=require('../backend/index');
 const event={httpMethod:'GET',queryStringParameters:{route:'health'},headers:{}};
 await s.testDb.query('RESET ROLE');await s.testDb.query('DROP FUNCTION bridge_private.commit_records(jsonb,jsonb)');await s.testDb.query('SET ROLE cloudbase_postgres');
 assert.equal((await main(event)).statusCode,200);
 await s.testDb.query('RESET ROLE');await s.testDb.exec(migration);await s.testDb.query('SET ROLE cloudbase_postgres');
 const result=await main(event);assert.equal(result.statusCode,200);assert.equal(JSON.parse(result.body).ok,true);assert.equal(JSON.parse(result.body).ownerConfigured,false);
 assert.equal(JSON.parse(result.body).api_version,5);assert.equal(JSON.parse(result.body).release,'1.5.0');
 assert.equal((await main(event)).statusCode,200);
 await s.set('feedback','timer-expired',{id:'timer-expired',first_reply_at:Date.now()-31*86400000,created_at:1});
 const timer=await main({Type:'Timer',TriggerName:'bridge-retention-cleanup'});assert.equal(timer.ok,true);assert.equal(await s.get('feedback','timer-expired'),null);
});
