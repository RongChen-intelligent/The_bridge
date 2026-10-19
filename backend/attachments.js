'use strict';
const {randomUUID,createHash}=require('node:crypto');
const CHUNK=512*1024,MAX_FILE=10*1024*1024,MAX_TOTAL=40*1024*1024;
const types=['image/png','image/jpeg','image/webp','application/pdf'];
const key=id=>'attachment:'+id;
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
function signature(type,b){return type==='application/pdf'?b.subarray(0,5).toString()==='%PDF-':type==='image/png'?b.subarray(0,8).toString('hex')==='89504e470d0a1a0a':type==='image/jpeg'?b.subarray(0,3).toString('hex')==='ffd8ff':b.subarray(0,4).toString()==='RIFF'&&b.subarray(8,12).toString()==='WEBP';}
function createAttachments({store,now,fail,legacy}){
 const error=(message,status=400)=>fail(status,message,'Attachment upload failed.');
 function active(m,actor){if(!m||m.kind!=='attachment-upload'||m.owner!==actor||m.bound||Date.parse(m.expiresAt)<=now())error('上传已失效或无权使用，请重新选择附件。',409);}
 return {
  async start(data,actor){
   if(typeof data.name!=='string'||!data.name.trim()||data.name.length>180||!types.includes(data.type)||!Number.isSafeInteger(data.size)||data.size<12||data.size>MAX_FILE)error('附件须为图片或 PDF，单个不超过 10 MB。');
   const id=randomUUID(),m={id,kind:'attachment-upload',owner:actor,name:data.name.trim(),type:data.type,size:data.size,chunks:Math.ceil(data.size/CHUNK),next:0,created_at:now(),expiresAt:new Date(now()+86400000).toISOString()};
   await store.set('meta',key(id),m);return {id,chunk_size:CHUNK,chunks:m.chunks};
  },
  async put(id,part,bytes,actor){
   if(!/^[a-zA-Z0-9_-]{1,80}$/.test(id??'')||!Number.isInteger(part)||part<0||bytes.length>CHUNK)error('上传分段无效。');
   return store.transaction(async tx=>{
    const m=await tx.get('meta',key(id));active(m,actor);
    const expected=part===m.chunks-1?m.size-part*CHUNK:CHUNK;
    if(part>=m.chunks||bytes.length!==expected||part>m.next)error('上传分段长度或顺序不正确。');
    if(part===0&&!signature(m.type,bytes))error('文件内容与类型不符，请使用有效图片或 PDF。');
    const chunkKey=key(id)+':'+part,sha=digest(bytes);
    if(part<m.next){const old=await tx.get('meta',chunkKey);if(old?.sha!==sha)error('重试的附件内容不一致。',409);return {ok:true,next:m.next,ready:m.next===m.chunks};}
    await tx.set('meta',chunkKey,{kind:'attachment-chunk',upload_id:id,data:bytes.toString('base64'),sha,created_at:now()});
    await tx.set('meta',key(id),{...m,next:m.next+1});return {ok:true,next:m.next+1,ready:m.next+1===m.chunks};
   });
  },
  async resolve(value,old=[],{tx,actor,kind,id}){
   if(value===undefined)return old;
   if(!Array.isArray(value)||value.length>8)error('每条内容最多 8 个附件。');
   const files=[];let total=0;
   for(const f of value){
    if(!f||typeof f!=='object')error('附件格式无效。');
    if(f.id&&files.some(x=>x.id===f.id))error('同一附件不能重复添加。');
    let result=old.find(x=>x.id===f.id);
    if(!result&&f.data)result=legacy([f],[],1)[0];
    if(!result){
     if(!/^[a-zA-Z0-9_-]{1,80}$/.test(f.id??''))error('附件标识无效。');
     const m=await tx.get('meta',key(f.id));if(!m)error('附件不存在，请重新选择附件。');active(m,actor);
     if(m.next!==m.chunks)error('附件尚未上传完整，请重新上传。');
     result={id:m.id,name:m.name,type:m.type,size:m.size,chunked:true,chunks:m.chunks};
     await tx.set('meta',key(m.id),{...m,bound:{kind,id},expiresAt:null});
    }
    if(files.some(x=>x.id===result.id))error('同一附件不能重复添加。');
    total+=result.size;if(total>MAX_TOTAL)error('附件合计不能超过 40 MB。');files.push(result);
   }
   for(const f of old)if(f.chunked&&!files.some(x=>x.id===f.id)){const m=await tx.get('meta',key(f.id));if(m)await tx.set('meta',key(f.id),{...m,expiresAt:new Date(now()+86400000).toISOString()});}
   return files;
  },
  async read(file,part){
   if(!Number.isInteger(part)||part<0||part>=file.chunks)error('附件分段不存在。',404);
   const chunk=await store.get('meta',key(file.id)+':'+part);if(!chunk)error('附件不存在或上传不完整。',404);
   return chunk.data;
  }
 };
}
// Runs after ordinary TTL cleanup. Bound uploads retain their manifests permanently.
const pruneOrphanChunks=`WITH orphan AS (
 SELECT c.id FROM bridge_private.records c
 WHERE c.entity='meta' AND c.payload->>'kind'='attachment-chunk' AND c.created_at<$1
 AND NOT EXISTS (SELECT 1 FROM bridge_private.records m WHERE m.entity='meta' AND m.id='attachment:'||(c.payload->>'upload_id'))
 LIMIT $2 FOR UPDATE SKIP LOCKED
) DELETE FROM bridge_private.records r USING orphan o WHERE r.entity='meta' AND r.id=o.id`;
module.exports={createAttachments,pruneOrphanChunks,CHUNK,MAX_FILE,MAX_TOTAL};

