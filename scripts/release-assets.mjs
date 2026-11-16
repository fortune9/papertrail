import {promises as fs,createReadStream} from 'node:fs';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
const exec=promisify(execFile);
import {parseVersion,readVersion} from './release-version.mjs';

const assetSuffix=/\.(deb|rpm|AppImage|dmg|pkg|exe|msi|zip|tar\.gz|tar\.xz)$/;
function validName(name,version){
  const escaped=version.replaceAll('.','\\.');
  return typeof name==='string' && /^[A-Za-z0-9][A-Za-z0-9._+-]*$/.test(name) && assetSuffix.test(name) && new RegExp(`(^|[^A-Za-z0-9])${escaped}([^A-Za-z0-9]|$)`).test(name);
}
function validateContext(version,commit){parseVersion(version);if(!/^[0-9a-f]{40}$|^[0-9a-f]{64}$/i.test(commit || ''))throw new Error('A full source commit SHA is required for release assets.');}
export async function digest(filename){const hash=createHash('sha256');for await(const chunk of createReadStream(filename))hash.update(chunk);return hash.digest('hex');}
async function cleanDestination(source,destination){
  const from=path.resolve(source),to=path.resolve(destination);
  if(from===to || to.startsWith(from+path.sep) || from.startsWith(to.endsWith(path.sep)?to:to+path.sep))throw new Error('Asset source and destination must be separate directories.');
  await fs.rm(to,{recursive:true,force:true});await fs.mkdir(to,{recursive:true});return to;
}
export async function stageAssets({source,destination,version,commit,target}){
  validateContext(version,commit);if(!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(target || ''))throw new Error('Invalid build target.');
  const entries=await fs.readdir(source,{withFileTypes:true}),files=[];
  for(const item of entries)if(validName(item.name,version)){
    if(!item.isFile())throw new Error('Release assets must be regular files.');
    const filename=path.join(source,item.name),stat=await fs.stat(filename);
    if(!stat.size)throw new Error('Release assets cannot be empty.');
    files.push({name:item.name,size:stat.size,sha256:await digest(filename)});
  }
  if(!files.length)throw new Error('No versioned release assets were produced.');
  files.sort((a,b)=>a.name.localeCompare(b.name));
  const output=await cleanDestination(source,destination);
  for(const file of files)await fs.copyFile(path.join(source,file.name),path.join(output,file.name));
  await fs.writeFile(path.join(output,`build-${target}.json`),JSON.stringify({version,commit,target,files},null,2)+'\n');
  await fs.writeFile(path.join(output,`SHA256SUMS-${target}`),files.map(file=>`${file.sha256}  ${file.name}\n`).join(''));
  return files;
}
async function manifests(directory){
  const found=[];
  for(const entry of await fs.readdir(directory,{withFileTypes:true})){
    const filename=path.join(directory,entry.name);
    if(entry.isSymbolicLink())throw new Error('Artifact bundles must not contain symlinks.');
    if(entry.isDirectory())found.push(...await manifests(filename));
    else if(/^build-[a-z0-9-]+\.json$/.test(entry.name))found.push(filename);
  }
  return found;
}
export async function collectAssets({source,destination,version,commit}){
  validateContext(version,commit);const names=new Set(),targets=new Set(),assets=[],metadata=[];
  for(const filename of await manifests(source)){
    const manifest=JSON.parse(await fs.readFile(filename,'utf8'));
    if(manifest.version!==version || manifest.commit!==commit)throw new Error('Build artifact version/source commit does not match this release.');
    if(!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(manifest.target || '') || path.basename(filename)!==`build-${manifest.target}.json` || targets.has(manifest.target))throw new Error('Invalid or duplicate artifact target.');
    targets.add(manifest.target);
    if(!Array.isArray(manifest.files) || !manifest.files.length)throw new Error('Empty build manifest.');
    for(const file of manifest.files){
      if(!validName(file.name,version) || names.has(file.name))throw new Error('Invalid or duplicate release asset filename.');
      const asset=path.join(path.dirname(filename),file.name),stat=await fs.lstat(asset);
      if(!stat.isFile() || stat.size!==file.size || await digest(asset)!==file.sha256)throw new Error('Release artifact checksum/size verification failed.');
      names.add(file.name);assets.push({source:asset,name:file.name});
    }
    metadata.push({source:filename,name:path.basename(filename)});
  }
  if(!assets.length)throw new Error('No verified build artifacts found.');
  const output=await cleanDestination(source,destination);
  const all=[...assets,...metadata].sort((a,b)=>a.name.localeCompare(b.name)),checksums=[];
  for(const file of all){await fs.copyFile(file.source,path.join(output,file.name));checksums.push(`${await digest(path.join(output,file.name))}  ${file.name}\n`);}
  await fs.writeFile(path.join(output,'SHA256SUMS'),checksums.join(''));return all.map(file=>file.name).concat('SHA256SUMS');
}
if(process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const [command,target]=process.argv.slice(2),{version}=await readVersion();
  const commit=process.env.GITHUB_SHA || (await exec('git',['rev-parse','HEAD'],{timeout:15000})).stdout.trim();
  if(command==='stage')console.log(await stageAssets({source:'dist',destination:'release-assets',version,commit,target}));
  else if(command==='collect')console.log(await collectAssets({source:'incoming',destination:'release-assets',version,commit}));
  else throw new Error('Usage: release-assets.mjs stage <target> | collect');
}
