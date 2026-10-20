'use strict';
const {randomUUID}=require('node:crypto');
const states=['draft','pending','approved','rejected','withdrawn'];
const table=k=>k==='notice'?'notices':'polls';
const key=id=>'review:'+id;
const pointer=(kind,id)=>'review-active:'+kind+':'+id;
const files=row=>row?.attachments??row?.options?.map(o=>o.image).filter(Boolean)??[];
const union=(...lists)=>[...new Map(lists.flat().map(f=>[f.id,f])).values()];
const actor=a=>({id:a.id,name:a.display_name,username:a.username});
function createModeration({store,uploads,authorize,audit,now,fail,idOK,textOK,fileMeta,hash}){
 const conflict=()=>fail(409,'内容或申请已变更，请刷新后重试。','Content or review changed. Refresh.');
 function safeContent(row){if(!row)return null;return {...row,...(row.attachments?{attachments:row.attachments.map(fileMeta)}:{}),...(row.options?{options:row.options.map(o=>({...o,...(o.image?{image:fileMeta(o.image)}:{})}))}:{})};}
 function safe(r,current,detail=false){const {candidate,content_kind,...rest}=r;return {...rest,kind:content_kind,...(detail?{candidate:safeContent(candidate),current:safeContent(current)}:{})};}
 async function read(id,db=store){if(!idOK(id))fail(404,'申请不存在。','Review not found.');const r=await db.get('meta',key(id));if(r?.kind!=='moderation-review')fail(404,'申请不存在。','Review not found.');return r;}
 async function release(tx,discard,keep,kind,id){await uploads.references(keep,discard,{tx,kind,id});}
 async function clearPointer(tx,r){const p=await tx.get('meta',pointer(r.content_kind,r.target_id));if(p?.review_id===r.id)await tx.remove('meta',pointer(r.content_kind,r.target_id));}
 async function invalidate(tx,kind,id,a,data,live){const p=await tx.get('meta',pointer(kind,id));if(!p)return;const r=await read(p.review_id,tx);if(r.state!=='pending'){await clearPointer(tx,r);return;}if(data.invalidate_review!==true)fail(409,'此内容有待审核申请。确认直接操作并使该申请失效？','Pending review exists.',{reviewConflict:true});await release(tx,files(r.candidate),[],'review',r.id);await tx.set('meta',key(r.id),{...r,candidate:null,state:'withdrawn',reason:'管理员直接操作，原申请已失效。',invalidated:true,version:r.version+1,updated_by:actor(a),updated_at:now()});await clearPointer(tx,r);await audit(tx,a,'review.invalidate',r.id);}
 async function source(data,kind,method,tx){let review=null;if(data.review_id){review=await read(data.review_id,tx);if(review.content_kind!==kind||review.version!==data.review_version||!['draft','withdrawn','rejected'].includes(review.state)||review.invalidated)conflict();if((method==='POST')!==(review.action==='create'))conflict();}const id=review?.target_id??(method==='POST'?randomUUID():data.id);if(!idOK(id))fail(400,'无效内容。','Invalid content.');const old=await tx.get(table(kind),id);if(method==='PATCH'&&(!old||!Number.isSafeInteger(data.version)||data.version!==(old.version??0)))conflict();if(method==='POST'&&old)conflict();return {id,old,review};}
 async function candidate(kind,method,data,old,review,id,a,tx,staging,rid){
  const previous=union(files(old),files(review?.candidate));const options={tx,actor:a.id,kind:staging?'review':kind,id:staging?rid:id};
  if(kind==='notice'){
   if(!textOK(data.title,2,120)||!textOK(data.content,1,6000)||!['draft','published'].includes(data.state))fail(400,'请检查通知标题、正文和状态。','Check notice fields.');
   if(data.publish_at!==undefined&&(!Number.isSafeInteger(data.publish_at)||data.publish_at<0||data.publish_at>now()+366*86400000))fail(400,'请选择一年以内的发布时间。','Invalid publication time.');
   return {id,title:data.title.trim(),content:data.content.trim(),format:data.format==='markdown'?'markdown':'plain',align:['left','center','right'].includes(data.align)?data.align:'left',text_size:['small','normal','large','xlarge'].includes(data.text_size)?data.text_size:'normal',attachments:await uploads.resolve(data.attachments??files(review?.candidate??old),previous,options),publish_at:data.publish_at??old?.publish_at??now(),state:'published',created_at:old?.created_at??review?.candidate?.created_at??now(),updated_at:now(),version:old?(old.version??0)+1:0};
  }
  const opts=Array.isArray(data.options)?data.options.map(o=>typeof o==='string'?{label:o}:o):[],max=data.max_choices??1;
  if(!textOK(data.title,2,120)||!textOK(data.description,0,2000)||opts.length<2||opts.length>8||opts.some(o=>!o||!textOK(o.label,1,100))||new Set(opts.map(o=>o.label.trim().toLowerCase())).size!==opts.length||!Number.isInteger(max)||max<1||max>opts.length||!Number.isSafeInteger(data.ends_at)||data.ends_at<=now()||data.ends_at>now()+366*86400000)fail(400,'请检查投票题目、选项、最多选择数和截止时间。','Check poll fields.');
  if(old&&(old.state==='closed'||old.ends_at<=now()||old.total>0))fail(409,'已有投票或已截止，不能修改题目和选项。','Poll locked.');
  const images=await uploads.resolve(opts.filter(o=>o.image).map(o=>o.image),previous,options);if(images.some(f=>!f.type.startsWith('image/')))fail(400,'投票选项只能使用图片。','Images only.');let imageIndex=0;
  return {id,title:data.title.trim(),description:data.description.trim(),options:opts.map(o=>({id:old?.options.find(x=>x.id===o.id)?.id??review?.candidate?.options.find(x=>x.id===o.id)?.id??randomUUID(),label:o.label.trim(),votes:0,...(o.image?{image:images[imageIndex++]}:{})})),max_choices:max,show_counts:data.show_counts!==false,show_percent:data.show_percent!==false,version:old?(old.version??0)+1:0,state:'open',created_at:old?.created_at??review?.candidate?.created_at??now(),ends_at:data.ends_at,total:0};
 }
 async function apply(tx,kind,action,id,current,next,a){
  if(action==='delete'){await release(tx,files(current),[],kind,id);await tx.remove(table(kind),id);if(kind==='poll')await tx.remove('activity',hash(id));}
  else if(action==='close'||action==='settings'){if(!current)conflict();await tx.set(table(kind),id,{...current,...(action==='close'?{state:'closed'}:{show_counts:next.show_counts,show_percent:next.show_percent}),version:(current.version??0)+1,updated_at:now()});}
  else {await release(tx,files(current),files(next),kind,id);await tx.set(table(kind),id,{...next,version:current?(current.version??0)+1:0,updated_at:now()});}
  await audit(tx,a,kind+'.'+action,id);
 }
 return {
  async mutate(kind,method,data,cookies){return store.transaction(async tx=>{
   const a=await authorize(cookies,false,tx),{id,old,review}=await source(data,kind,method,tx);
   const action=method==='POST'?'create':data.action??'edit';if(!['create','edit','delete','close','settings'].includes(action)||(kind==='notice'&&!['create','edit','delete'].includes(action)))fail(400,'无效操作。','Invalid action.');
   if(action==='create'&&method!=='POST')fail(400,'无效操作。','Invalid action.');
   const rid=review?.id??randomUUID();
   if(review&&review.action!==action)conflict();
   const draft=data.state==='draft',staging=a.role!=='owner'||draft||!!review;
   const p=await tx.get('meta',pointer(kind,id));if(p){const pending=await read(p.review_id,tx);if(pending.state==='pending'){if(a.role==='owner'&&!staging)await invalidate(tx,kind,id,a,data,old);else conflict();}}
   let next=null;
   if(action==='create'||action==='edit')next=await candidate(kind,method,data,old,review,id,a,tx,staging,rid);
   else if(action==='settings'){if(typeof data.show_counts!=='boolean'||typeof data.show_percent!=='boolean')fail(400,'无效展示设置。','Invalid settings.');next={...old,show_counts:data.show_counts,show_percent:data.show_percent};}
   else if(action==='close'){if(old.state==='closed'||old.ends_at<=now())fail(409,'投票已经结束。','Poll already closed.');next={...old,state:'closed'};}
   if(!staging){await apply(tx,kind,action,id,old,next,a);return {ok:true,id};}
   const r={id:rid,kind:'moderation-review',content_kind:kind,target_id:id,action,title:next?.title??old?.title??review?.title,state:draft?'draft':'pending',candidate:next,base_version:old?.version??null,version:review?review.version+1:0,submitted_by:actor(a),updated_by:actor(a),created_at:review?.created_at??now(),submitted_at:draft?null:now(),updated_at:now(),reason:''};
   if(action==='settings'||action==='close')await release(tx,files(review?.candidate),files(next),'review',rid);
   await tx.set('meta',key(rid),r);if(!draft)await tx.set('meta',pointer(kind,id),{review_id:rid});await audit(tx,a,'review.'+(draft?'draft':'submit'),rid);return {ok:true,id,review_id:rid,review_state:r.state};
  });},
  async list(q,cookies){await authorize(cookies);if(q.id){const r=await read(q.id),current=await store.get(table(r.content_kind),r.target_id);return {review:safe(r,current,true)};}const state=q.state??'pending';if(!states.includes(state))fail(400,'无效审核状态。','Invalid review state.');const page=Math.max(0,Math.min(100000,Math.floor(Number(q.page)||0)));const rows=await store.list('meta',{kind:'moderation-review',state},21,page*20,'latest');return {reviews:rows.slice(0,20).map(r=>safe(r,null)),hasMore:rows.length>20};},
  async change(data,cookies){return store.transaction(async tx=>{
   const action=data.action;if(!['approve','reject','withdraw','delete'].includes(action))fail(400,'无效审核操作。','Invalid review action.');const a=await authorize(cookies,['approve','reject'].includes(action),tx),r=await read(data.id,tx);if(!Number.isSafeInteger(data.version)||r.version!==data.version)conflict();const current=await tx.get(table(r.content_kind),r.target_id);
   if(action==='delete'){if(!['draft','withdrawn','rejected'].includes(r.state))conflict();await release(tx,files(r.candidate),[],'review',r.id);await tx.remove('meta',key(r.id));await clearPointer(tx,r);await audit(tx,a,'review.delete',r.id);return {ok:true};}
   if(r.state!=='pending')conflict();
   if(action==='reject'&&!textOK(data.reason,1,500))fail(400,'请填写退回原因。','A rejection reason is required.');
   if(action==='approve'){
    if((current?.version??null)!==r.base_version)conflict();
    if(r.content_kind==='poll'&&['create','edit'].includes(r.action)&&(!r.candidate||r.candidate.ends_at<=now()||current&&(current.total>0||current.state==='closed'||current.ends_at<=now())))fail(409,'投票已截止或已有投票，请退回后重新处理。','Poll expired or has votes.');
    if(r.action==='close'&&(!current||current.state==='closed'||current.ends_at<=now()))conflict();
    await apply(tx,r.content_kind,r.action,r.target_id,current,r.candidate,a);
    await release(tx,files(r.candidate),[],'review',r.id);
   }
   const state=action==='approve'?'approved':action==='reject'?'rejected':'withdrawn';
   const next={...r,state,version:r.version+1,updated_at:now(),updated_by:actor(a),reason:action==='reject'?data.reason.trim():'',...(action==='approve'?{candidate:null,reviewed_by:actor(a),reviewed_at:now()}:{}),...(action==='reject'?{reviewed_by:actor(a),reviewed_at:now()}: {})};
   await tx.set('meta',key(r.id),next);await clearPointer(tx,r);await audit(tx,a,'review.'+action,r.id);return {ok:true,review:safe(next,current,true)};
  });},
  async attachment(id,cookies){await authorize(cookies);const r=await read(id);return {attachments:files(r.candidate)};}
 };
}
module.exports={createModeration};
