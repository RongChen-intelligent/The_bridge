const {test}=require('node:test');
const assert=require('node:assert/strict');
const {Store}=require('../backend/store');
const {openStore}=require('./http-test-store.cjs');

test('batch reads preserve full records and use one bound query regardless of duplicates or missing IDs',async t=>{
 const s=await openStore();t.after(()=>s.close());
 await s.set('votes','vote-a',{id:'vote-a',choices:['one','two']});
 await s.set('votes',"quote'",{id:"quote'",choices:[]});
 await s.set('meta','vote-a',{other:true});
 const before=s.requests.length;
 const rows=await s.getMany('votes',['vote-a','missing','vote-a',"quote'"]);
 assert(rows instanceof Map);assert.equal(rows.size,2);
 assert.deepEqual(rows.get('vote-a'),{id:'vote-a',choices:['one','two']});
 assert.deepEqual(rows.get("quote'"),{id:"quote'",choices:[]});
 assert.equal(rows.has('missing'),false);assert.equal(s.requests.length-before,1);
 assert.equal((await s.getMany('votes',[])).size,0);assert.equal(s.requests.length-before,1);
 await assert.rejects(()=>s.getMany('votes',['']),/Invalid/);
 await assert.rejects(()=>s.getMany('votes',[42]),/Invalid/);
 await assert.rejects(()=>s.getMany('invalid',[]));
});

test('grouped feedback counts retain category and retention rules while overriding selected status',async t=>{
 const s=await openStore();t.after(()=>s.close());const at=40*86400000;
 const rows=[
  ['pending',{status:'pending',category:'校园生活'}],
  ['processing',{status:'processing',category:'校园生活'}],
  ['legacy-active',{status:'processing',category:'校园生活',reply:'yes',updated_at:at-1}],
  ['legacy-expired',{status:'completed',category:'校园生活',reply:'yes',updated_at:10*86400000}],
  ['history-expired',{status:'pending',category:'校园生活',messages:[{role:'staff',created_at:10*86400000}]}],
  ['elsewhere',{status:'completed',category:'其他建议'}]
 ];
 for(const [id,payload] of rows)await s.set('feedback',id,payload);
 const before=s.requests.length;
 assert.deepEqual(await s.countFeedbackStatuses({category:'校园生活',active_at:at,status:'pending'}),[
  {status:'pending',count:1},{status:'processing',count:2},{status:'completed',count:0}
 ]);
 assert.equal(s.requests.length-before,1);
 await s.set('meta','review',{kind:'ballot-review',status:'pending'});
 await s.set('meta','upload',{kind:'attachment-upload',status:'pending'});
 assert.equal(await s.count('meta',{kind:'ballot-review'}),1);
 assert.deepEqual(await s.list('meta',{kind:'ballot-review'}),[{kind:'ballot-review',status:'pending'}]);
});

for(const mode of ['http','direct'])test(mode+' cleanup returns actual counts and bounds all four categories to 100',async t=>{
 const s=await openStore();t.after(()=>s.close());const store=mode==='http'?s:new Store(s.testDb);const at=40*86400000;
 await s.testDb.query(`INSERT INTO bridge_private.records(entity,id,payload,created_at,expires_at)
 SELECT 'sessions','expired-'||i,'{}'::jsonb,1,to_timestamp(1) FROM generate_series(1,101) i
 UNION ALL SELECT 'meta','chunk-'||i,jsonb_build_object('kind','attachment-chunk','upload_id','missing-'||i),1,NULL FROM generate_series(1,101) i
 UNION ALL SELECT 'feedback','letter-'||i,jsonb_build_object('first_reply_at',1),1,NULL FROM generate_series(1,101) i
 UNION ALL SELECT 'votes','vote-'||i,jsonb_build_object('poll_id','missing-'||i),1,NULL FROM generate_series(1,101) i`);
 const before=s.requests.length;
 assert.deepEqual(await store.prune(at),{temporary:100,attachments:100,letters:100,votes:100});
 if(mode==='http')assert.equal(s.requests.length-before,4);
 for(const table of ['sessions','meta','feedback','votes'])assert.equal(await s.count(table),1);
 assert.deepEqual(await store.prune(at),{temporary:1,attachments:1,letters:1,votes:1});
 assert.deepEqual(await store.prune(at),{temporary:0,attachments:0,letters:0,votes:0});
 await assert.rejects(()=>store.prune(at,101));
 await assert.rejects(()=>store.prune(NaN));
});

test('cold and warm HTTP requests do no housekeeping writes; only named timer cleans and reports failures',async t=>{
 const s=await openStore();t.after(()=>s.close());
 const origin=process.env.PUBLIC_ORIGIN;process.env.PUBLIC_ORIGIN='https://campus.test';
 t.after(()=>{if(origin===undefined)delete process.env.PUBLIC_ORIGIN;else process.env.PUBLIC_ORIGIN=origin;});
 const client=require('../backend/http-client');t.mock.method(client,'SqlHttpClient',function(){return s.db;});
 const logs=[],errors=[];t.mock.method(console,'log',(...args)=>logs.push(args));t.mock.method(console,'error',(...args)=>errors.push(args));
 delete require.cache[require.resolve('../backend/index')];const {main}=require('../backend/index');
 t.after(()=>delete require.cache[require.resolve('../backend/index')]);
 await s.set('sessions','expired',{expiresAt:new Date(1).toISOString()});s.requests.length=0;
 const event={httpMethod:'GET',queryStringParameters:{route:'health'},headers:{}};
 assert.equal((await main(event)).statusCode,200);assert.equal((await main(event)).statusCode,200);
 assert(s.requests.every(r=>/^SELECT\b/i.test(r.sql)&&!r.sql.includes('commit_records')));
 assert(await s.get('sessions','expired'));
 const before=s.requests.length;
 const result=await main({Type:'Timer',TriggerName:'bridge-retention-cleanup'});
 assert.equal(result.ok,true);assert.deepEqual(result.counts,{temporary:1,attachments:0,letters:0,votes:0});
 assert.equal(s.requests.length-before,4);assert.equal(await s.get('sessions','expired'),null);
 assert(logs.some(([name,counts])=>name==='bridge_cleanup_complete'&&counts.temporary===1));
 t.mock.method(s.db,'query',async()=>{throw Object.assign(Error('private-secret'),{code:'HTTP_NETWORK'});});
 assert.equal((await main({Type:'Timer',TriggerName:'bridge-retention-cleanup'})).statusCode,503);
 assert(errors.some(([name,code])=>name==='bridge_cleanup_failed'&&code==='HTTP_NETWORK'));
 assert(!JSON.stringify(errors).includes('private-secret'));
});
