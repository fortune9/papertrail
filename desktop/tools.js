import { promises as fs,createWriteStream } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createHash,timingSafeEqual } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { Readable,Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { codexEnvironment } from '../src/codex-assistant.js';

const exec=promisify(execFile);
const manifest=JSON.parse(await fs.readFile(new URL('./tools.json',import.meta.url),'utf8'));
export const TOOL_MANIFEST=manifest;

export function missingAssistant(id){
  const message=`Open Settings → AI components to set up ${id==='codex'?'Codex':'OpenWorker'}. Offline search is ready.`;
  return {configured:false,statusMessage:message,refreshStatus:async()=>({id,label:'Local Codex (ChatGPT)',configured:false,message}),
    ask:async()=>{throw new Error(message);},shutdown:async()=>{}};
}

export class ToolManager {
  constructor(directory,{env=process.env,fetchImpl=fetch,runCommand=exec,packages=manifest}={}){
    this.directory=path.join(directory,'tools');this.configFile=path.join(directory,'tools.json');
    this.env=env;this.fetch=fetchImpl;this.exec=runCommand;this.packages=packages;this.ready={};
    this.job={running:false,message:''};this.selection='';
  }
  spec(id){if(!Object.hasOwn(this.packages,id))throw new Error('Choose Codex or OpenWorker.');return this.packages[id];}
  destination(id){return path.join(this.directory,`${id}-${this.spec(id).version}`);}
  async valid(id,executable){
    try{
      await fs.access(executable,fs.constants.X_OK);
      const {stdout='',stderr=''}=await this.exec(executable,['--version'],{timeout:10000,maxBuffer:16384,env:codexEnvironment(this.env),windowsHide:true});
      const output=stdout+'\n'+stderr;
      return output.trim().split(/\s+/).includes(this.spec(id).version);
    }catch{return false;}
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
    const candidates=[this.selection,this.env.CODEX_PATH,...(this.env.PATH || '').split(path.delimiter).filter(Boolean).map(dir=>path.join(dir,'codex')),
      path.join(os.homedir(),'.local','bin','codex'),'/usr/local/bin/codex','/usr/bin/codex'].filter(candidate=>candidate && path.isAbsolute(candidate));
    for(const executable of new Set(candidates))if(await this.valid('codex',executable)){ready.codex={path:executable,source:'existing',version:this.spec('codex').version};break;}
    this.ready=ready;return this.status();
  }
  status(){return {tools:Object.fromEntries(['codex','openworker'].map(id=>[id,{installed:!!this.ready[id],version:this.spec(id).version,...this.ready[id]}])),job:{...this.job}};}
  async selectCodex(executable){
    if(this.job.running)throw new Error('Wait for the current download to finish.');
    if(!path.isAbsolute(executable) || !await this.valid('codex',executable))throw new Error(`Select a working Codex ${this.spec('codex').version} executable. Other versions have not been qualified with this SDK.`);
    await fs.writeFile(this.configFile+'.tmp',JSON.stringify({codexPath:executable})+'\n',{mode:0o600});
    await fs.rename(this.configFile+'.tmp',this.configFile);this.selection=executable;await this.detect();return this.status();
  }
  startInstall(id){
    this.spec(id);if(this.job.running)throw new Error('An AI component is already downloading.');
    if(this.ready[id])return this.status();
    const controller=this.controller=new AbortController();
    this.job={id,running:true,received:0,total:0,message:'Downloading '+(id==='codex'?'Codex':'OpenWorker')+'…'};
    this.task=this.install(id,controller.signal).then(()=>{this.job={id,running:false,message:'Installed. Ready to connect.'};},error=>{
      this.job={id,running:false,error:true,message:controller.signal.aborted?'Download cancelled.':`Download failed: ${error.message}`};
    });return this.status();
  }
  cancel(){this.controller?.abort();return this.status();}
  async close(){this.cancel();await this.task;}
  async install(id,signal){
    const spec=this.spec(id);await fs.mkdir(this.directory,{recursive:true,mode:0o700});
    const temporary=await fs.mkdtemp(path.join(this.directory,'.download-'));
    try{
      const response=await this.fetch(spec.url,{signal,redirect:'error'});
      if(!response.ok || !response.body)throw new Error('The download server is unavailable. Try again.');
      const total=Number(response.headers.get('content-length')) || 0,limit=512*1024*1024;
      if(total>limit)throw new Error('Download exceeds the allowed size.');
      this.job.total=total;const hash=createHash('sha512');let received=0;
      const meter=new Transform({transform:(chunk,_encoding,callback)=>{
        received+=chunk.length;this.job.received=received;
        if(received>limit)return callback(new Error('Download exceeds the allowed size.'));
        hash.update(chunk);callback(null,chunk);
      }});
      const archive=path.join(temporary,'download.tgz');
      await pipeline(Readable.fromWeb(response.body),meter,createWriteStream(archive,{mode:0o600}),{signal});
      const actual=hash.digest(),expected=Buffer.from(spec.integrity.replace(/^sha512-/,''),'base64');
      if(expected.length!==actual.length || !timingSafeEqual(actual,expected))throw new Error('Checksum verification failed. No component was installed.');
      this.job.message='Verifying and installing…';
      const {stdout:list}=await this.exec('tar',['-tzf',archive],{signal,maxBuffer:4*1024*1024,timeout:30000});
      for(const file of list.trim().split('\n'))if(!file.startsWith('package/') || file.split('/').includes('..') || file.includes('\\'))throw new Error('Unsafe archive path.');
      await this.exec('tar',['-xzf',archive,'--no-same-owner','--no-same-permissions','-C',temporary],{signal,timeout:120000,maxBuffer:16384});
      const executable=path.join(temporary,spec.executable);await fs.chmod(executable,0o755);
      if(!await this.valid(id,executable))throw new Error('The downloaded executable could not start or has an unexpected version.');
      signal.throwIfAborted();await fs.rm(archive);const destination=this.destination(id);
      // This versioned directory belongs only to Papertrail. Never edit global tools.
      await fs.rm(destination,{recursive:true,force:true});await fs.rename(temporary,destination);
      this.ready[id]={path:path.join(destination,spec.executable),source:'downloaded',version:spec.version};
    }finally{await fs.rm(temporary,{recursive:true,force:true});}
  }
}
