const {test}=require('node:test');
const assert=require('node:assert/strict');
const {createApp,hash}=require('../backend/core');
const {openStore}=require('./http-test-store.cjs');
test('staff submissions require owner approval and keep public snapshots isolated',async t=>{
 const store=await openStore();t.after(()=>store.close());let now=Date.parse('2026-10-20T01:00:00Z');
 const origin='https://campus.test',jars={owner:{},staff:{},other:{},student:{}};
 await store.set('meta','owner',{id:'owner'});
 for(const [i,role] of ['owner','staff','other'].entries()){
  const a={id:role,username:role==='owner'?'bridge.admin':role,display_name:role,role:role==='owner'?'owner':'staff',active:1,must_change:0,auth_version:0};
  await store.set('accounts',role,a);const token=String(i+1).repeat(64);jars[role]['__Host-bridge_session']=token;await store.set('sessions',hash(token),{account_id:role,auth_version:0,expires_at:now+1e10});
 }
 const app=createApp({store,config:{PUBLIC_ORIGIN:origin},now:()=>now});
 async function call(route,method='GET',data,role='student',expected=200){const [name,q='']=route.split('?'),jar=jars[role];const r=await app({httpMethod:method,headers:{origin,'content-type':'application/json',cookie:Object.entries(jar).map(([k,v])=>k+'='+v).join('; ')},queryStringParameters:{route:name,...Object.fromEntries(new URLSearchParams(q))},...(data?{body:JSON.stringify(data)}:{})});if(r.headers['Set-Cookie']){const [k,v]=r.headers['Set-Cookie'].split(';')[0].split('=');jar[k]=v;}const out=r.isBase64Encoded?Buffer.from(r.body,'base64'):JSON.parse(r.body);assert.equal(r.statusCode,expected,JSON.stringify(out));return out;}
 const notice={title:'通知标题',content:'待审核的校园活动正文',state:'published'};
 const poll={title:'投票标题',description:'活动介绍',options:['A','B'],ends_at:now+86400000};
 const detail=async id=>(await call('reviews?id='+id,'GET',null,'staff')).review;
 const decide=async(id,action='approve',role='owner',expected=200)=>{const r=await detail(id);return call('reviews','PATCH',{id,version:r.version,action,reason:'需要修改'},role,expected);};
 let n;
 await t.test('staff create hidden, shared staff inspect, owner approves',async()=>{n=await call('notices','POST',notice,'staff',201);assert.equal(n.review_state,'pending');assert.equal((await call('notices')).notices.length,0);await call('notices?id='+n.id,'GET',null,'student',404);await call('reviews','GET',null,'student',403);await decide(n.review_id,'approve','staff',403);await decide(n.review_id);assert.equal((await call('notices')).notices[0].title,notice.title);await decide(n.review_id,'approve','owner',409);});
 await t.test('editing keeps old content, duplicate pending blocked; shared withdraw and resubmit',async()=>{const row=(await call('notices')).notices[0];const r=await call('notices','PATCH',{...notice,id:row.id,version:row.version,content:'新的内容'},'staff');assert.equal((await call('notices')).notices[0].content,notice.content);await call('notices','PATCH',{...notice,id:row.id,version:row.version},'other',409);await decide(r.review_id,'withdraw','other');const draft=await detail(r.review_id);const again=await call('notices','PATCH',{...notice,id:row.id,version:row.version,content:'重新提交',review_id:draft.id,review_version:draft.version},'other');await decide(again.review_id);assert.equal((await call('notices')).notices[0].content,'重新提交');});
 await t.test('delete waits for approval, reject requires reason and preserves published content',async()=>{let row=(await call('notices')).notices[0];const r=await call('notices','PATCH',{id:row.id,version:row.version,action:'delete'},'staff');assert.equal((await call('notices')).notices.length,1);const pending=await detail(r.review_id);await call('reviews','PATCH',{id:pending.id,version:pending.version,action:'reject',reason:''},'owner',400);await decide(r.review_id,'reject');assert.equal((await call('notices')).notices.length,1);const d=await call('notices','PATCH',{id:row.id,version:row.version,action:'delete'},'staff');await decide(d.review_id);assert.equal((await call('notices')).notices.length,0);});
 await t.test('poll drafts private and deadline is revalidated on approval',async()=>{const d=await call('polls','POST',{...poll,state:'draft'},'staff',201);assert.equal(d.review_state,'draft');assert.equal((await call('polls')).polls.length,0);await call('polls?id='+d.id,'GET',null,'student',404);const r=await call('polls','POST',{...poll,review_id:d.review_id,review_version:(await detail(d.review_id)).version},'other',201);now+=86400000;await decide(r.review_id,'approve','owner',409);now-=86400000;await decide(r.review_id);assert.equal((await call('polls')).polls.length,1);});
 await t.test('new vote while edit pending cannot be overwritten',async()=>{const p=(await call('polls')).polls[0];const r=await call('polls','PATCH',{...poll,id:p.id,version:p.version,action:'edit',title:'修改标题'},'staff');const ticket=(await call('ballot','POST',{id:p.id})).ticket;await call('polls','PUT',{id:p.id,ticket,choices:[p.options[0].id]});await decide(r.review_id,'approve','owner',409);assert.equal((await store.get('polls',p.id)).total,1);await decide(r.review_id,'withdraw');});
 await t.test('close and settings are reviewed and preserve ballots',async()=>{let p=(await call('polls')).polls[0];const settings=await call('polls','PATCH',{id:p.id,version:p.version,action:'settings',show_counts:false,show_percent:false},'staff');await decide(settings.review_id);p=(await call('polls')).polls[0];const r=await call('polls','PATCH',{id:p.id,version:p.version,action:'close'},'staff');assert.equal((await call('polls')).polls[0].state,'open');await decide(r.review_id);assert.equal((await call('polls')).polls[0].state,'closed');assert.equal((await store.get('polls',p.id)).total,1);});
 await t.test('owner protected system release data',async()=>{await call('system-updates','GET',null,'staff',403);const x=await call('system-updates','GET',null,'owner');assert.equal(x.release,'1.5.0');assert(x.releases.length>0);});
 await t.test('shared draft attachments survive owner removal and republishing',async()=>{
  const id='shared-image';await store.set('meta','attachment:'+id,{id,kind:'attachment-upload',owner:'owner',name:'image.png',type:'image/png',size:12,chunks:1,next:1,created_at:now,expiresAt:new Date(now+86400000).toISOString()});
  await store.set('meta','attachment:'+id+':0',{kind:'attachment-chunk',upload_id:id,data:'test',created_at:now});
  const made=await call('notices','POST',{...notice,attachments:[{id}]},'owner',201);let live=(await call('notices?id='+made.id)).notices[0];
  const draft=await call('notices','PATCH',{...live,state:'draft'},'staff');await call('notices','PATCH',{...live,attachments:[]},'owner');
  assert.equal((await store.get('meta','attachment:'+id)).expiresAt,null);
  now+=2*86400000;await store.prune(now,100);assert(await store.get('meta','attachment:'+id));
  const r=await detail(draft.review_id);live=(await call('notices?id='+made.id)).notices[0];
  await call('notices','PATCH',{...r.candidate,state:'published',version:live.version,review_id:r.id,review_version:r.version},'staff');await decide(r.id);
  now+=2*86400000;await store.prune(now,100);assert(await store.get('meta','attachment:'+id));assert.equal((await call('notices?id='+made.id)).notices[0].attachments[0].id,id);
 });
 await t.test('eight-file replacement draft respects per-version limits, not union of versions',async()=>{
  const image={name:'pixel.png',data:'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/lZkAAAAASUVORK5CYII='};
  const m=await call('notices','POST',{...notice,attachments:Array.from({length:8},()=>({...image}))},'owner',201);const live=(await call('notices?id='+m.id)).notices[0];
  const d=await call('notices','PATCH',{...live,state:'draft',attachments:[...live.attachments.slice(1),image]},'staff');const r=await detail(d.review_id);
  await call('notices','PATCH',{...r.candidate,state:'published',version:live.version,review_id:r.id,review_version:r.version},'staff');await decide(r.id);assert.equal((await call('notices?id='+m.id)).notices[0].attachments.length,8);
 });
 await t.test('owner direct changes require explicit invalidation and new scheduled notice waits',async()=>{
  const m=await call('notices','POST',notice,'owner',201);const live=(await call('notices?id='+m.id)).notices[0];const d=await call('notices','PATCH',{...live,content:'修改送审'},'staff');
  await call('notices','PATCH',{...live,content:'管理员直接修改'},'owner',409);await call('notices','PATCH',{...live,content:'管理员直接修改',invalidate_review:true},'owner');assert.equal((await detail(d.review_id)).invalidated,true);await decide(d.review_id,'approve','owner',409);
  const scheduled=await call('notices','POST',{...notice,publish_at:now+60000},'staff',201);await decide(scheduled.review_id);await call('notices?id='+scheduled.id,'GET',null,'student',404);now+=60000;await call('notices?id='+scheduled.id);
 });

 await t.test('pending attachments cannot leak through public parent or review URLs',async()=>{
  const data={...notice,attachments:[{name:'pixel.png',data:'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/lZkAAAAASUVORK5CYII='}]};
  const m=await call('notices','POST',data,'staff',201),r=await detail(m.review_id),f=r.candidate.attachments[0];
  await call(`attachment?kind=notice&id=${m.id}&file=${f.id}`,'GET',null,'student',404);
  await call(`attachment?kind=review&id=${r.id}&file=${f.id}`,'GET',null,'student',403);
  assert(Buffer.isBuffer(await call(`attachment?kind=review&id=${r.id}&file=${f.id}`,'GET',null,'other')));
  const results=await Promise.allSettled([decide(r.id),decide(r.id)]);assert.equal(results.filter(x=>x.status==='fulfilled').length,1);assert.equal((await detail(r.id)).state,'approved');
 });
 await t.test('poll list uses a single vote batch and inbox uses a single grouped count',async()=>{
  for(let i=0;i<20;i++)await store.set('polls','batch-'+i,{id:'batch-'+i,title:'批量投票',description:'',options:[{id:'a',label:'A',votes:0},{id:'b',label:'B',votes:0}],ends_at:now+86400000,created_at:now+i,state:'open',total:0,version:0});
  store.requests.length=0;await call('polls');assert.equal(store.requests.filter(r=>r.parameters[0]==='votes').length,1);assert.equal(store.requests.length,2);
  store.requests.length=0;await call('staff','GET',null,'staff');assert.equal(store.requests.filter(r=>r.sql.includes('GROUP BY status')).length,1);
 });

});
