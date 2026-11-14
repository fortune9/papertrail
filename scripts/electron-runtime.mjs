import { promises as fs, createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const exec=promisify(execFile);
export const root=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const spec=JSON.parse(await fs.readFile(path.join(root,'desktop','runtime.json'),'utf8'));
export async function verifyArchive(filename){
  const hash=createHash('sha256');for await(const chunk of createReadStream(filename))hash.update(chunk);
  if(hash.digest('hex')!==spec.linuxX64Sha256)throw new Error('Electron archive checksum does not match the pinned release.');
}
export async function electronRuntime(){
  if(process.platform!=='linux' || process.arch!=='x64')throw new Error('Only Linux x64 desktop builds are implemented.');
  const cache=path.join(root,'.build');await fs.mkdir(cache,{recursive:true});
  const archive=process.env.ELECTRON_ARCHIVE || path.join(cache,`electron-v${spec.electronVersion}-linux-x64.zip`);
  try{await fs.access(archive);}catch{
    if(process.env.ELECTRON_ARCHIVE)throw new Error('ELECTRON_ARCHIVE does not exist.');
    console.log(`Downloading pinned Electron ${spec.electronVersion}…`);
    const response=await fetch(`https://github.com/electron/electron/releases/download/v${spec.electronVersion}/electron-v${spec.electronVersion}-linux-x64.zip`);
    if(!response.ok)throw new Error(`Electron download failed: ${response.status}`);
    const handle=await fs.open(archive+'.tmp','w');
    try{for await(const chunk of response.body)await handle.write(chunk);}finally{await handle.close();}
    await fs.rename(archive+'.tmp',archive);
  }
  await verifyArchive(archive);
  const directory=path.join(cache,`electron-${spec.electronVersion}`);
  try{await fs.access(path.join(directory,'electron'));}catch{
    await fs.mkdir(directory,{recursive:true});
    await exec('unzip',['-q',archive,'-d',directory],{timeout:60000});
  }
  return directory;
}
