import test from 'node:test';
import assert from 'node:assert/strict';
import {promises as fs} from 'node:fs';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
const exec=promisify(execFile);
import {bumpVersion,checkVersion,compareVersions,nextVersion,readVersion} from '../scripts/release-version.mjs';
import {collectAssets,digest,stageAssets} from '../scripts/release-assets.mjs';
import {publishRelease} from '../scripts/publish-release.mjs';
const commit='a'.repeat(40),other='b'.repeat(40);
async function fixture(){
  const directory=await fs.mkdtemp('/tmp/papertrail-release-');
  const dist=path.join(directory,'dist');await fs.mkdir(dist);
  await fs.writeFile(path.join(dist,'papertrail_1.4.0_amd64.deb'),'fixture installer');
  await fs.writeFile(path.join(dist,'papertrail_1.3.0_amd64.deb'),'old installer');
  await fs.writeFile(path.join(dist,'.env'),'excluded private file');
  const staged=path.join(directory,'staged');await stageAssets({source:dist,destination:staged,version:'1.4.0',commit,target:'linux-x64'});
  return {directory,dist,staged,release:path.join(directory,'release')};
}

test('release version bumps reset lower components and keep lockfile/dependencies synchronized',async()=>{
  const directory=await fs.mkdtemp('/tmp/papertrail-version-');
  try{
    assert.equal(nextVersion('1.3.7','patch'),'1.3.8');assert.equal(nextVersion('1.3.7','minor'),'1.4.0');assert.equal(nextVersion('1.3.7','major'),'2.0.0');
    assert.equal(compareVersions('1.10.0','1.9.9'),1);assert.equal(compareVersions('2.0.0','1.99.99'),1);
    assert.throws(()=>nextVersion('01.3.0','patch'),/major.minor.patch/);assert.throws(()=>nextVersion('1.3.0','guess'),/Choose/);
    const pkg={name:'fixture',version:'1.3.0',dependencies:{pinned:'1.2.3'}},lock={version:'1.3.0',packages:{'':{version:'1.3.0'},'node_modules/pinned':{version:'1.2.3'}}};
    await fs.writeFile(path.join(directory,'package.json'),JSON.stringify(pkg));await fs.writeFile(path.join(directory,'package-lock.json'),JSON.stringify(lock));
    await exec('git',['init','-q',directory]);await exec('git',['add','.'],{cwd:directory});
    await exec('git',['-c','user.name=Release test','-c','user.email=release@example.invalid','commit','-qm','fixture'],{cwd:directory});
    const base=(await exec('git',['rev-parse','HEAD'],{cwd:directory})).stdout.trim();
    await assert.rejects(()=>checkVersion(base,directory),/Bump the version/);
    assert.equal(await bumpVersion('minor',directory),'1.4.0');assert.equal(await checkVersion(base,directory),'1.4.0');
    const result=await readVersion(directory);assert.deepEqual(result.pkg.dependencies,pkg.dependencies);assert.deepEqual(result.lock.packages['node_modules/pinned'],lock.packages['node_modules/pinned']);
    await assert.rejects(()=>checkVersion('--bad',directory),/full Git SHA/);
    result.lock.version='1.3.0';await fs.writeFile(path.join(directory,'package-lock.json'),JSON.stringify(result.lock));
    await assert.rejects(()=>readVersion(directory),/must match/);
  }finally{await fs.rm(directory,{recursive:true,force:true});}
});

