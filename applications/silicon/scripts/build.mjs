import fs from 'node:fs/promises';
import { realpath as resolveRealPath } from 'node:fs';
import { promisify } from 'node:util';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { VERSION } from '../src/version.js';
const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const realpath=promisify(resolveRealPath);
async function assertPlainTree(file){
  const stat=await fs.lstat(file);
  if(stat.isSymbolicLink() || (!stat.isFile() && !stat.isDirectory()))throw new Error(`Build refuses linked or special input: ${file}`);
  if(stat.isDirectory())for(const entry of await fs.readdir(file))await assertPlainTree(path.join(file,entry));
}
async function removeOwnedStage(stageRoot,root){
  if(path.dirname(stageRoot)!==root || !path.basename(stageRoot).startsWith('.dist-stage-') || await realpath(stageRoot)!==stageRoot)throw new Error('Build refuses cleanup outside its owned staging directory');
  await assertPlainTree(stageRoot);
  await fs.rm(stageRoot,{recursive:true,force:true});
}
export async function build({root=ROOT,rename=fs.rename}={}){
  if(typeof rename!=='function')throw new TypeError('rename must be a function');
  root=await realpath(root);
  const dist=path.join(root,'dist');
  await assertPlainTree(path.join(root,'web'));await assertPlainTree(path.join(root,'src'));
  try{const current=await fs.lstat(dist);if(!current.isDirectory() || current.isSymbolicLink())throw new Error('Build refuses linked or non-directory dist');await assertPlainTree(dist);}catch(error){if(error.code!=='ENOENT')throw error;}
  // Prepare completely before replacing the last good distribution.
  const stageRoot=await fs.mkdtemp(path.join(root,'.dist-stage-')),stage=path.join(stageRoot,'dist'),backup=path.join(stageRoot,'previous-dist');
  let movedOld=false,keepBackup=false;
  try{
    await fs.cp(path.join(root,'web'),stage,{recursive:true,errorOnExist:true,force:false});
    await fs.cp(path.join(root,'src'),path.join(stage,'src'),{recursive:true,errorOnExist:true,force:false,filter:p=>!p.endsWith('regex-worker-node.js')});
    await fs.writeFile(path.join(stage,'release.json'),JSON.stringify({version:VERSION,profile:'LOCAL_BROWSER',runtimeDependencies:0},null,2)+'\n');
    // Both publication paths live below the same resolved root. Move the old
    // distribution aside before publishing, rather than destroying it first.
    if(await realpath(stageRoot)!==stageRoot)throw new Error('Build staging directory became linked');
    try{await rename(dist,backup);movedOld=true;}catch(error){if(error.code!=='ENOENT')throw error;}
    try{await rename(stage,dist);}catch(publicationError){
      if(movedOld){
        try{await rename(backup,dist);}catch(rollbackError){
          keepBackup=true;
          const error=new AggregateError([publicationError,rollbackError],`Build publication and rollback failed; previous distribution retained at ${backup}`,{cause:publicationError});
          error.recoveryPath=backup;throw error;
        }
      }
      throw publicationError;
    }
  }finally{if(!keepBackup)await removeOwnedStage(stageRoot,root);}
  console.log(`Built JA21 ${VERSION}: static, no third-party runtime packages.`);return dist;
}
if(process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url))await build();
