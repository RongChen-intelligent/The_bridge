export class ApiError extends Error{constructor(message:string,public status:number,public retryAfter=0,public reviewConflict=false){super(message);}}
export async function readResponse<T=Record<string,unknown>>(r:Response):Promise<T>{
 let result:{error?:string;message?:string;code?:string;reviewConflict?:boolean};try{result=await r.json();}catch{throw new ApiError(r.status===413?'文件请求过大，请更新至最新版后重新上传。':`服务器返回异常（${r.status}），请稍后重试。`,r.status);}
 if(!r.ok||result.code==='EXCEED_MAX_PAYLOAD_SIZE')throw new ApiError(result.error??(r.status===413||result.code==='EXCEED_MAX_PAYLOAD_SIZE'?'图片请求超过网关限制，请使用新版附件上传功能。':`请求失败（${r.status}），请重试；若持续失败，请联系维护者。`),r.status,Math.max(0,Math.min(3600,Number(r.headers.get('Retry-After'))||0)),result.reviewConflict===true);
 return result as T;
}
export async function api<T=Record<string,unknown>>(path:string,method='GET',data?:unknown):Promise<T>{
 const r=await fetch(path,{method,cache:'no-store',credentials:'same-origin',...(data===undefined?{}:{headers:{'Content-Type':'application/json'},body:JSON.stringify(data)})});
 return readResponse<T>(r);
}
