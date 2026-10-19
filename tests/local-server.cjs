// Development integration server only; excluded from both deployment ZIPs.
const http=require('node:http');const fs=require('node:fs');const path=require('node:path');
const {createApp,hashPassword}=require('../backend/core');const {openStore}=require('./pg-test-store.cjs');
(async()=>{
 const port=Number(process.env.BRIDGE_TEST_PORT||4178),root=path.resolve(__dirname,'../dist/frontend');
 const store=await openStore(process.env.BRIDGE_TEST_DATA_DIR||path.resolve(__dirname,'../.local-pgdata'));
 const handle=createApp({store,config:{PUBLIC_ORIGIN:`http://127.0.0.1:${port}`,OWNER_BOOTSTRAP_PASSWORD_HASH:await hashPassword('Local-QA-only-password-2026!')}});
 const server=http.createServer(async(req,res)=>{
  const url=new URL(req.url,`http://127.0.0.1:${port}`);
  if(url.pathname==='/bridge-api'){
   const chunks=[];let size=0;for await(const chunk of req){chunks.push(chunk);size+=chunk.length;if(size>4*1024*1024){res.writeHead(413);res.end();return;}}
   const binary=req.headers['content-type']==='application/octet-stream',buffer=Buffer.concat(chunks);const r=await handle({httpMethod:req.method,headers:req.headers,queryStringParameters:Object.fromEntries(url.searchParams),body:buffer.toString(binary?'base64':'utf8'),isBase64Encoded:binary});res.writeHead(r.statusCode,r.headers);res.end(r.isBase64Encoded?Buffer.from(r.body,'base64'):r.body);return;
  }
  if(url.pathname.includes('/assets/')){const leaf=path.basename(url.pathname),file=path.join(root,'assets',leaf);if(!fs.existsSync(file)||!['.woff2','.txt'].includes(path.extname(leaf))){res.writeHead(404);res.end();return;}res.writeHead(200,{'Content-Type':leaf.endsWith('.woff2')?'font/woff2':'text/plain; charset=utf-8'});res.end(fs.readFileSync(file));return;}
  const leaf=url.pathname.endsWith('/')?'index.html':path.basename(url.pathname);
  if(!['index.html','thebridge.idhs.html','bridge-config.js'].includes(leaf)){res.writeHead(404);res.end();return;}
  res.writeHead(200,{'Content-Type':leaf.endsWith('.js')?'text/javascript; charset=utf-8':'text/html; charset=utf-8','Cache-Control':'no-store'});res.end(fs.readFileSync(path.join(root,leaf)));
 });
 server.listen(port,'127.0.0.1',()=>console.log(`Local integration: http://127.0.0.1:${port}/idhs/`));
 process.on('SIGINT',()=>server.close(async()=>{await store.close();process.exit(0);}));
})();