test('release collection handles future assets and rejects corrupt, duplicate or wrong-source builds',async()=>{
  const f=await fixture();
  try{
    assert.deepEqual((await fs.readdir(f.staged)).sort(),['SHA256SUMS-linux-x64','build-linux-x64.json','papertrail_1.4.0_amd64.deb']);
    const incoming=path.join(f.directory,'incoming');await fs.mkdir(incoming);await fs.cp(f.staged,path.join(incoming,'linux'),{recursive:true});
    const future=path.join(f.directory,'future');await fs.mkdir(future);await fs.writeFile(path.join(future,'papertrail_1.4.0_arm64.dmg'),'fixture future asset');
    await stageAssets({source:future,destination:path.join(incoming,'mac'),version:'1.4.0',commit,target:'macos-arm64'});
    const options={source:incoming,destination:f.release,version:'1.4.0',commit};
    const names=await collectAssets(options);assert.ok(names.includes('papertrail_1.4.0_arm64.dmg'));assert.ok(names.includes('papertrail_1.4.0_amd64.deb'));assert.ok(names.includes('SHA256SUMS'));assert.equal(names.some(name=>name.includes('1.3.0')),false);
    await assert.rejects(()=>collectAssets({...options,commit:other}),/source commit/);
    await fs.appendFile(path.join(incoming,'linux','papertrail_1.4.0_amd64.deb'),'tampered');await assert.rejects(()=>collectAssets(options),/checksum/);
    await fs.cp(f.staged,path.join(incoming,'linux'),{recursive:true});
    await fs.cp(f.staged,path.join(incoming,'duplicate'),{recursive:true});await assert.rejects(()=>collectAssets(options),/duplicate/);
    await assert.rejects(()=>stageAssets({source:f.dist,destination:f.dist,version:'1.4.0',commit,target:'linux-x64'}),/separate/);
  }finally{await fs.rm(f.directory,{recursive:true,force:true});}
});

function githubMock(directory,{draft=false,published=false,wrongTag=false,uploadFailure=false,draftPage=1}={}){
  let release=(draft || published)?{id:42,tag_name:'v1.4.0',draft:!published,target_commitish:commit,assets:[]}:null;
  let ref=published || wrongTag?{object:{type:'commit',sha:wrongTag?other:commit}}:null;
  const calls=[];
  const fetchImpl=async url=>{
    calls.push(['GET',url]);const parsed=new URL(url);let value;
    if(parsed.pathname.includes('/git/ref/'))value=ref;
    else if(parsed.pathname.includes('/releases/tags/'))value=release && !release.draft?release:null;
    else if(parsed.pathname.endsWith('/releases')){
      const page=Number(parsed.searchParams.get('page'));
      if(release?.draft && page<draftPage)value=Array.from({length:100},(_,i)=>({id:1000+i,tag_name:`v0.0.${i}`,draft:false}));
      else value=release && page===draftPage?[release]:[];
    }else if(parsed.pathname.endsWith('/releases/42'))value=release;
    else throw new Error('Unexpected mock API route: '+url);
    return new Response(value?JSON.stringify(value):'{}',{status:value?200:404,headers:{'Content-Type':'application/json'}});
  };
  const runCommand=async(file,args)=>{
    calls.push([file,...args]);
    if(args[0]==='api' && args.includes('POST')){release={id:42,tag_name:'v1.4.0',draft:true,target_commitish:commit,assets:[]};return {stdout:JSON.stringify(release),stderr:''};}
    if(args[0]==='release' && args[1]==='upload'){
      if(uploadFailure)throw new Error('Upload failed');
      release.assets=await Promise.all((await fs.readdir(directory)).map(async name=>({name,state:'uploaded',size:(await fs.stat(path.join(directory,name))).size,digest:'sha256:'+await digest(path.join(directory,name))})));
    }
    if(args[0]==='api' && args.includes('PATCH')){release.draft=false;ref={object:{type:'commit',sha:commit}};}
    return {stdout:'',stderr:''};
  };
  return {calls,fetchImpl,runCommand,release:()=>release};
}
const env={GITHUB_EVENT_NAME:'push',GITHUB_REF:'refs/heads/main',GITHUB_REPOSITORY:'fortune9/papertrail',GITHUB_SHA:commit,GH_TOKEN:'fixture-token'};

