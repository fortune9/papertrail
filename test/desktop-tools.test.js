import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { AssistantService } from '../src/assistant-service.js';
import { ToolManager,TOOL_MANIFEST,missingAssistant } from '../desktop/tools.js';
const exec=promisify(execFile);
const onlyFixture=(directory)=>(file,args,options)=>{
  if(file!=='tar' && !file.startsWith(directory+'/'))throw new Error('Ignore external tools in fixtures');
  return exec(file,args,options);
};
async function fixtureArchive(directory,id='codex'){
  const spec={...TOOL_MANIFEST[id],executable:'package/bin/'+id};
  const root=path.join(directory,'fixture-'+id);await fs.mkdir(path.join(root,'package','bin'),{recursive:true});
  await fs.writeFile(path.join(root,spec.executable),'#!/bin/sh\necho "'+id+' '+spec.version+'"\n',{mode:0o755});
  const archive=path.join(directory,id+'.tgz');await exec('tar',['-czf',archive,'-C',root,'package']);
  const bytes=await fs.readFile(archive);spec.integrity='sha512-'+createHash('sha512').update(bytes).digest('base64');
  return {spec,bytes};
}

test('desktop finds and remembers matching existing Codex without downloading or copying it',async()=>{
  const directory=await fs.mkdtemp('/tmp/papertrail-existing-tools-');
  try{
    const bin=path.join(directory,'bin');await fs.mkdir(bin);
    const executable=path.join(bin,'codex');await fs.writeFile(executable,'#!/bin/sh\necho "codex-cli 0.169.0"\n',{mode:0o755});
    let requests=0;
    const options={env:{PATH:bin},runCommand:onlyFixture(directory),fetchImpl:async()=>{requests++;throw new Error('No network expected');}};
    const manager=new ToolManager(directory,options);await manager.load();
    assert.equal(manager.status().tools.codex.path,executable);assert.equal(manager.status().tools.codex.source,'existing');
    assert.equal(manager.startInstall('codex').job.running,false);assert.equal(requests,0);
    await assert.rejects(()=>fs.access(manager.destination('codex')));
    await manager.selectCodex(executable);
    const next=new ToolManager(directory,{...options,env:{PATH:''}});await next.load();assert.equal(next.ready.codex.path,executable);
    const wrong=path.join(bin,'wrong');await fs.writeFile(wrong,'#!/bin/sh\necho "codex-cli 0.168.0"\n',{mode:0o755});
    await assert.rejects(()=>manager.selectCodex(wrong),/0.169.0/);
    assert.throws(()=>manager.startInstall('../../anything'),/Choose Codex/);
    const service=new AssistantService(directory,{openworker:missingAssistant('openworker'),codex:missingAssistant('codex'),defaultBackend:'codex'});
    const status=await service.getStatus(true);assert.equal(status.ai,false);assert.equal(status.aiBackends.length,2);assert.ok(status.aiBackends.every(backend=>!backend.configured && /AI components/.test(backend.message)));await service.shutdown();
    assert.equal(missingAssistant('openworker').configured,false);
    await assert.rejects(()=>missingAssistant('codex').ask(),/AI components/);
  }finally{await fs.rm(directory,{recursive:true,force:true});}
});

test('optional AI downloads verify checksums, extract native packages and survive restart',async()=>{
  const directory=await fs.mkdtemp('/tmp/papertrail-download-tools-');
  try{
    const codex=await fixtureArchive(directory),openworker=await fixtureArchive(directory,'openworker');
    const packages={codex:codex.spec,openworker:openworker.spec};let requests=0;
    const manager=new ToolManager(directory,{env:{PATH:''},packages,runCommand:onlyFixture(directory),fetchImpl:async(url,options)=>{
      requests++;assert.equal(options.redirect,'error');return new Response(url===codex.spec.url?codex.bytes:openworker.bytes,{headers:{'content-length':String(url===codex.spec.url?codex.bytes.length:openworker.bytes.length)}});
    }});
    await manager.load();assert.equal(requests,0);
    for(const id of ['codex','openworker']){
      assert.equal(manager.startInstall(id).job.running,true);
      assert.throws(()=>manager.startInstall(id),/already downloading/);
      await manager.task;assert.equal(manager.job.error,undefined);assert.equal(manager.status().tools[id].installed,true);
      assert.equal(manager.ready[id].source,'downloaded');
    }
    const next=new ToolManager(directory,{env:{PATH:''},packages,runCommand:onlyFixture(directory)});await next.load();
    assert.equal(next.status().tools.codex.installed,true);assert.equal(next.status().tools.openworker.installed,true);
    assert.equal((await fs.readdir(manager.directory)).some(name=>name.startsWith('.download-')),false);
  }finally{await fs.rm(directory,{recursive:true,force:true});}
});

test('corrupt or cancelled optional downloads never install an executable and can be retried',async()=>{
  const directory=await fs.mkdtemp('/tmp/papertrail-failed-tools-');
  try{
    const fixture=await fixtureArchive(directory),packages={...TOOL_MANIFEST,codex:fixture.spec};
    const manager=new ToolManager(directory,{env:{PATH:''},packages,runCommand:onlyFixture(directory),fetchImpl:async()=>new Response('corrupted')});
    manager.startInstall('codex');await manager.task;assert.equal(manager.job.error,true);assert.match(manager.job.message,/Checksum/);assert.equal(manager.ready.codex,undefined);
    await assert.rejects(()=>fs.access(manager.destination('codex')));
    manager.fetch=async(_url,{signal})=>{signal.throwIfAborted();await new Promise((_resolve,reject)=>signal.addEventListener('abort',()=>reject(signal.reason),{once:true}));};
    manager.startInstall('codex');await manager.close();assert.match(manager.job.message,/cancelled/);
    assert.equal((await fs.readdir(manager.directory)).length,0);
    manager.fetch=async()=>new Response(fixture.bytes);manager.startInstall('codex');await manager.task;
    assert.equal(manager.ready.codex.source,'downloaded');
  }finally{await fs.rm(directory,{recursive:true,force:true});}
});

test('download manifest stays pinned to lockfile integrity and matching SDK releases',async()=>{
  const lock=JSON.parse(await fs.readFile(new URL('../package-lock.json',import.meta.url),'utf8'));
  for(const [id,name]of [['codex','@openai/codex-linux-x64'],['openworker','@openworkerai/harness-runtime-linux-x64']]){
    const pinned=lock.packages['node_modules/'+name],spec=TOOL_MANIFEST[id];
    assert.equal(spec.url,pinned.resolved);assert.equal(spec.integrity,pinned.integrity);
    assert.equal(pinned.version,id==='codex'?spec.version+'-linux-x64':spec.version);
  }
});
