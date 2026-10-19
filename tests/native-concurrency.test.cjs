const {test}=require('node:test');const assert=require('node:assert/strict');
const {openStore}=require('./native-test-store.cjs');
test('native PostgreSQL serializable transactions prevent lost updates across connections',{skip:process.env.BRIDGE_NATIVE_TEST!=='1'},async t=>{
 const s=await openStore();t.after(()=>s.close());
 const key='native-counter';await s.set('meta',key,{count:0,created_at:Date.now()});let attempts=0,arrivals=0,unlock;
 const barrier=new Promise(resolve=>{unlock=resolve;});
 await Promise.all(Array.from({length:4},()=>s.transaction(async tx=>{
  const iteration=++attempts;const row=await tx.get('meta',key);
  if(iteration<=4){if(++arrivals===4)unlock();await barrier;}
  await tx.set('meta',key,{...row,count:row.count+1});
 })));
 assert.equal((await s.get('meta',key)).count,4);assert(attempts>4,'Expected real serialization conflicts and retries');
 await s.remove('meta',key);
});
