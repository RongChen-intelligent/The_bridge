const {test}=require('node:test');const assert=require('node:assert/strict');
const {openStore}=require('./http-test-store.cjs');
test('native SQL HTTP commits across four connections prevent lost updates and revoke stale authority',{skip:process.env.BRIDGE_NATIVE_HTTP_TEST!=='1'},async t=>{
 const s=await openStore();t.after(()=>s.close());
 await s.set('meta','native-http-counter',{count:0});let attempts=0,arrivals=0,unlock;
 const barrier=new Promise(resolve=>{unlock=resolve;});
 await Promise.all(Array.from({length:4},()=>s.transaction(async tx=>{
  const iteration=++attempts;const row=await tx.get('meta','native-http-counter');
  if(iteration<=4){if(++arrivals===4)unlock();await barrier;}
  row.count++;await tx.set('meta','native-http-counter',row);
 })));
 assert.equal((await s.get('meta','native-http-counter')).count,4);assert(attempts>4);
 await s.set('accounts','stale-worker',{active:1});let executions=0;
 await assert.rejects(()=>s.transaction(async tx=>{
  executions++;const a=await tx.get('accounts','stale-worker');if(!a.active)throw Error('Access revoked');
  if(executions===1)await s.set('accounts','stale-worker',{active:0});
  await tx.set('notices','unauthorized',{title:'Must never commit'});
 }),/Access revoked/);
 assert.equal(executions,2);assert.equal(await s.get('notices','unauthorized'),null);
});
