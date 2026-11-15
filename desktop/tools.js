import { promises as fs,createWriteStream } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createHash,timingSafeEqual } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { Readable,Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { codexEnvironment } from '../src/codex-assistant.js';
import { createRequire } from 'node:module';

const exec=promisify(execFile);
const manifest=JSON.parse(await fs.readFile(new URL('./tools.json',import.meta.url),'utf8'));
export const TOOL_MANIFEST=manifest;

export function missingAssistant(id){
  const message=`Open Settings → AI components to set up ${id==='codex'?'Codex':'OpenWorker'}. Offline search is ready.`;
  return {configured:false,statusMessage:message,refreshStatus:async()=>({id,label:'Local Codex (ChatGPT)',configured:false,message}),
    ask:async()=>{throw new Error(message);},shutdown:async()=>{}};
}

export class ToolManager {
  constructor(directory,{env=process.env,fetchImpl=fetch,runCommand=exec,packages=manifest,idleTimeoutMs=60000}={}){
    this.directory=path.join(directory,'tools');this.configFile=path.join(directory,'tools.json');
    this.env=env;this.fetch=fetchImpl;this.exec=runCommand;this.packages=packages;this.ready={};
    this.idleTimeoutMs=idleTimeoutMs;
    this.job={running:false,message:''};this.selection='';
  }
  spec(id){if(!Object.hasOwn(this.packages,id))throw new Error('Choose Codex or OpenWorker.');return this.packages[id];}
  destination(id){return path.join(this.directory,`${id}-${this.spec(id).version}`);}
  async resolveCodex(executable){
    // npm's launcher uses /usr/bin/env node. Resolve its platform package so
    // desktop sign-in and SDK runs do not depend on the login shell's PATH.
    const launcher=await fs.realpath(executable);
    try{
      const root=path.dirname(path.dirname(launcher));
      const pkg=JSON.parse(await fs.readFile(path.join(root,'package.json'),'utf8'));
      if(pkg.name==='@openai/codex' && path.basename(launcher)==='codex.js'){
        let vendor=path.join(root,'vendor');
        try{vendor=path.join(path.dirname(createRequire(launcher).resolve('@openai/codex-linux-x64/package.json')),'vendor');}catch{}
        const native=path.join(vendor,'x86_64-unknown-linux-musl','bin','codex');
        await fs.access(native,fs.constants.X_OK);return native;
      }
    }catch{}
    return executable;
  }
  async probe(id,executable){
    try{
      await fs.access(executable,fs.constants.X_OK);
      const resolved=id==='codex'?await this.resolveCodex(executable):executable;
      const env=codexEnvironment(this.env);
      env.PATH=[path.dirname(executable),env.PATH || '/usr/local/bin:/usr/bin:/bin'].join(path.delimiter);
      const {stdout='',stderr=''}=await this.exec(resolved,['--version'],{timeout:10000,maxBuffer:16384,env,windowsHide:true});
      const output=(stdout+'\n'+stderr).trim();
      if(!output.split(/\s+/).includes(this.spec(id).version))return {reason:`${executable}: version does not match ${this.spec(id).version}.`};
      return {path:resolved,...(resolved!==executable?{launcher:executable}:{})};
    }catch(error){return {reason:error.code==='ENOENT'?`${executable}: executable or its interpreter was not found.`:`${executable}: could not run --version (${error.killed?'timed out':error.code || 'launch failed'}).`};}
  }
  async valid(id,executable){
    return !!(await this.probe(id,executable)).path;
  }
  async load(){
    try{const data=JSON.parse(await fs.readFile(this.configFile,'utf8'));if(typeof data.codexPath==='string' && path.isAbsolute(data.codexPath))this.selection=data.codexPath;}catch{}
    await this.detect();return this.status();
  }
  async detect(){
    const ready={};
    for(const id of ['codex','openworker']){
      const executable=path.join(this.destination(id),this.spec(id).executable);
      if(await this.valid(id,executable))ready[id]={path:executable,source:'downloaded',version:this.spec(id).version};
    }
    // Prefer the user's selected executable or an existing matching installation.
    const home=this.env.HOME || os.homedir(),nvmRoots=new Set([this.env.NVM_DIR,path.join(home,'.nvm')].filter(Boolean));
    const nvm=[];
    for(const root of nvmRoots){
      try{const versions=(await fs.readdir(path.join(root,'versions','node'))).filter(name=>/^v\d+\.\d+\.\d+$/.test(name)).sort((a,b)=>b.localeCompare(a,undefined,{numeric:true})).slice(0,100);
        nvm.push(...versions.map(version=>path.join(root,'versions','node',version,'bin','codex')));
      }catch{}
    }
    const candidates=[this.selection,this.env.CODEX_PATH,...(this.env.PATH || '').split(path.delimiter).filter(Boolean).map(dir=>path.join(dir,'codex')),
      ...(this.env.NVM_BIN?[path.join(this.env.NVM_BIN,'codex')]:[]),...nvm,path.join(home,'.local','bin','codex'),'/usr/local/bin/codex','/usr/bin/codex'].filter(candidate=>candidate && path.isAbsolute(candidate));
    this.detectionNote='';
    for(const executable of new Set(candidates)){
      try{await fs.access(executable);}catch{continue;}
      const result=await this.probe('codex',executable);
      if(result.path){ready.codex={...result,source:'existing',version:this.spec('codex').version};break;}
      this.detectionNote ||= result.reason;
    }
    this.ready=ready;return this.status();
  }
  status(){return {tools:Object.fromEntries(['codex','openworker'].map(id=>[id,{installed:!!this.ready[id],version:this.spec(id).version,...this.ready[id],...(id==='codex' && !this.ready[id]?{note:this.detectionNote || 'No matching Codex found on PATH or in nvm. Choose an executable or paste its full path.'}:{})}])),job:{...this.job}};}
  async selectCodex(executable){
    if(this.job.running)throw new Error('Wait for the current download to finish.');
    if(typeof executable!=='string' || executable.length>4096 || !path.isAbsolute(executable))throw new Error('Enter the full absolute path to the Codex executable.');
    const result=await this.probe('codex',executable);
    if(!result.path)throw new Error(`${result.reason} Select Codex ${this.spec('codex').version}; other versions have not been qualified with this SDK.`);
    await fs.writeFile(this.configFile+'.tmp',JSON.stringify({codexPath:executable})+'\n',{mode:0o600});
    await fs.rename(this.configFile+'.tmp',this.configFile);this.selection=executable;await this.detect();return this.status();
  }
  startInstall(id){
    this.spec(id);if(this.job.running)throw new Error('An AI component is already downloading.');
    if(this.ready[id])return this.status();
    const controller=this.controller=new AbortController();
    this.job={id,phase:'download',running:true,received:0,total:0,message:'Downloading '+(id==='codex'?'Codex':'OpenWorker')+'…'};
    this.task=this.install(id,controller.signal).then(()=>{this.job={id,phase:'complete',running:false,message:this.installedMessage(id)};},error=>{
      this.job={id,running:false,error:true,message:controller.signal.aborted?'Download cancelled.':`Download failed: ${error.message}`};
    });return this.status();
  }
  cancel(){this.controller?.abort();return this.status();}
  async close(){this.cancel();await this.task;}
  installedMessage(id){return id==='openworker'?'OpenWorker installed. Set the model and provider below, then save provider settings.':'Codex installed. Use Sign in with ChatGPT to connect your account.';}
  async activate(callback,{timeoutMs=10000}={}){
    if(this.job.error)return;
    const id=this.job.id;this.job={id,phase:'activate',running:true,message:'Connecting installed component…'};
    let timer,onAbort;
    try{
      await Promise.race([Promise.resolve().then(callback),new Promise((_,reject)=>{
        timer=setTimeout(()=>reject(new Error('Connection timed out. The component is installed; restart Papertrail to use it.')),timeoutMs);
        onAbort=()=>reject(new Error('Connection cancelled. The component is installed; restart Papertrail to use it.'));
        this.controller?.signal.addEventListener('abort',onAbort,{once:true});
        if(this.controller?.signal.aborted)onAbort();
      })]);
      this.job={id,phase:'complete',running:false,message:this.installedMessage(id)};
    }catch(error){this.job={id,phase:'error',running:false,error:true,message:error.message};}
    finally{clearTimeout(timer);if(onAbort)this.controller?.signal.removeEventListener('abort',onAbort);}
  }
  async install(id,signal){
    const spec=this.spec(id);await fs.mkdir(this.directory,{recursive:true,mode:0o700});
    const temporary=await fs.mkdtemp(path.join(this.directory,'.download-'));
    const idle=new AbortController(),downloadSignal=AbortSignal.any([signal,idle.signal]);let idleTimer;
    const touch=()=>{clearTimeout(idleTimer);idleTimer=setTimeout(()=>idle.abort(new Error('Download stalled with no data received. Check your network and retry.')),this.idleTimeoutMs);};
    try{
      touch();const response=await this.fetch(spec.url,{signal:downloadSignal,redirect:'error'});
      if(!response.ok || !response.body)throw new Error('The download server is unavailable. Try again.');
      const total=Number(response.headers.get('content-length')) || 0,limit=512*1024*1024;
      if(total>limit)throw new Error('Download exceeds the allowed size.');
      this.job.total=total;const hash=createHash('sha512');let received=0;
      const meter=new Transform({transform:(chunk,_encoding,callback)=>{
        touch();
        received+=chunk.length;this.job.received=received;
        if(received>limit)return callback(new Error('Download exceeds the allowed size.'));
        hash.update(chunk);callback(null,chunk);
      }});
      const archive=path.join(temporary,'download.tgz');
      await pipeline(Readable.fromWeb(response.body),meter,createWriteStream(archive,{mode:0o600}),{signal:downloadSignal});
      clearTimeout(idleTimer);
      const actual=hash.digest(),expected=Buffer.from(spec.integrity.replace(/^sha512-/,''),'base64');
      if(expected.length!==actual.length || !timingSafeEqual(actual,expected))throw new Error('Checksum verification failed. No component was installed.');
      this.job.phase='verify';this.job.message='Checking archive contents…';
      const {stdout:list}=await this.exec('tar',['-tzf',archive],{signal,maxBuffer:4*1024*1024,timeout:30000});
      for(const file of list.trim().split('\n'))if(!file.startsWith('package/') || file.split('/').includes('..') || file.includes('\\'))throw new Error('Unsafe archive path.');
      this.job.phase='extract';this.job.message='Extracting downloaded files…';
      await this.exec('tar',['-xzf',archive,'--no-same-owner','--no-same-permissions','-C',temporary],{signal,timeout:120000,maxBuffer:16384});
      this.job.phase='validate';this.job.message='Checking installed executable…';
      const executable=path.join(temporary,spec.executable);await fs.chmod(executable,0o755);
      if(!await this.valid(id,executable))throw new Error('The downloaded executable could not start or has an unexpected version.');
      signal.throwIfAborted();await fs.rm(archive);const destination=this.destination(id);
      // This versioned directory belongs only to Papertrail. Never edit global tools.
      await fs.rm(destination,{recursive:true,force:true});await fs.rename(temporary,destination);
      this.ready[id]={path:path.join(destination,spec.executable),source:'downloaded',version:spec.version};
    }catch(error){if(idle.signal.aborted && !signal.aborted)throw idle.signal.reason;throw error;}
    finally{clearTimeout(idleTimer);await fs.rm(temporary,{recursive:true,force:true});}
  }
}