test('release publishing stages a draft, verifies uploads and publishes only main pushes',async()=>{
  const f=await fixture();
  try{
    await collectAssets({source:f.staged,destination:f.release,version:'1.4.0',commit});
    const mock=githubMock(f.release),options={directory:f.release,version:'1.4.0',env,...mock};
    await assert.rejects(()=>publishRelease({...options,env:{...env,GITHUB_EVENT_NAME:'pull_request'}}),/only for pushes/);assert.equal(mock.calls.length,0);
    const result=await publishRelease(options);assert.equal(result.published,true);assert.equal(mock.release().draft,false);
    const writes=mock.calls.filter(call=>call[0]==='gh');assert.deepEqual(writes.map(call=>call[1]),['api','release','api']);
    assert.ok(writes[0].includes('draft=true'));assert.equal(writes.at(-1).includes('make_latest=legacy'),true);
    mock.calls.length=0;const rerun=await publishRelease(options);assert.equal(rerun.published,false);assert.equal(mock.calls.some(call=>call[0]==='gh'),false);
  }finally{await fs.rm(f.directory,{recursive:true,force:true});}
});

test('release retries preserve drafts and reject tag collisions or corrupted local assets',async()=>{
  const f=await fixture();
  try{
    await collectAssets({source:f.staged,destination:f.release,version:'1.4.0',commit});
    const options={directory:f.release,version:'1.4.0',env};
    const bad=githubMock(f.release,{wrongTag:true});await assert.rejects(()=>publishRelease({...options,...bad}),/different commit/);assert.equal(bad.calls.some(call=>call[0]==='gh'),false);
    const failed=githubMock(f.release,{uploadFailure:true});await assert.rejects(()=>publishRelease({...options,...failed}),/Upload failed/);assert.equal(failed.release().draft,true);assert.equal(failed.calls.some(call=>call[0]==='gh' && call.includes('PATCH')),false);
    const changing=githubMock(f.release),originalCommand=changing.runCommand;
    changing.runCommand=async(file,args)=>{if(args[0]==='release' && args[1]==='upload'){const asset=path.join(f.release,'papertrail_1.4.0_amd64.deb'),bytes=await fs.readFile(asset);bytes[0]^=1;await fs.writeFile(asset,bytes);}return originalCommand(file,args);};
    await assert.rejects(()=>publishRelease({...options,...changing}),/confirm all release asset uploads/);assert.equal(changing.release().draft,true);
    await collectAssets({source:f.staged,destination:f.release,version:'1.4.0',commit});
    const retry=githubMock(f.release,{draft:true});assert.equal((await publishRelease({...options,...retry})).published,true);assert.equal(retry.calls.some(call=>call[0]==='gh' && call[1]==='api' && call.includes('POST')),false);
    await fs.appendFile(path.join(f.release,'papertrail_1.4.0_amd64.deb'),'tampered');const corrupt=githubMock(f.release);await assert.rejects(()=>publishRelease({...options,...corrupt}),/checksum/);assert.equal(corrupt.calls.length,0);
  }finally{await fs.rm(f.directory,{recursive:true,force:true});}
});

test('drafts invisible to by-tag lookup are resumed across list pages and verified by release ID',async()=>{
  const f=await fixture();
  try{
    await collectAssets({source:f.staged,destination:f.release,version:'1.4.0',commit});
    const options={directory:f.release,version:'1.4.0',env};
    const mock=githubMock(f.release,{draft:true,draftPage:2});
    assert.equal((await publishRelease({...options,...mock})).published,true);
    assert.ok(mock.calls.some(call=>call[0]==='GET' && call[1].endsWith('/releases?per_page=100&page=2')));
    assert.ok(mock.calls.some(call=>call[0]==='GET' && call[1].endsWith('/releases/42')));
    assert.equal(mock.calls.some(call=>call[0]==='gh' && call.includes('POST')),false);
    const wrong=githubMock(f.release,{draft:true});wrong.release().target_commitish=other;
    await assert.rejects(()=>publishRelease({...options,...wrong}),/matching source tag\/commit/);
    assert.equal(wrong.calls.some(call=>call[0]==='gh'),false);
    const missing=githubMock(f.release,{draft:true}),fetch=missing.fetchImpl;
    missing.fetchImpl=async(url,init)=>url.endsWith('/releases/42')?new Response('{}',{status:404}):fetch(url,init);
    await assert.rejects(()=>publishRelease({...options,...missing}),/pending draft by release ID/);
    assert.equal(missing.calls.some(call=>call[0]==='gh' && call.includes('PATCH')),false);
  }finally{await fs.rm(f.directory,{recursive:true,force:true});}
});
