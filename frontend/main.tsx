import React,{useEffect,useState} from 'react';
import {createRoot} from 'react-dom/client';
import Home from './app/page';
import Voice from './app/voice/page';
import {NoticesPage,PollsPage} from './app/components/campus-pages';
import StaffPortal from './app/staff/portal';

declare global {interface Window {BRIDGE_CONFIG?:{apiBase?:string}}}
const nativeFetch=window.fetch.bind(window);
// Transport only: every response comes from the server; no demo records or fake accounts.
window.fetch=async(input,init)=>{
  const source=new URL(typeof input==='string'?input:input instanceof URL?input.href:input.url,location.href);
  if(source.origin!==location.origin||!source.pathname.startsWith('/api/'))return nativeFetch(input,init);
  if(location.protocol==='file:')return Response.json({error:'请通过已配置后台的 HTTPS 网站访问。 / Open the HTTPS website with its backend configured.'},{status:503});
  const target=new URL(window.BRIDGE_CONFIG?.apiBase??'/bridge-api',location.origin);
  if(target.origin!==location.origin)return Response.json({error:'请通过已配置后台的 HTTPS 网站访问。 / Open the HTTPS website with its backend configured.'},{status:503});
  target.search=source.search;target.searchParams.set('route',source.pathname.slice(5));
  const response=await nativeFetch(target,{...init,credentials:'same-origin',cache:'no-store'});
  if(!response.headers.get('content-type')?.includes('application/json'))return Response.json({error:'后台暂未连接，请联系网站维护者。 / The backend is not connected. Contact the site maintainer.'},{status:503});
  return response;
};
function App(){
 const [route,setRoute]=useState(location.hash.slice(1)||'/');
 useEffect(()=>{const change=()=>setRoute(location.hash.slice(1)||'/');window.addEventListener('hashchange',change);return()=>window.removeEventListener('hashchange',change);},[]);
 const [routePath,anchor]=route.split('#');const path=routePath.split('?')[0];
 useEffect(()=>{requestAnimationFrame(()=>{if(anchor)document.getElementById(anchor)?.scrollIntoView();else scrollTo({top:0,behavior:'instant'});});},[route]);
 function navigate(e:React.MouseEvent){const a=(e.target as HTMLElement).closest('a');if(!a||e.ctrlKey||e.metaKey||e.shiftKey||e.altKey)return;const href=a.getAttribute('href')??'';if(href.startsWith('/')||href.startsWith('#')){e.preventDefault();const next=href.startsWith('#')?path+href:href;if(route===next)scrollTo({top:0,behavior:'instant'});else{location.hash=next;setRoute(next);}}}
 return <div onClick={navigate}><a className="skip-link" href="#main">跳到主要内容</a><div key={routePath}>{path==='/voice'?<Voice/>:path==='/signal'?<NoticesPage/>:path==='/common-ground'?<PollsPage/>:path==='/staff'||path==='/staff/setup'?<StaffPortal/>:<Home/>}</div></div>;
}
createRoot(document.getElementById('root')!).render(<App/>);
