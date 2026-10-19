'use strict';
const {randomBytes,randomUUID,randomInt,createHash,createHmac,scrypt:derive,timingSafeEqual}=require('node:crypto');
const {promisify}=require('node:util');
const {createAttachments,CHUNK}=require('./attachments');
const {firstReplyAt,expiresAt:letterExpiresAt,expired}=require('./retention');
const LETTER_GONE='未找到来信：该信件可能已在首次回信后超过30天，或被工作人员删除。请同时核对查询码。';
const scrypt=promisify(derive);
const hash=v=>createHash('sha256').update(v).digest('hex');
const token=()=>randomBytes(32).toString('hex');
const usernameOK=v=>typeof v==='string'&&/^[a-z0-9][a-z0-9._-]{2,31}$/.test(v);
const passwordOK=v=>typeof v==='string'&&[...v].length>=15&&[...v].length<=128;
const hashOK=v=>typeof v==='string'&&/^scrypt:16384:8:5:[a-f0-9]{64}:[a-f0-9]{64}$/.test(v);
const categories=['学习与教学','食堂与餐饮','校园设施','校园生活','活动与社团','其他建议'];
const statuses=['pending','processing','completed'];
const normalize=v=>typeof v==='string'?v.replace(/[\s-]/g,'').toUpperCase():'';
const textOK=(v,min,max)=>typeof v==='string'&&v.trim().length>=min&&v.trim().length<=max;
const idOK=v=>typeof v==='string'&&/^[a-zA-Z0-9_-]{1,80}$/.test(v);
const safeUser=a=>({id:a.id,username:a.username,display_name:a.display_name,role:a.role,must_change:a.must_change});
const letterMessages=a=>Array.isArray(a.messages)?a.messages:[{id:'original',role:'student',content:a.content,created_at:a.created_at},...(a.reply?[{id:'legacy-reply',role:'staff',content:a.reply,created_at:a.updated_at}]:[])];
const safeLetter=a=>({first_reply_at:firstReplyAt(a),expires_at:letterExpiresAt(a),...Object.fromEntries(['id','title','category','content','status','reply','created_at','updated_at','version'].map(k=>[k,a[k]])),messages:letterMessages(a),student_count:a.student_count??1,reply_count:a.reply_count??letterMessages(a).filter(m=>m.role==='staff').length});
const fileMeta=f=>({id:f.id,name:f.name,type:f.type,size:f.size,...(f.chunked?{chunked:true,chunks:f.chunks}:{})});
function attachmentFiles(value,old=[],maxFiles=4){
  if(value===undefined)return old;
  if(!Array.isArray(value)||value.length>maxFiles)fail(400,`最多添加 ${maxFiles} 个附件。`,`Up to ${maxFiles} attachments per item.`);
  let total=0;
  const files=value.map(f=>{
    if(!f||typeof f!=='object')fail(400,'附件格式无效。','Invalid attachment.');
    if(!f.data){const kept=old.find(x=>x.id===f.id);if(!kept)fail(400,'附件已失效，请重新上传。','Upload this attachment again.');total+=kept.size;return kept;}
    if(!textOK(f.name,1,180)||typeof f.data!=='string')fail(400,'附件格式无效。','Invalid attachment.');
    const match=f.data.match(/^data:(image\/(?:png|jpeg|webp)|application\/pdf);base64,([A-Za-z0-9+/]+={0,2})$/);
    if(!match)fail(400,'仅支持 PNG、JPEG、WebP 图片与 PDF。','Use PNG, JPEG, WebP or PDF.');
    const bytes=Buffer.from(match[2],'base64'),kind=match[1];
    const valid=kind==='application/pdf'?bytes.subarray(0,5).toString()==='%PDF-':kind==='image/png'?bytes.subarray(0,8).toString('hex')==='89504e470d0a1a0a':kind==='image/jpeg'?bytes.subarray(0,3).toString('hex')==='ffd8ff':bytes.subarray(0,4).toString()==='RIFF'&&bytes.subarray(8,12).toString()==='WEBP';
    if(!valid||bytes.length<12||bytes.length>1024*1024||bytes.toString('base64')!==match[2])fail(400,'附件无效或超过 1 MB。','Attachment is invalid or larger than 1 MB.');
    total+=bytes.length;return {id:randomUUID(),name:f.name.trim(),type:kind,size:bytes.length,data:f.data};
  });
  if(total>2*1024*1024)fail(400,'附件合计不能超过 2 MB。','Combined attachments must not exceed 2 MB.');
  return files;
}
const safeNotice=n=>({...n,attachments:(n.attachments??[]).map(fileMeta)});
class HttpError extends Error { constructor(status,zh,en,extra={}) {super(zh+' / '+en);this.status=status;this.extra=extra;} }
function fail(status,zh,en,extra) {throw new HttpError(status,zh,en,extra);}
async function hashPassword(password) {const salt=token();return `scrypt:16384:8:5:${salt}:${(await scrypt(password,salt,32,{N:16384,r:8,p:5,maxmem:32*1024*1024})).toString('hex')}`;}
async function verifyPassword(password,stored) {
  const p=(hashOK(stored)?stored:`scrypt:16384:8:5:${'0'.repeat(64)}:${'0'.repeat(64)}`).split(':');
  const actual=await scrypt(password,p[4],32,{N:16384,r:8,p:5,maxmem:32*1024*1024});
  return timingSafeEqual(actual,Buffer.from(p[5],'hex'));
}
function createApp({store,config,now=Date.now}) {
  const uploads=createAttachments({store,now,fail,legacy:attachmentFiles});
  const origin=config.PUBLIC_ORIGIN;
  async function activeLetter(id){return store.transaction(async tx=>{const row=await tx.get('feedback',id);if(row&&expired(row,now())){await tx.remove('feedback',id);return null;}return row;});}

  let originURL;try{originURL=new URL(origin);}catch{}
  const local=originURL?.protocol==='http:'&&['127.0.0.1','localhost'].includes(originURL.hostname);
  const configured=originURL&&(originURL.protocol==='https:'||local)&&originURL.origin===origin;
  const sessionName=local?'bridge_session':'__Host-bridge_session';
  const voterName=local?'bridge_voter':'__Host-bridge_voter';
  const cookie=(name,value,age)=>`${name}=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${age}${local?'':'; Secure'}`;
  async function bootstrap() {
    if(await store.get('meta','owner'))return;
    if(!hashOK(config.OWNER_BOOTSTRAP_PASSWORD_HASH))fail(503,'管理员尚未配置，请联系网站维护者。','Owner configuration is incomplete.');
    const id=hash('bridge.admin'),at=now(),auditId=randomUUID();
    await store.transaction(async tx=>{
      if(await tx.get('meta','owner'))return;
      if(await tx.get('accounts',id))throw Error('Owner username already exists');
      await tx.set('accounts',id,{id,username:'bridge.admin',display_name:'网站管理员 / Site owner',password_hash:config.OWNER_BOOTSTRAP_PASSWORD_HASH,role:'owner',active:1,must_change:1,auth_version:0,created_at:at});
      await tx.set('meta','owner',{id,created_at:at,schema_version:1});
      await tx.set('audit',auditId,{id:auditId,actor:id,action:'owner.provision',target:id,created_at:at});
    });
  }
  async function audit(tx,user,action,target) {const id=randomUUID();await tx.set('audit',id,{id,actor:user.id,action,target,created_at:now()});}
  async function session(cookies,db=store) {
    const t=cookies[sessionName];if(!/^[a-f0-9]{64}$/.test(t??''))return null;
    const s=await db.get('sessions',hash(t));if(!s||s.expires_at<=now())return null;
    const a=await db.get('accounts',s.account_id);
    return a&&a.active&&a.auth_version===s.auth_version?a:null;
  }
  async function authorize(cookies,owner=false,db=store) {
    const a=await session(cookies,db);
    if(!a||a.must_change||(owner&&a.role!=='owner'))fail(403,'需要有效的工作人员权限。','Authorized staff access required.');return a;
  }
  async function issueSession(tx,a,raw) {await tx.set('sessions',hash(raw),{account_id:a.id,auth_version:a.auth_version,expires_at:now()+28800000,expiresAt:new Date(now()+28800000),created_at:now()});}
  async function budgets(items) {
    const at=now();
    return store.transaction(async tx=>{
      let retry=0;
      for(const [key,max,ms] of items){const id=hash(key);let row=await tx.get('limits',id);if(!row||row.expires_at<=at)row={count:0,expires_at:at+ms,created_at:at};row.count++;await tx.set('limits',id,{...row,expiresAt:new Date(row.expires_at)});if(row.count>max)retry=Math.max(retry,Math.ceil((row.expires_at-at)/1000));}
      return retry;
    });
  }
  function limited(retry) {if(retry)fail(429,'操作过于频繁，请稍后重试。','Too many requests. Try again later.',{retryAfter:retry});}
  async function activity(tx,poll,field) {
    const minute=Math.floor(now()/60000),id=hash(poll);const old=await tx.get('activity',id);
    const buckets=(old?.buckets??[]).filter(b=>b.minute>minute-15);
    let bucket=buckets.find(b=>b.minute===minute);if(!bucket){bucket={minute,accepted:0,blocked:0};buckets.push(bucket);}bucket[field]++;
    await tx.set('activity',id,{buckets,created_at:old?.created_at??now(),expiresAt:new Date(now()+86400000)});
  }
  async function guard(poll,voter,phase,network) {
    const items=[[`poll:${poll}:${phase}:browser:${hash(voter)}`,phase==='ticket'?6:10,60000],[`poll:${poll}:${phase}:all`,600,60000]];
    if(network)items.push([`poll:${poll}:${phase}:net1:${network}`,120,60000],[`poll:${poll}:${phase}:net15:${network}`,600,900000]);
    const retry=await budgets(items);if(retry){await store.transaction(tx=>activity(tx,poll,'blocked'));limited(retry);}
  }
  async function networkKey(event) {
    // Only opt into a verified platform-injected requestContext field. Never trust X-Forwarded-For.
    const ip=config.TRUST_GATEWAY_SOURCE_IP==='true'?event.requestContext?.http?.sourceIp:null;
    if(typeof ip!=='string'||ip.length>80)return null;
    const day=Math.floor(now()/86400000),id='network-'+day;
    let key=await store.get('meta',id);
    if(!key)key=await store.transaction(async tx=>{const prior=await tx.get('meta',id);if(prior)return prior;const value={key:token(),created_at:now(),expiresAt:new Date(now()+2*86400000)};await tx.set('meta',id,value);return value;});
    return createHmac('sha256',key.key).update(ip).digest('hex');
  }
  return async function handle(event) {
    const headers={'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store, private','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'};
    const respond=(data,status=200)=>({statusCode:status,headers,isBase64Encoded:false,body:JSON.stringify(data)});
    try {
      if(!configured)fail(503,'服务器网址配置未完成。','Server origin configuration is incomplete.');
      const h=Object.fromEntries(Object.entries(event.headers??{}).map(([k,v])=>[k.toLowerCase(),String(v)]));
      const method=(event.httpMethod??'').toUpperCase();
      if(!['GET','POST','PUT','PATCH','OPTIONS'].includes(method))fail(405,'请求方式不支持。','Method not allowed.');
      if((h.origin&&h.origin!==origin)||h['sec-fetch-site']==='cross-site')fail(403,'请从本站页面访问。','Use this website to access the service.');
      if(method==='OPTIONS'){headers['Access-Control-Allow-Origin']=origin;headers['Access-Control-Allow-Credentials']='true';headers['Access-Control-Allow-Methods']='GET, POST, PUT, PATCH, OPTIONS';headers['Access-Control-Allow-Headers']='Content-Type';return respond({},204);}
      const q=event.queryStringParameters??{};
      const route=typeof q.route==='string'?q.route:'health';
      const cookies=Object.fromEntries((h.cookie??'').split(';').map(v=>{const p=v.trim().indexOf('=');return p<0?[]:[v.trim().slice(0,p),v.trim().slice(p+1)];}).filter(p=>p.length===2));
      if(route==='upload'&&method==='PUT'){
        if(h.origin!==origin||h['content-type']?.split(';')[0]!=='application/octet-stream')fail(403,'请从本站上传附件。','Same-origin binary uploads required.');
        const a=await authorize(cookies);
        if(typeof event.body!=='string'||event.body.length>Math.ceil(CHUNK/3)*4+4)fail(413,'附件分段过大。','Upload chunk too large.');
        if(!event.isBase64Encoded)fail(400,'上传网关未按二进制传递文件，请联系维护者。','Binary gateway encoding required.');
        const bytes=Buffer.from(event.body,'base64');
        return respond(await uploads.put(q.id,Number(q.part),bytes,a.id));
      }
      let data={};
      if(method!=='GET'){
        if(h.origin!==origin||!h['content-type']?.includes('application/json'))fail(403,'请从本站提交 JSON 请求。','Same-origin JSON requests required.');
        const upload=['notices','polls'].includes(route)&&['POST','PATCH'].includes(method);
        if(upload)await authorize(cookies);
        if(typeof event.body!=='string'||event.body.length>(upload?4*1024*1024:33000))fail(413,'请求内容过长。','Request too large.');
        const raw=event.isBase64Encoded?Buffer.from(event.body,'base64').toString('utf8'):event.body;
        if(Buffer.byteLength(raw)>(upload?3*1024*1024:24000))fail(413,'请求内容过长。','Request too large.');
        try{data=JSON.parse(raw);}catch{fail(400,'请求格式不正确。','Invalid JSON.');}
        if(!data||typeof data!=='object'||Array.isArray(data))fail(400,'请求格式不正确。','Invalid request.');
      }
      if(route==='upload'&&method==='POST'){const a=await authorize(cookies);return respond(await uploads.start(data,a.id),201);}
      if(route==='health'&&method==='GET'){const owner=await store.get('meta','owner');return respond({ok:true,service:'THE BRIDGE',storage:'postgresql',schema:1,api_version:4,release:'1.4.0',ownerConfigured:!!owner});}
      if(route==='auth') {
        await bootstrap();
        if(method==='GET'){const a=await session(cookies);return respond({user:a?safeUser(a):null});}
        if(method!=='POST')fail(405,'请求方式不支持。','Method not allowed.');
        if(data.action==='setup')fail(409,'管理员由服务器预设，无需公开注册。','The owner is provisioned by the server. Public registration is disabled.');
        if(data.action==='logout'){if(/^[a-f0-9]{64}$/.test(cookies[sessionName]??''))await store.remove('sessions',hash(cookies[sessionName]));headers['Set-Cookie']=cookie(sessionName,'',0);return respond({ok:true});}
        if(data.action==='login') {
          const username=typeof data.username==='string'?data.username.trim().toLowerCase():'';
          if(!usernameOK(username)||typeof data.password!=='string'||data.password.length>512)fail(401,'用户名或密码不正确。','Incorrect username or password.');
          limited(await budgets([[`auth:${username}`,10,900000],['auth:global',300,900000]]));
          const a=await store.get('accounts',hash(username));const valid=await verifyPassword(data.password,a?.password_hash);
          if(!a||!a.active||!valid)fail(401,'用户名或密码不正确。','Incorrect username or password.');
          const raw=token();await store.transaction(async tx=>{const current=await tx.get('accounts',a.id);if(!current?.active||current.auth_version!==a.auth_version)fail(401,'账号状态已变更，请重试。','Account changed. Try again.');await issueSession(tx,a,raw);});
          headers['Set-Cookie']=cookie(sessionName,raw,28800);return respond({user:safeUser(a)});
        }
        if(data.action==='password'){
          const a=await session(cookies);if(!a)fail(401,'请先登录。','Sign in first.');
          limited(await budgets([[`password:${a.id}`,10,900000]]));
          if(typeof data.current!=='string'||data.current.length>512||!passwordOK(data.password)||data.current===data.password)fail(400,'请输入原密码与不同的新密码（15–128 字符）。','Enter the current password and a different new password (15–128 characters).');
          if(!await verifyPassword(data.current,a.password_hash))fail(403,'原密码不正确。','Incorrect current password.');
          const password_hash=await hashPassword(data.password),raw=token(),next={...a,password_hash,must_change:0,auth_version:a.auth_version+1};
          await store.transaction(async tx=>{const current=await session(cookies,tx);if(!current||current.auth_version!==a.auth_version)fail(409,'账号状态已变更。','Account changed.');await tx.set('accounts',a.id,next);await issueSession(tx,next,raw);await audit(tx,a,'password.change',a.id);});
          headers['Set-Cookie']=cookie(sessionName,raw,28800);return respond({user:safeUser(next)});
        }
        fail(400,'无效操作。','Invalid action.');
      }
      if(route==='accounts'){
        await authorize(cookies,true);
        if(method==='GET'){const accounts=await store.list('accounts',{},1000);return respond({accounts:accounts.map(a=>({...safeUser(a),active:a.active,created_at:a.created_at}))});}
        if(method==='POST'){
          const username=typeof data.username==='string'?data.username.trim().toLowerCase():'';
          if(!usernameOK(username)||!textOK(data.name,1,60)||!passwordOK(data.password))fail(400,'请检查用户名、称呼和密码。','Check the username, name and password.');
          const password_hash=await hashPassword(data.password),id=hash(username);
          await store.transaction(async tx=>{const a=await authorize(cookies,true,tx);if(await tx.get('accounts',id))fail(409,'用户名已存在。','Username already exists.');await tx.set('accounts',id,{id,username,display_name:data.name.trim(),password_hash,role:'staff',active:1,must_change:1,auth_version:0,created_at:now()});await audit(tx,a,'staff.create',id);});return respond({ok:true},201);
        }
        if(method==='PATCH'){
          if(!idOK(data.id)||!['active','reset'].includes(data.action)||(data.action==='active'&&typeof data.active!=='boolean')||(data.action==='reset'&&!passwordOK(data.password)))fail(400,'账号操作无效。','Invalid account operation.');
          const password_hash=data.action==='reset'?await hashPassword(data.password):null;
          await store.transaction(async tx=>{const a=await authorize(cookies,true,tx),target=await tx.get('accounts',data.id);if(!target||target.role!=='staff')fail(403,'不能在此修改管理员。','Only staff accounts can be changed here.');const next={...target,auth_version:target.auth_version+1,...(password_hash?{password_hash,must_change:1}:{active:data.active?1:0})};await tx.set('accounts',target.id,next);await audit(tx,a,'staff.'+data.action,target.id);});return respond({ok:true});
        }
      }
      if(route==='challenge'&&method==='GET'){
        let visitor=cookies[voterName];if(!/^[a-f0-9]{64}$/.test(visitor??'')){visitor=token();headers['Set-Cookie']=cookie(voterName,visitor,31536000);}
        limited(await budgets([[`challenge:${hash(visitor)}`,10,60000],['challenge:global',600,60000]]));
        const a=randomInt(1,10),b=randomInt(1,10),id=token();await store.set('challenges',id,{answer_hash:hash(id+':'+(a+b)),created_at:now(),expires_at:now()+300000,expiresAt:new Date(now()+300000)});return respond({id,question:`${a} + ${b} = ?`});
      }
      if(route==='feedback'&&method==='POST'){
        const code=normalize(data.code);
        if(data.website||!textOK(data.title,2,60)||!textOK(data.content,10,2000)||!categories.includes(data.category)||!/^[A-F0-9]{32}$/.test(code)||!idOK(data.challengeId)||typeof data.answer!=='string'||!/^\d{1,2}$/.test(data.answer))fail(400,'请检查标题、分类、内容和验证答案。','Check the title, category, message and verification answer.');
        const id=hash(code),result=await store.transaction(async tx=>{
          const old=await tx.get('feedback',id);if(old){if(old.title!==data.title.trim()||old.content!==data.content.trim()||old.category!==data.category)fail(409,'查询码冲突，请重新提交。','Receipt conflict. Submit again.');return 'repeat';}
          const c=await tx.get('challenges',data.challengeId);
          if(!c||c.expires_at<=now()||c.answer_hash!==hash(data.challengeId+':'+data.answer)){if(c)await tx.remove('challenges',data.challengeId);return 'challenge';}
          await tx.set('feedback',id,{id,title:data.title.trim(),content:data.content.trim(),category:data.category,status:'pending',reply:'',student_count:1,messages:[{id:'original',role:'student',content:data.content.trim(),created_at:now()}],version:0,created_at:now(),updated_at:now()});await tx.remove('challenges',data.challengeId);return 'created';
        });if(result==='challenge')fail(400,'验证答案不正确或已过期。','Verification is incorrect or expired.',{refresh:true});return respond({ok:true},result==='created'?201:200);
      }
      if(route==='lookup'&&method==='POST'){
        const code=normalize(data.code);if(!/^[A-F0-9]{32}$/.test(code))fail(400,'请输入完整查询码。','Enter the full receipt code.');
        const row=await activeLetter(hash(code));if(!row)fail(404,LETTER_GONE,'Letter expired, deleted, or receipt not found.');return respond({feedback:safeLetter(row)});
      }
      if(route==='feedback'&&method==='PATCH'){
        const code=normalize(data.code);
        if(!/^[A-F0-9]{32}$/.test(code)||!textOK(data.content,1,2000)||!idOK(data.requestId))fail(400,'请检查查询码和补充内容（1–2000 字）。','Check the access code and message (1–2,000 characters).');
        const row=await store.transaction(async tx=>{
          const old=await tx.get('feedback',hash(code));if(!old||expired(old,now()))fail(404,LETTER_GONE,'Letter unavailable.');
          const messages=letterMessages(old),messageId='student-'+data.requestId,existing=messages.find(m=>m.id===messageId);
          if(existing){if(existing.content!==data.content.trim())fail(409,'提交内容已变更，请重新发送。','Message changed. Submit again.');return old;}
          const next={...old,messages:[...messages,{id:messageId,role:'student',content:data.content.trim(),created_at:now()}],student_count:(old.student_count??1)+1,status:'pending',version:old.version+1,updated_at:now()};
          await tx.set('feedback',old.id,next);return next;
        });return respond({feedback:safeLetter(row)});
      }
      if(route==='staff'){
        await authorize(cookies);
        if(method==='PATCH'&&data.action==='delete'){
          if(!idOK(data.id)||!Number.isSafeInteger(data.version))fail(400,'无效来信。','Invalid letter.');
          await store.transaction(async tx=>{const a=await authorize(cookies,false,tx),old=await tx.get('feedback',data.id);if(!old)fail(404,'来信已删除或过期。','Letter unavailable.');if(old.version!==data.version)fail(409,'来信有新内容，请刷新后再删除。','Letter changed. Refresh first.');await tx.remove('feedback',old.id);await audit(tx,a,'letter.delete',old.id);});return respond({ok:true});
        }
        if(method==='GET'){
          if(q.id){const row=idOK(q.id)?await activeLetter(q.id):null;if(!row)fail(404,'来信不存在。','Letter not found.');return respond({feedback:safeLetter(row)});}
          const page=Math.max(0,Math.min(100000,Math.floor(Number(q.page)||0))),where={active_at:now(),...(statuses.includes(q.status)?{status:q.status}:{}),...(categories.includes(q.category)?{category:q.category}:{})};
          const rows=await store.list('feedback',where,21,page*20,['oldest','most','latest'].includes(q.sort)?q.sort:'latest'),counts=await Promise.all(statuses.map(async status=>({status,count:await store.count('feedback',{...where,status})})));
          return respond({feedback:rows.slice(0,20).map(row=>({...safeLetter(row),messages:undefined})),hasMore:rows.length>20,counts});
        }
        if(method==='PATCH'){
          if(!idOK(data.id)||!statuses.includes(data.status)||!Number.isSafeInteger(data.version)||!textOK(data.reply,0,2000)||(data.status==='completed'&&!data.reply.trim()))fail(400,'请填写有效状态和回复。','Enter a valid status and reply.');
          const row=await store.transaction(async tx=>{const a=await authorize(cookies,false,tx),old=await tx.get('feedback',data.id);if(!old||expired(old,now()))fail(404,'来信不存在。','Letter not found.');const messages=letterMessages(old),messageId=data.requestId&&idOK(data.requestId)?'staff-'+data.requestId:null;
            if(messageId&&messages.some(m=>m.id===messageId)){if(messages.find(m=>m.id===messageId).content!==data.reply.trim())fail(409,'回复内容已变更。','Reply changed.');return old;}
            if(old.version!==data.version)fail(409,'来信有新内容，请刷新后回复。','New messages arrived. Refresh before replying.');
            const next={...old,first_reply_at:firstReplyAt(old)??(data.reply.trim()?now():null),status:data.status,reply:data.reply.trim()||old.reply,messages:[...messages,...(data.reply.trim()?[{id:messageId??randomUUID(),role:'staff',content:data.reply.trim(),created_at:now()}]:[])],version:old.version+1,updated_at:now()};await tx.set('feedback',old.id,next);await audit(tx,a,'letter.reply',old.id);return next;});return respond({ok:true,feedback:safeLetter(row)});
        }
      }
      if(route==='notices'){
        if(method==='GET'){const manage=q.manage==='1';if(manage)await authorize(cookies);if(q.id){const n=idOK(q.id)?await store.get('notices',q.id):null;if(!n||!manage&&(n.state!=='published'||(n.publish_at??0)>now()))fail(404,'通知不存在或尚未发布。','Update is unavailable.');return respond({notices:[safeNotice(n)],hasMore:false});}const page=Math.max(0,Math.floor(Number(q.page)||0)),rows=await store.list('notices',manage?{}:{state:'published',published_before:now()},21,page*20);return respond({notices:rows.slice(0,20).map(safeNotice),hasMore:rows.length>20});}
        await authorize(cookies);
        if(method==='PATCH'&&data.action==='delete'){
          if(!idOK(data.id)||!Number.isSafeInteger(data.version))fail(400,'无效通知。','Invalid update.');
          await store.transaction(async tx=>{const a=await authorize(cookies,false,tx),old=await tx.get('notices',data.id);if(!old||old.version!==data.version)fail(409,'通知已变更，请刷新。','Update changed. Refresh.');await uploads.resolve([],old.attachments,{tx,actor:a.id,kind:'notice',id:data.id});await tx.remove('notices',data.id);await audit(tx,a,'notice.delete',data.id);});return respond({ok:true});
        }
        if(!textOK(data.title,2,120)||!textOK(data.content,1,6000)||!['draft','published'].includes(data.state))fail(400,'请检查通知标题、正文和状态。','Check update title, content and status.');
        if(data.publish_at!==undefined&&(!Number.isSafeInteger(data.publish_at)||data.publish_at<0||data.publish_at>now()+366*86400000))fail(400,'请选择一年以内的发布时间。','Choose a publication time within one year.');
        if(method==='POST'||method==='PATCH'){
          if(method==='PATCH'&&(!idOK(data.id)||!Number.isSafeInteger(data.version)))fail(400,'无效通知。','Invalid update.');
          const id=method==='POST'?randomUUID():data.id;
          await store.transaction(async tx=>{const a=await authorize(cookies,false,tx),old=method==='PATCH'?await tx.get('notices',id):null;if(method==='PATCH'&&(!old||old.version!==data.version))fail(409,'通知已变更，请刷新。','Update changed. Refresh.');await tx.set('notices',id,{id,title:data.title.trim(),content:data.content.trim(),format:data.format==='markdown'?'markdown':'plain',align:['left','center','right'].includes(data.align)?data.align:'left',text_size:['small','normal','large','xlarge'].includes(data.text_size)?data.text_size:'normal',attachments:await uploads.resolve(data.attachments,old?.attachments,{tx,actor:a.id,kind:'notice',id}),publish_at:data.publish_at??old?.publish_at??now(),state:data.state,created_at:old?.created_at??now(),updated_at:now(),version:old?old.version+1:0});await audit(tx,a,'notice.'+(method==='POST'?'create':'update'),id);});return respond({ok:true,id},method==='POST'?201:200);
        }
      }
      if(route==='attachment'&&method==='GET'){
        if(!idOK(q.id)||!idOK(q.file)||!['notice','poll'].includes(q.kind))fail(404,'附件不存在。','Attachment not found.');
        const row=await store.get(q.kind==='notice'?'notices':'polls',q.id);
        if(!row)fail(404,'附件不存在。','Attachment not found.');
        if(q.kind==='notice'&&(row.state!=='published'||(row.publish_at??0)>now()))await authorize(cookies);
        const files=q.kind==='notice'?row.attachments??[]:row.options.map(o=>o.image).filter(Boolean),file=files.find(f=>f.id===q.file);
        if(file?.chunked){
          if(q.part===undefined)return respond({chunked:true,chunks:file.chunks,size:file.size,type:file.type,name:file.name});
          const body=await uploads.read(file,Number(q.part));
          return {statusCode:200,isBase64Encoded:true,headers:{...headers,'Content-Type':'application/octet-stream'},body};
        }
        if(!file?.data)fail(404,'附件不存在。','Attachment not found.');
        return {statusCode:200,isBase64Encoded:true,headers:{...headers,'Content-Type':file.type,'Content-Disposition':`${file.type==='application/pdf'?'attachment':'inline'}; filename*=UTF-8''${encodeURIComponent(file.name)}`,'Content-Security-Policy':"default-src 'none'; sandbox"},body:file.data.split(',')[1]};
      }
      if(route==='polls'&&method==='GET'){
        const manage=q.manage==='1';if(manage)await authorize(cookies);
        let voter=cookies[voterName];if(!/^[a-f0-9]{64}$/.test(voter??'')){voter=token();headers['Set-Cookie']=cookie(voterName,voter,31536000);}
        if(q.id&&!idOK(q.id))fail(404,'投票不存在。','Poll not found.');
        const where=q.state==='open'?{state:'open',ends_after:now()}:q.state==='closed'?{closed_at:now()}:{};
        const page=Math.max(0,Math.floor(Number(q.page)||0)),allRows=q.id?[await store.get('polls',q.id)].filter(Boolean):await store.list('polls',where,21,page*20),rows=allRows.slice(0,20),polls=[];
        if(q.id&&!rows.length)fail(404,'投票不存在。','Poll not found.');
        for(let start=0;start<rows.length;start+=10){const group=await Promise.all(rows.slice(start,start+10).map(async p=>{const vote=await store.get('votes',hash(p.id+':'+voter));let protection;
          if(manage){protection={accepted:0,blocked:0};const stat=await store.get('activity',hash(p.id));for(const b of stat?.buckets??[]){if(b.minute>Math.floor(now()/60000)-15){protection.accepted+=b.accepted;protection.blocked+=b.blocked;}}}
          const closed=p.ends_at<=now()||p.state==='closed',choices=vote?(vote.choices??[vote.option]):[];
          const options=p.options.map(o=>({id:o.id,label:o.label,...(o.image?{image:fileMeta(o.image)}:{}),...(manage||closed&&p.show_counts!==false?{votes:o.votes}:{}),...(closed&&p.show_percent!==false?{percent:p.total?Math.round(o.votes/p.total*100):0}:{})}));
          if(closed){const ranks=new Map([...p.options].sort((a,b)=>b.votes-a.votes).map((o,i,list)=>[o.id,list.findIndex(x=>x.votes===o.votes)+1]));options.sort((a,b)=>ranks.get(a.id)-ranks.get(b.id));options.forEach(o=>o.rank=ranks.get(o.id));}
          return {id:p.id,title:p.title,description:p.description,state:closed?'closed':'open',created_at:p.created_at,ends_at:p.ends_at,version:p.version??0,max_choices:p.max_choices??1,show_counts:p.show_counts!==false,show_percent:p.show_percent!==false,options,...(manage||closed&&p.show_counts!==false?{total:p.total}:{}),choices,...(choices.length?{choice:choices[0]}:{}),...(protection?{protection}:{})};
        }));polls.push(...group);}return respond({polls,hasMore:allRows.length>20,server_now:now()});
      }
      if(route==='polls'&&(method==='POST'||method==='PATCH')){
        await authorize(cookies);
        if(method==='PATCH'&&data.action==='delete'){
          if(!idOK(data.id)||!Number.isSafeInteger(data.version))fail(400,'无效投票。','Invalid poll.');
          await store.transaction(async tx=>{const a=await authorize(cookies,false,tx),old=await tx.get('polls',data.id);if(!old)fail(404,'投票不存在。','Poll unavailable.');if((old.version??0)!==data.version)fail(409,'投票已变更，请刷新后删除。','Poll changed.');await uploads.resolve([],old.options.map(o=>o.image).filter(Boolean),{tx,actor:a.id,kind:'poll',id:old.id});await tx.remove('polls',old.id);await tx.remove('activity',hash(old.id));await audit(tx,a,'poll.delete',old.id);});return respond({ok:true});
        }
        if(method==='POST'||data.action==='edit'){
          const opts=Array.isArray(data.options)?data.options.map(o=>typeof o==='string'?{label:o}:o):[],max=data.max_choices??1;
          if(!textOK(data.title,2,120)||!textOK(data.description,0,2000)||opts.length<2||opts.length>8||opts.some(o=>!o||!textOK(o.label,1,100))||new Set(opts.map(o=>o.label.trim().toLowerCase())).size!==opts.length||!Number.isInteger(max)||max<1||max>opts.length||!Number.isSafeInteger(data.ends_at)||data.ends_at<=now()||data.ends_at>now()+366*86400000)fail(400,'请检查投票题目、选项、最多选择数和截止时间。','Check question, options, selection limit and deadline.');
          if(method==='PATCH'&&(!idOK(data.id)||!Number.isSafeInteger(data.version)))fail(400,'无效投票。','Invalid poll.');
          const id=method==='POST'?randomUUID():data.id;await store.transaction(async tx=>{const a=await authorize(cookies,false,tx),old=method==='PATCH'?await tx.get('polls',id):null;
            if(method==='PATCH'&&(!old||old.state==='closed'||old.ends_at<=now()||old.total>0||(old.version??0)!==data.version))fail(409,'已有投票、已截止或内容已变更，不能再修改选项。','Poll has votes, is closed or changed. Options cannot be edited.');
            const images=await uploads.resolve(opts.filter(o=>o.image).map(o=>o.image),old?.options.map(o=>o.image).filter(Boolean),{tx,actor:a.id,kind:'poll',id});let imageIndex=0;
            if(images.some(f=>!f.type.startsWith('image/')))fail(400,'投票选项只能使用图片。','Poll options accept images only.');
            await tx.set('polls',id,{id,title:data.title.trim(),description:data.description.trim(),options:opts.map(o=>({id:old?.options.find(x=>x.id===o.id)?.id??randomUUID(),label:o.label.trim(),votes:0,...(o.image?{image:images[imageIndex++]}:{})})),max_choices:max,show_counts:data.show_counts!==false,show_percent:data.show_percent!==false,version:old?(old.version??0)+1:0,state:'open',created_at:old?.created_at??now(),ends_at:data.ends_at,total:0});await audit(tx,a,old?'poll.edit':'poll.create',id);});return respond({ok:true,id},method==='POST'?201:200);
        }
        if(!idOK(data.id)||data.action&&!['close','settings'].includes(data.action))fail(400,'无效投票。','Invalid poll.');await store.transaction(async tx=>{const a=await authorize(cookies,false,tx),p=await tx.get('polls',data.id);if(!p)fail(404,'投票不存在。','Poll not found.');if(data.action==='settings'&&(typeof data.show_counts!=='boolean'||typeof data.show_percent!=='boolean'))fail(400,'无效展示设置。','Invalid result settings.');await tx.set('polls',p.id,{...p,version:(p.version??0)+1,...(data.action==='settings'?{show_counts:data.show_counts,show_percent:data.show_percent}:{state:'closed'})});await audit(tx,a,data.action==='settings'?'poll.settings':'poll.close',p.id);});return respond({ok:true});
      }
      if((route==='ballot'&&method==='POST')||(route==='polls'&&method==='PUT')){
        if(!idOK(data.id))fail(400,'无效投票。','Invalid poll.');
        const voter=cookies[voterName];if(!/^[a-f0-9]{64}$/.test(voter??''))fail(400,'请刷新投票页面后重试。','Refresh the poll page and try again.');
        const phase=route==='ballot'?'ticket':'vote';await guard(data.id,voter,phase,await networkKey(event));
        const id=hash(data.id+':'+voter),raw=token();
        const result=await store.transaction(async tx=>{
          const p=await tx.get('polls',data.id),vote=await tx.get('votes',id),t=await tx.get('tickets',id);
          let error;
          if(!p||p.state!=='open'||p.ends_at<=now())error=['投票已结束或不存在。','Poll closed or unavailable.'];
          else if(vote)error=['此浏览器已投过票。','This browser has already voted.'];
          const choices=Array.isArray(data.choices)?data.choices:data.option?[data.option]:[];
          if(!error&&phase==='vote'&&(!/^[a-f0-9]{64}$/.test(data.ticket??'')||!t||t.expires_at<=now()||t.token_hash!==hash(data.ticket)||choices.length<1||choices.length>(p.max_choices??1)||new Set(choices).size!==choices.length||choices.some(choice=>!p.options.some(o=>o.id===choice))))error=['投票凭证或选项无效，请检查最多可选数量后重试。','Invalid ballot or selection. Check the selection limit.'];
          if(error){await activity(tx,data.id,'blocked');return {error};}
          if(phase==='ticket'){await tx.set('tickets',id,{poll_id:p.id,token_hash:hash(raw),expires_at:now()+300000,expiresAt:new Date(now()+300000),created_at:now()});return {ticket:raw,expiresIn:300};}
          await tx.set('votes',id,{poll_id:p.id,option:choices[0],choices,created_at:now()});
          await tx.set('polls',p.id,{...p,total:p.total+1,options:p.options.map(o=>choices.includes(o.id)?{...o,votes:o.votes+1}:o)});
          await tx.remove('tickets',id);await activity(tx,p.id,'accepted');return {ok:true};
        });if(result.error)fail(409,...result.error);return respond(result);
      }
      fail(404,'接口不存在。','Endpoint not found.');
    } catch(error) {
      if(error instanceof HttpError){if(error.extra.retryAfter)headers['Retry-After']=String(error.extra.retryAfter);const {retryAfter,...extra}=error.extra;return respond({error:error.message,...extra},error.status);}
      // Never log bodies, passwords, receipts or database documents.
      console.error('bridge_request_failed',String(error.code??error.name??'Error').slice(0,80));
      return respond({error:'服务暂时不可用，请稍后重试；提交来信时请保留查询码。 / Service unavailable. Retry later; retain your letter receipt.'},503);
    }
  };
}
module.exports={createApp,hashPassword,hash,verifyPassword};
