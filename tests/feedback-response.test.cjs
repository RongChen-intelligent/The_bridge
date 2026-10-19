const {test}=require('node:test'),assert=require('node:assert/strict'),path=require('node:path'),Module=require('node:module');
const {buildSync}=require('esbuild');
const compiled=buildSync({entryPoints:[path.join(__dirname,'../frontend/app/lib/feedback-response.ts')],bundle:true,platform:'node',format:'cjs',write:false}).outputFiles[0].text;
const loaded=new Module(__filename);loaded._compile(compiled,__filename);
const {readFeedbackResponse}=loaded.exports;
const letter={id:'letter-a',title:'测试来信',category:'学习与教学',content:'学生正文',reply:'',status:'pending',version:0,created_at:1000,updated_at:2000};
test('new detail and legacy single-letter records remain readable',()=>{
 assert.deepEqual(readFeedbackResponse({feedback:letter},letter.id),letter);
 const current={...letter,messages:[{id:'original',role:'student',content:letter.content,created_at:1000}]};
 assert.deepEqual(readFeedbackResponse({feedback:current},letter.id),current);
});
test('old inbox array gives a deployment error instead of entering detail state',()=>{
 assert.throws(()=>readFeedbackResponse({feedback:[letter],hasMore:false,counts:[]},letter.id),/后台来信接口版本尚未更新/);
 assert.throws(()=>readFeedbackResponse({feedback:[]},letter.id),/bridge-api/);
});
test('malformed or mismatched detail is rejected before React renders it',()=>{
 for(const invalid of [null,{},{...letter,status:'other'},{...letter,created_at:'2026-10-18'},{...letter,updated_at:1e20},{...letter,messages:{}},{...letter,messages:[null]},{...letter,messages:[{id:'x',role:'staff',content:{},created_at:2000}]}]){
  assert.throws(()=>readFeedbackResponse({feedback:invalid},letter.id),/返回格式异常/);
 }
 assert.throws(()=>readFeedbackResponse({feedback:letter},'different-letter'),/返回格式异常/);
 assert.throws(()=>readFeedbackResponse({ok:true}),/返回格式异常/);
});
