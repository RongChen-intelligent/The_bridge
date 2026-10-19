const {test}=require('node:test'),assert=require('node:assert/strict');
const {createApp,hash}=require('../backend/core');const {openStore}=require('./http-test-store.cjs');
const {CHUNK,MAX_FILE}=require('../backend/attachments');
test('binary attachments survive gateway-sized requests, publication, editing and cleanup',async t=>{
 const store=await openStore();t.after(()=>store.close());let now=Date.now();const origin='https://campus.test',session='b'.repeat(64);
 await store.set('accounts','staff',{id:'staff',username:'staff',role:'staff',active:1,must_change:0,auth_version:0});
 await store.set('sessions',hash(session),{account_id:'staff',auth_version:0,expires_at:now+10*86400000});
 const app=createApp({store,now:()=>now,config:{PUBLIC_ORIGIN:origin}});
 async function call(route,method='GET',data,staff=true){const [name,query='']=route.split('?'),binary=Buffer.isBuffer(data);const r=await app({httpMethod:method,headers:{origin,'content-type':binary?'application/octet-stream':'application/json',...(staff?{cookie:'__Host-bridge_session='+session}:{})},queryStringParameters:{route:name,...Object.fromEntries(new URLSearchParams(query))},body:binary?data.toString('base64'):data===undefined?undefined:JSON.stringify(data),isBase64Encoded:binary});return {status:r.statusCode,data:r.isBase64Encoded?Buffer.from(r.body,'base64'):JSON.parse(r.body)};}
 async function ok(...args){const r=await call(...args);assert(r.status<300,JSON.stringify(r.data));return r.data;}
 const bytes=Buffer.alloc(2*1024*1024+41,7);Buffer.from('89504e470d0a1a0a','hex').copy(bytes);let upload,notice;
 await t.test('unauthorized init, oversize file and invalid MIME fail',async()=>{
  assert.equal((await call('upload','POST',{name:'x.png',type:'image/png',size:100},false)).status,403);
  assert.equal((await call('upload','POST',{name:'x.png',type:'image/png',size:MAX_FILE+1})).status,400);
  assert.equal((await call('upload','POST',{name:'x.html',type:'text/html',size:100})).status,400);
  const boundary=await ok('upload','POST',{name:'max.pdf',type:'application/pdf',size:MAX_FILE});assert.equal(boundary.chunks,20);
 });
 await t.test('multi-megabyte binary upload enforces ordering, signatures and idempotent retries',async()=>{
  upload=await ok('upload','POST',{name:'大图片.png',type:'image/png',size:bytes.length});assert.equal(upload.chunk_size,CHUNK);
  assert.equal((await call(`upload?id=${upload.id}&part=1`,'PUT',bytes.subarray(CHUNK,2*CHUNK))).status,400);
  const wrong=Buffer.alloc(CHUNK,1);assert.equal((await call(`upload?id=${upload.id}&part=0`,'PUT',wrong)).status,400);
  for(let part=0;part<upload.chunks;part++){const data=bytes.subarray(part*CHUNK,(part+1)*CHUNK);const d=await ok(`upload?id=${upload.id}&part=${part}`,'PUT',data);assert.equal(d.ready,part===upload.chunks-1);if(part===0)await ok(`upload?id=${upload.id}&part=${part}`,'PUT',data);}
  assert.equal((await call(`upload?id=${upload.id}&part=1`,'PUT',Buffer.alloc(CHUNK,8))).status,409);
 });
 await t.test('draft references completed upload; public cannot download until scheduled publication',async()=>{
  const d=await ok('notices','POST',{title:'大图排版测试',content:'**正文**',state:'published',format:'markdown',align:'center',text_size:'xlarge',publish_at:now+1000,attachments:[{id:upload.id}]});
  notice=(await ok('notices?manage=1&id='+d.id)).notices[0];assert.equal(notice.align,'center');assert.equal(notice.text_size,'xlarge');assert.equal(notice.attachments[0].size,bytes.length);assert.equal(notice.attachments[0].chunked,true);assert(!notice.attachments[0].data);
  assert.equal((await call(`attachment?kind=notice&id=${d.id}&file=${upload.id}&part=0`,'GET',undefined,false)).status,403);
  now+=1000;const chunks=[];for(let part=0;part<upload.chunks;part++)chunks.push(await ok(`attachment?kind=notice&id=${d.id}&file=${upload.id}&part=${part}`));assert.deepEqual(Buffer.concat(chunks),bytes);
 });
 await t.test('bound upload cannot be overwritten or reused on another notice',async()=>{
  assert.equal((await call(`upload?id=${upload.id}&part=0`,'PUT',bytes.subarray(0,CHUNK))).status,409);
  assert.equal((await call('notices','POST',{title:'不能盗用附件',content:'正文',state:'draft',attachments:[{id:upload.id}]})).status,409);
  await ok('notices','PATCH',{...notice,align:'right',text_size:'small'});notice=(await ok('notices?manage=1&id='+notice.id)).notices[0];assert.equal(notice.align,'right');assert.equal(notice.text_size,'small');assert.equal(notice.attachments[0].id,upload.id);
 });
 await t.test('incomplete upload cannot be published',async()=>{const partial=await ok('upload','POST',{name:'partial.png',type:'image/png',size:bytes.length});await ok(`upload?id=${partial.id}&part=0`,'PUT',bytes.subarray(0,CHUNK));assert.equal((await call('notices','POST',{title:'不完整上传',content:'正文',state:'draft',attachments:[{id:partial.id}]})).status,400);});
 await t.test('attachment limits apply to combined referenced sizes and duplicates atomically',async()=>{
  const refs=[];for(let i=0;i<5;i++){const x=await ok('upload','POST',{name:'limit.pdf',type:'application/pdf',size:MAX_FILE});const m=await store.get('meta','attachment:'+x.id);await store.set('meta','attachment:'+x.id,{...m,next:m.chunks});refs.push({id:x.id});}
  const input={title:'总量边界',content:'正文',state:'draft'};assert.equal((await call('notices','POST',{...input,attachments:refs})).status,400);
  assert.equal((await call('notices','POST',{...input,attachments:[refs[0],refs[0]]})).status,400);
  assert.equal((await call('notices','POST',{...input,attachments:Array(9).fill(refs[0])})).status,400);
 });
 await t.test('published attachment survives pruning; deleting parent blocks access and later removes chunks',async()=>{
  now+=2*86400000;await store.prune(now,100);assert(await store.get('meta','attachment:'+upload.id+':0'));
  await ok('notices','PATCH',{id:notice.id,version:notice.version,action:'delete'});
  assert.equal((await call(`attachment?kind=notice&id=${notice.id}&file=${upload.id}&part=0`,'GET',undefined,false)).status,404);
  now+=2*86400000;await store.prune(now,100);assert.equal(await store.get('meta','attachment:'+upload.id+':0'),null);
 });
});
