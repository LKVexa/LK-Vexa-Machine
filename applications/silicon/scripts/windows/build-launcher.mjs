/** Rebuild the readable, standalone Windows launcher; Node core only. */
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const header=await fs.readFile(new URL('./launcher-header.txt',import.meta.url),'utf8');
const payload=await fs.readFile(new URL('./bootstrap.ps1',import.meta.url),'utf8');
const text=(header.trimEnd()+'\n#==JA21_POWERSHELL_PAYLOAD==\n'+payload).replace(/\r?\n/g,'\r\n');
const output=new URL('../../Start-Console.cmd',import.meta.url);
await fs.writeFile(output,text,'utf8');
console.log(`Wrote ${fileURLToPath(output)}`);
