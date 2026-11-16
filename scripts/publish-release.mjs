import {promises as fs} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {parseVersion,readVersion} from './release-version.mjs';
import {digest} from './release-assets.mjs';
const exec=promisify(execFile);

export async function publishRelease({directory='release-assets',version,env=process.env,fetchImpl=fetch,runCommand=exec}){
  if(env.GITHUB_EVENT_NAME!=='push' || env.GITHUB_REF!=='refs/heads/main')throw new Error('Releases are published only for pushes to main.');
  parseVersion(version);
  const repo=env.GITHUB_REPOSITORY,commit=env.GITHUB_SHA,token=env.GH_TOKEN;
  if(!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo || '') || !/^[0-9a-f]{40}$/i.test(commit || '') || !token)throw new Error('Missing/invalid GitHub release context or token.');
  const entries=await fs.readdir(directory,{withFileTypes:true}),files=entries.map(entry=>entry.name).sort();
  if(!files.includes('SHA256SUMS') || files.length<3 || entries.some(entry=>!entry.isFile() || !/^[A-Za-z0-9][A-Za-z0-9._+-]*$/.test(entry.name)))throw new Error('A verified release asset directory is required.');
  const sums=(await fs.readFile(path.join(directory,'SHA256SUMS'),'utf8')).trim().split('\n'),verified=new Set();
  for(const line of sums){
    const match=/^([0-9a-f]{64})  ([A-Za-z0-9][A-Za-z0-9._+-]*)$/.exec(line);
    if(!match || match[2]==='SHA256SUMS' || verified.has(match[2]) || !files.includes(match[2]) || await digest(path.join(directory,match[2]))!==match[1])throw new Error('Release checksum verification failed.');
    verified.add(match[2]);
  }
  if(verified.size!==files.length-1)throw new Error('Not all release assets are covered by checksums.');
  const snapshots=new Map(await Promise.all(files.map(async file=>[file,{size:(await fs.stat(path.join(directory,file))).size,sha256:await digest(path.join(directory,file))}])));
  const apiRoot=env.GITHUB_API_URL || 'https://api.github.com';
  if(new URL(apiRoot).protocol!=='https:')throw new Error('Use an HTTPS GitHub API.');
  async function get(route){
    const response=await fetchImpl(`${apiRoot}/repos/${repo}/${route}`,{redirect:'error',headers:{Accept:'application/vnd.github+json',Authorization:`Bearer ${token}`,'X-GitHub-Api-Version':'2026-03-10','User-Agent':'papertrail-release'}});
    if(response.status===404)return null;
    if(!response.ok)throw new Error(`GitHub metadata request failed (${response.status}).`);
    return response.json();
  }
  const tag=`v${version}`;let ref=await get(`git/ref/tags/${tag}`);
  if(ref){
    let object=ref.object;
    for(let depth=0;object?.type==='tag' && depth<8;depth++)object=(await get(`git/tags/${object.sha}`))?.object;
    if(object?.type!=='commit' || object.sha!==commit)throw new Error('This version tag already points to a different commit. Bump the version.');
  }
  // The by-tag endpoint returns published releases, not pending draft tags.
  let release=await get(`releases/tags/${tag}`);
  if(!release){
    for(let page=1;;page++){
      const releases=await get(`releases?per_page=100&page=${page}`);
      if(!Array.isArray(releases))throw new Error('Could not list releases to locate an existing draft.');
      release=releases.find(item=>item.tag_name===tag);
      if(release || releases.length<100)break;
    }
  }
  if(release && !ref && (!release.draft || release.target_commitish!==commit))throw new Error('An existing release has no matching source tag/commit.');
  if(release && !release.draft)return {tag,published:false,message:'Matching release already published; existing assets were preserved.'};
  const command=(args)=>runCommand('gh',args,{env,timeout:300000,maxBuffer:1024*1024});
  if(!release){
    const {stdout}=await command(['api',`repos/${repo}/releases`,'--method','POST',
      '-f',`tag_name=${tag}`,'-f',`target_commitish=${commit}`,'-f',`name=Papertrail ${version}`,
      '-F','draft=true','-F','generate_release_notes=true']);
    // Keep the authoritative ID from creation; the draft is not visible by tag.
    release=JSON.parse(stdout);

  }
  if(!release?.draft || !Number.isSafeInteger(release.id) || release.tag_name!==tag || (!ref && release.target_commitish!==commit))throw new Error('GitHub did not return a valid draft release for this tag/source commit.');
  await command(['release','upload',tag,...files.map(file=>path.join(directory,file)),'--repo',repo,'--clobber']);
  const uploaded=await get(`releases/${release.id}`);
  if(!uploaded?.draft || uploaded.id!==release.id || uploaded.tag_name!==tag)throw new Error('Could not verify the pending draft by release ID.');
  for(const file of files){
    const asset=uploaded?.assets?.find(asset=>asset.name===file),expected=snapshots.get(file);
    if(!asset || asset.state!=='uploaded' || asset.size!==expected.size || (asset.digest && asset.digest!==`sha256:${expected.sha256}`))throw new Error('GitHub did not confirm all release asset uploads. The draft was preserved for retry.');
  }
  // Let GitHub choose latest using semantic versions, even if builds finish out of order.
  await command(['api',`repos/${repo}/releases/${release.id}`,'--method','PATCH','-F','draft=false','-f','make_latest=legacy']);
  return {tag,published:true,message:`Published ${tag} with ${files.length} verified assets.`};
}
if(process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url))console.log((await publishRelease({version:(await readVersion()).version})).message);
