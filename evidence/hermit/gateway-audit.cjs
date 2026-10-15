'use strict';
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const base = __dirname;
const snapshot = JSON.parse(fs.readFileSync(path.join(base, 'GATEWAY_AUDIT_SOURCES.json'), 'utf8'));
const cache = new Map();
function sourceRequire(name) {
  if (name.startsWith('node:')) return require(name);
  const key = name.endsWith('.js') ? name : name + '.js';
  if (cache.has(key)) return cache.get(key).exports;
  const mod = { exports: {} }; cache.set(key, mod);
  const local = (specifier) => specifier.startsWith('node:') ? require(specifier) : sourceRequire(path.posix.normalize(path.posix.join(path.posix.dirname(key), specifier)));
  vm.runInThisContext('(function(require,module,exports,__filename,__dirname){' + snapshot[key] + '\n})', {filename:key})(local,mod,mod.exports,path.join(base,key),path.join(base,path.posix.dirname(key)));
  return mod.exports;
}
const cfg = sourceRequire('gateway/config');
const origin = sourceRequire('gateway/origin');
const { createIdentity } = sourceRequire('gateway/auth');
const { createTickets } = sourceRequire('gateway/tickets');
const { WsConnection, checkUpgrade } = sourceRequire('gateway/ws');
const rows = [];
function check(name, fn, expectedIssue=false) { try { fn(); rows.push({name,status:expectedIssue?'ISSUE_REPRODUCED':'PASS'}); } catch(e) { rows.push({name,status:'FAIL',reason:e.message}); process.exitCode=1; } }
const baseEnv={VWS_PRINCIPALS_FILE:path.join(base,'fixture-principals.json')};
check('Strict port syntax and ranges',()=>{for(const p of ['0','65536','80x',' 80','-1','1e3','0x50','080']) assert.throws(()=>cfg.load({...baseEnv,PORT:p})); assert.equal(cfg.load(baseEnv).port,10000);});
check('No unauthenticated bind on non-loopback',()=>assert.throws(()=>cfg.load({VWS_AUTH:'none-loopback-dev',VWS_HOST:'0.0.0.0'}),/loopback/));
check('Unsupported profile refused',()=>assert.throws(()=>cfg.load({...baseEnv,VWS_PROFILE:'DURABLE_HYBRID'}),/not implemented/));
check('Shipped launcher snapshots are rejected by config',()=>assert.throws(()=>cfg.load({...baseEnv,VWS_HOST:'127.0.0.1',VWS_SNAPSHOTS:'1',VWS_SNAPSHOT_DIR:'owned-snapshots'}),/LOCAL_VOLATILE/),true);
check('Configuration public allowlist excludes paths',()=>{const pub=cfg.publicConfig(cfg.load(baseEnv));assert.ok(!JSON.stringify(pub).includes('fixture-principals'));assert.equal(pub.protocol,'hermit.vws.v2');});
const loCfg=cfg.load({VWS_AUTH:'none-loopback-dev',VWS_HOST:'127.0.0.1',VWS_ALLOW_NO_ORIGIN:'0'});
const req=(host,org)=>({headers:{host,...(org===undefined?{}:{origin:org})},socket:{}});
check('Loopback Host rebinding rejected',()=>assert.equal(origin.checkWsOrigin(req('rebinding.example:10000','http://rebinding.example:10000'),loCfg).ok,false));
check('Foreign and opaque Origin rejected',()=>{for(const o of ['null','https://evil.example','http://127.0.0.1:10000.evil.example'])assert.equal(origin.checkWsOrigin(req('127.0.0.1:10000',o),loCfg).ok,false);});
check('Exact gateway origin accepted and missing origin policy applied',()=>{assert.equal(origin.checkWsOrigin(req('127.0.0.1:10000','http://127.0.0.1:10000'),loCfg).ok,true);assert.equal(origin.checkWsOrigin(req('127.0.0.1:10000'),loCfg).ok,false);});
check('Ticket single use and origin mismatch burns ticket',()=>{const ts=createTickets();const p={sub:'audit'};const t=ts.issue(p,'http://127.0.0.1:10000');assert.equal(ts.consume(t,'https://evil.example'),null);assert.equal(ts.consume(t,'http://127.0.0.1:10000'),null);const good=ts.issue(p,null);assert.equal(ts.consume(good,null),p);assert.equal(ts.consume(good,null),null);});
check('Handshake version, key, method, and protocol checks',()=>{const r={method:'GET',headers:{upgrade:'websocket',connection:'keep-alive, Upgrade','sec-websocket-version':'13','sec-websocket-key':'A'.repeat(22)+'==','sec-websocket-protocol':'hermit.vws.v2'}};assert.equal(checkUpgrade(r,'hermit.vws.v2').ok,true);for(const change of [{method:'POST'},{headers:{...r.headers,'sec-websocket-version':'12'}},{headers:{...r.headers,'sec-websocket-key':'bad'}},{headers:{...r.headers,'sec-websocket-protocol':'other'}}])assert.equal(checkUpgrade({...r,...change},'hermit.vws.v2').ok,false);});
class FakeSocket extends EventEmitter {constructor(){super();this.destroyed=false;this.writes=[];}setNoDelay(){}cork(){}uncork(){}write(b,cb){this.writes.push(Buffer.from(b));if(cb)cb(null);return true;}destroy(){this.destroyed=true;}end(cb){if(typeof cb==='function')cb();}}
function clientFrame(op,payload,fin=true,mask=true){payload=Buffer.from(payload);const n=payload.length;const h=Buffer.alloc(n<126?6:8);h[0]=(fin?128:0)|op;if(n<126){h[1]=(mask?128:0)|n;h.set([1,2,3,4],2);}else{h[1]=(mask?128:0)|126;h.writeUInt16BE(n,2);h.set([1,2,3,4],4);}const p=Buffer.from(payload);if(mask)for(let i=0;i<p.length;i++)p[i]^=[1,2,3,4][i&3];return Buffer.concat([h,p]);}
check('Every TCP split position retains the exact frame',()=>{const raw=clientFrame(1,'payload-é');for(let split=1;split<raw.length;split++){const so=new FakeSocket(),ws=new WsConnection(so);let got=null;ws.on('text',b=>got=Buffer.from(b));ws._onData(Buffer.from(raw.subarray(0,split)));ws._onData(Buffer.from(raw.subarray(split)));assert.equal(got.toString(),'payload-é');ws.terminate();}});
check('Fragmented UTF-8 round trip',()=>{const so=new FakeSocket(),ws=new WsConnection(so);let got;ws.on('text',b=>got=Buffer.from(b));ws._onData(clientFrame(1,[0xc3],false));ws._onData(clientFrame(0,[0xa9],true));assert.equal(got.toString(),'é');ws.terminate();});
check('Receive protocol rejects unmasked, invalid UTF-8, and control oversize',()=>{for(const [frame,code]of [[clientFrame(1,'x',true,false),1002],[clientFrame(1,[255]),1007],[clientFrame(9,Buffer.alloc(126)),1002]]){const so=new FakeSocket(),ws=new WsConnection(so);ws._onData(frame);assert.equal(ws.failInfo.code,code);ws.terminate();}});
check('Non-ASCII outgoing close reason can exceed RFC control-frame maximum',()=>{const so=new FakeSocket(),ws=new WsConnection(so);ws.close(1000,'é'.repeat(100));assert.ok(so.writes[0][1]===126);assert.equal(so.writes[1].length,202);ws.terminate();},true);
check('Credential revocation bypass with another live token for the same principal',()=>{const f=baseEnv.VWS_PRINCIPALS_FILE;const tokenA='A'.repeat(43),tokenB='B'.repeat(43);const mk=t=>({sub:'same-user',tenant:'local',tokenSha256:crypto.createHash('sha256').update(t).digest('hex'),capabilities:['terminal']});const first=[mk(tokenA),mk(tokenB)];fs.writeFileSync(f,JSON.stringify(first));const identity=createIdentity({auth:'static-file',principalsFile:f},{info(){},error(){}});const a=identity.authenticate(tokenA);assert.ok(a);first[0].revoked=true;fs.writeFileSync(f,JSON.stringify(first));const now=new Date(Date.now()+5000);fs.utimesSync(f,now,now);assert.equal(identity.authenticate(tokenA),null);assert.equal(identity.stillValid(a),true);},true);
const result={schema:'ja21.hermit.gateway-audit.v1',source:'D:/downloads/hermit-ramws_2.0.0-ramws.1(3).zip',node:process.version,mode:'Stock source snapshot, pure tests and owned fixture; no listener, dependency install, deployment, or host commands',rows};
fs.writeFileSync(path.join(base,'GATEWAY_AUDIT_TESTS.json'),JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify(result,null,2));
