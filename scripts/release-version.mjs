import {promises as fs} from 'node:fs';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
const exec=promisify(execFile);
import {fileURLToPath} from 'node:url';

export function parseVersion(version){
  if(typeof version!=='string' || !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version))throw new Error('Use a stable major.minor.patch version without leading zeros.');
  const parts=version.split('.').map(Number);if(parts.some(part=>!Number.isSafeInteger(part)))throw new Error('Version component is too large.');return parts;
}
export function compareVersions(left,right){
  const a=parseVersion(left),b=parseVersion(right);for(let i=0;i<3;i++)if(a[i]!==b[i])return a[i]>b[i]?1:-1;return 0;
}
export function nextVersion(version,level){
  const parts=parseVersion(version),index=['major','minor','patch'].indexOf(level);
  if(index<0)throw new Error('Choose a major, minor or patch bump.');
  parts[index]++;for(let i=index+1;i<3;i++)parts[i]=0;
  const next=parts.join('.');parseVersion(next);return next;
}
export async function readVersion(directory=process.cwd()){
  const pkg=JSON.parse(await fs.readFile(path.join(directory,'package.json'),'utf8'));
  const lock=JSON.parse(await fs.readFile(path.join(directory,'package-lock.json'),'utf8'));
  parseVersion(pkg.version);
  if(lock.version!==pkg.version || lock.packages?.['']?.version!==pkg.version)throw new Error('package.json and both root lockfile versions must match.');
  return {version:pkg.version,pkg,lock};
}
export async function bumpVersion(level,directory=process.cwd()){
  const {version,pkg,lock}=await readVersion(directory),next=nextVersion(version,level);
  pkg.version=next;lock.version=next;lock.packages[''].version=next;
  await fs.writeFile(path.join(directory,'package.json'),JSON.stringify(pkg,null,2)+'\n');
  await fs.writeFile(path.join(directory,'package-lock.json'),JSON.stringify(lock,null,2)+'\n');return next;
}
export async function checkVersion(base,directory=process.cwd(),{readBaseVersion=async sha=>JSON.parse((await exec('git',['show',`${sha}:package.json`],{cwd:directory,timeout:15000,maxBuffer:1024*1024})).stdout).version}={}){
  const {version}=await readVersion(directory);
  if(base && !/^0+$/.test(base)){
    if(!/^[0-9a-f]{40}$|^[0-9a-f]{64}$/i.test(base))throw new Error('The comparison commit must be a full Git SHA.');
    const previous=await readBaseVersion(base);
    if(compareVersions(version,previous)<=0)throw new Error(`Bump the version above ${previous} before merging/pushing main (npm run version:bump -- patch|minor|major).`);
  }
  return version;
}
if(process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const [command,argument]=process.argv.slice(2);
  if(command==='bump')console.log(await bumpVersion(argument));
  else if(command==='check'){
    const version=await checkVersion(argument);
    if(process.env.GITHUB_OUTPUT)await fs.appendFile(process.env.GITHUB_OUTPUT,`version=${version}\n`);
    console.log(`Release version: ${version}`);
  }else throw new Error('Usage: release-version.mjs bump <major|minor|patch> | check [base SHA]');
}
