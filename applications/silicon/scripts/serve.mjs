import http from 'node:http';
import fs from 'node:fs/promises';
import { realpath as resolveRealPath } from 'node:fs';
import { promisify } from 'node:util';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { build } from './build.mjs';
import { VERSION } from '../src/version.js';
const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
// Node's legacy resolver still checks each link and works on Windows filesystems
// that refuse the native realpath operation used by fs.promises.realpath.
const realpath=promisify(resolveRealPath);
const CSP="default-src 'none'; script-src 'self'; worker-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src 'none'; frame-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'; object-src 'none'";
const MIME={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8','.svg':'image/svg+xml'};
const MAX_FILE_BYTES=2*1024*1024;
// Reject Windows aliases and alternate data streams on every host, so a release
// has the same file boundary on Windows and POSIX.
function invalidSegment(segment){
  return !segment || segment.startsWith('.') || /[<>:"|?*]|[.\s]$/.test(segment) || /^(?:con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])(?:\.|$)/i.test(segment);
}
export function parseServerArgs(args){
  let port=8788,open=false,seenPort=false,websocket=false;
  for(let i=0;i<args.length;i++){
    const arg=args[i];
    if(arg==='--open' && !open){open=true;continue;}
    if(arg==='--websocket' && !websocket){websocket=true;continue;}
    if(arg==='--port' && !seenPort){
      seenPort=true;const value=args[++i];
      if(!/^\d+$/.test(value ?? ''))throw new Error('port must be 1024..65535');
      port=Number(value);if(!Number.isInteger(port) || port<1024 || port>65535)throw new Error('port must be 1024..65535');
      continue;
    }
    throw new Error('usage: node scripts/serve.mjs [--open] [--port NUMBER] [--websocket]');
  }
  return {port,open,...(websocket?{websocket:true}:{})};
}
async function readBounded(file){
  const handle=await fs.open(file,'r');
  try{
    const stat=await handle.stat();
    if(!stat.isFile() || stat.size>MAX_FILE_BYTES)return null;
    // The extra byte detects growth after stat without letting readFile allocate
    // an unbounded buffer for a changing local file.
    const buffer=Buffer.alloc(stat.size+1);let length=0;
    while(length<buffer.length){const {bytesRead}=await handle.read(buffer,length,buffer.length-length,null);if(!bytesRead)break;length+=bytesRead;}
    if(length!==stat.size)return null;
    return buffer.subarray(0,length);
  }finally{await handle.close();}
}
export async function createServer({port=8788,root=path.join(ROOT,'dist'),websocket=false}={}){
  if(!Number.isInteger(port) || port<0 || port>65535)throw new Error('invalid port');
  if(typeof websocket!=='boolean')throw new Error('websocket must be a boolean');
  root=await realpath(root);
  let gateway=null;
  const server=http.createServer({maxHeaderSize:8192,requestTimeout:10000,headersTimeout:10000,keepAliveTimeout:5000},async(req,res)=>{
    const actualPort=server.address().port,origin=`http://127.0.0.1:${actualPort}`;
    const socketOrigin=`ws://127.0.0.1:${actualPort}`;
    const servedCsp=websocket?CSP.replace("connect-src 'none'",`connect-src ${origin} ${socketOrigin}`):CSP;
    const headers={'Content-Security-Policy':servedCsp,'X-Content-Type-Options':'nosniff','X-Frame-Options':'DENY','Referrer-Policy':'no-referrer','Cross-Origin-Resource-Policy':'same-origin','Cross-Origin-Opener-Policy':'same-origin','Permissions-Policy':'camera=(), microphone=(), geolocation=(), payment=(), usb=(), serial=(), bluetooth=()','Cache-Control':'no-store'};
    const end=(code,text)=>{res.writeHead(code,{...headers,'Content-Type':'text/plain; charset=utf-8'});res.end(req.method==='HEAD'?'':text);};
    if(req.headers.host!==`127.0.0.1:${actualPort}` && req.headers.host!==`localhost:${actualPort}`){end(403,'Host rejected');return;}
    if(req.headers.origin && ![origin,`http://localhost:${actualPort}`].includes(req.headers.origin)){end(403,'Origin rejected');return;}
    if(req.headers['sec-fetch-site']==='cross-site'){end(403,'Cross-site request rejected');return;}
    if(gateway?.handleHttp(req,res))return;
    if(!['GET','HEAD'].includes(req.method)){end(405,'GET and HEAD only');return;}
    try{
      const raw=req.url?.split('?')[0] || '/';
      if(raw.length>2048 || !raw.startsWith('/') || raw.startsWith('//')){end(400,'Invalid path');return;}
      const decoded=decodeURIComponent(raw);
      if(/[\\\x00-\x1f\x7f]/.test(decoded) || decoded.includes('%') || (decoded!=='/' && decoded.slice(1).split('/').some(invalidSegment))){end(400,'Invalid path');return;}
      const relative=decoded==='/'?'index.html':decoded.slice(1),file=path.resolve(root,relative);
      if(!file.startsWith(root+path.sep)){end(403,'Path rejected');return;}
      const real=await realpath(file);
      if(real!==file || !real.startsWith(root+path.sep)){end(403,'Symlink rejected');return;}
      const st=await fs.stat(real),type=MIME[path.extname(real)];
      if(!st.isFile() || !type || st.size>MAX_FILE_BYTES){end(404,'Not found');return;}
      if(req.method==='HEAD'&&(!websocket||path.extname(real)!=='.html')){res.writeHead(200,{...headers,'Content-Type':type,'Content-Length':st.size});res.end();return;}
      let data=await readBounded(real);if(!data){end(404,'Not found');return;}
      if(websocket&&path.extname(real)==='.html')data=Buffer.from(data.toString('utf8').replaceAll("connect-src 'none'",`connect-src ${origin} ${socketOrigin}`),'utf8');
      res.writeHead(200,{...headers,'Content-Type':type,'Content-Length':data.length});res.end(req.method==='HEAD'?'':data);
    }catch(error){end(['ENOENT','ENOTDIR'].includes(error.code)?404:400,'Not found or invalid request');}
  });
  if(websocket){
    const {createRamWsGateway}=await import('./ramws/ramws-gateway.mjs');
    const {createAdminGateway}=await import('./ramws/admin-gateway.mjs');
    const admin=createAdminGateway({packageRoot:path.resolve(ROOT,'../..')});
    gateway=createRamWsGateway({server,admin,host:'127.0.0.1',origin:()=>`http://127.0.0.1:${server.address().port}`});
    server.ramws=gateway;
    const close=server.close.bind(server);
    server.close=function(callback){gateway.close();return close(callback);};
  }
  server.maxConnections=64;server.maxRequestsPerSocket=100;
  server.on('clientError',(_,socket)=>{socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n');});
  try{await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',()=>{server.off('error',reject);resolve();});});}catch(error){gateway?.close();throw error;}return server;
}
async function main(){
  const version=process.versions.node.split('.').map(Number);if(version[0]<22 || (version[0]===22 && version[1]<12))throw new Error('Node.js 22.12 or newer is required; a supported LTS release is recommended');
  const {port,open,websocket=false}=parseServerArgs(process.argv.slice(2));
  await build();const server=await createServer({port,websocket});const url=`http://127.0.0.1:${server.address().port}/`;
  const mode=websocket?'Local WebSocket relay enabled. Connect the browser XPU owner in the console, then open terminal.html.':'Local static host only. No network WebSocket or host shell.';
  console.log(`JA21 Silicon Console ${VERSION}\n${url}\n${mode}\nPress Ctrl+C to stop. Changing the port creates a different browser-storage origin.`);
  if(open){const exe=process.platform==='win32'?path.join(process.env.SystemRoot || 'C:\\Windows','System32','rundll32.exe'):process.platform==='darwin'?'/usr/bin/open':'xdg-open';const parameters=process.platform==='win32'?['url.dll,FileProtocolHandler',url]:[url];const child=spawn(exe,parameters,{stdio:'ignore',detached:true,shell:false,windowsHide:true});child.on('error',()=>console.log('Open the displayed address in your browser.'));child.unref();}
  const stop=()=>{server.close(()=>process.exit(0));server.closeAllConnections();};process.once('SIGINT',stop);process.once('SIGTERM',stop);
}
if(process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(error=>{console.error('START FAILED:',error.message);if(error.code==='EADDRINUSE')console.error('Port already in use. Close the existing instance or choose --port 8791 (separate browser storage).');process.exitCode=1;});
