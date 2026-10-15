import fs from 'node:fs/promises';import path from 'node:path';import { fileURLToPath } from 'node:url';import { spawnSync } from 'node:child_process';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const names=(await fs.readdir(path.join(root,'tests'))).filter(n=>n.endsWith('.test.mjs')).sort();
const r=spawnSync(process.execPath,['--test','--test-reporter=tap','--test-concurrency=1',...names.map(n=>path.join(root,'tests',n))],{cwd:root,encoding:'utf8',maxBuffer:32*1024*1024,timeout:120000,windowsHide:true});
await fs.mkdir(path.join(root,'audit'),{recursive:true});await fs.writeFile(path.join(root,'audit','TEST_RESULTS.tap'),(r.stdout || '')+(r.stderr || ''));process.stdout.write(r.stdout || '');process.stderr.write(r.stderr || '');if(r.error)console.error(r.error.message);process.exitCode=r.status ?? 1;
