import {api,readResponse} from './client';
import type {Attachment} from './modules';
export const MAX_FILE=10*1024*1024,MAX_TOTAL=40*1024*1024;
export function fileURL(kind:'notice'|'poll',id:string,file:Attachment){const u=new URL(window.BRIDGE_CONFIG?.apiBase??'/bridge-api',location.origin);u.search=new URLSearchParams({route:'attachment',kind,id,file:file.id}).toString();return u.href;}
export function attachmentReference(file:Attachment){const {data,uploaded,...reference}=file;return reference;}
export async function uploadAttachment(file:Attachment,onProgress:(percent:number)=>void):Promise<Attachment>{
 if(!file.data||file.uploaded)return file;
 const blob=await fetch(file.data).then(r=>r.blob());
 const upload=await api<{id:string;chunk_size:number;chunks:number}>('/api/upload','POST',{name:file.name,type:file.type,size:blob.size});
 if(!upload.id||upload.chunk_size!==512*1024||!Number.isInteger(upload.chunks))throw Error('后台上传接口尚未更新，请部署 1.3.0 云函数后重试。');
 for(let part=0;part<upload.chunks;part++){
  const body=blob.slice(part*upload.chunk_size,Math.min(blob.size,(part+1)*upload.chunk_size));
  for(let attempt=0;;attempt++){
   try{await readResponse(await fetch(`/api/upload?id=${encodeURIComponent(upload.id)}&part=${part}`,{method:'PUT',credentials:'same-origin',headers:{'Content-Type':'application/octet-stream'},body}));break;}
   catch(error){const status=(error as {status?:number}).status;if(attempt>=2||(status&&status<500&&status!==429))throw error;await new Promise(r=>setTimeout(r,400*(attempt+1)));}
  }
  onProgress(Math.round((part+1)/upload.chunks*100));
 }
 return {...file,id:upload.id,chunked:true,chunks:upload.chunks,uploaded:true};
}
export async function attachmentBlob(kind:'notice'|'poll',id:string,file:Attachment,signal?:AbortSignal):Promise<Blob>{
 const base=fileURL(kind,id,file);
 if(!file.chunked){const r=await fetch(base,{signal,credentials:'same-origin'});if(!r.ok)throw Error('附件加载失败，请重试。');return r.blob();}
 if(!Number.isInteger(file.chunks)||file.chunks!<1||file.chunks!>20||file.size>MAX_FILE)throw Error('附件信息无效，请刷新。');
 const parts:Blob[]=new Array(file.chunks);let next=0;
 await Promise.all(Array.from({length:2},async()=>{while(next<file.chunks!){const part=next++,url=new URL(base);url.searchParams.set('part',String(part));const r=await fetch(url,{signal,credentials:'same-origin'});if(!r.ok)throw Error('附件加载失败，请重试。');parts[part]=await r.blob();}}));
 const blob=new Blob(parts,{type:file.type});if(blob.size!==file.size)throw Error('附件未完整加载，请重试。');return blob;
}
