import { spawn } from 'node:child_process';
import {createRequire} from 'node:module';
const appVersion=createRequire(import.meta.url)('../package.json').version;
import { codexEnvironment } from '../src/codex-assistant.js';

export function allowedSignInUrl(value){
  try{const url=new URL(value);return url.protocol==='https:' && ['auth.openai.com','chatgpt.com'].includes(url.hostname) && !url.username && !url.password && (!url.port || url.port==='443');}catch{return false;}
}

// Use Codex's structured login protocol. The app opens exactly the returned
// authorization URL; it never scrapes terminal text or handles tokens itself.
export class DesktopLogin {
  constructor(executable,env,openExternal,{spawnProcess=spawn,version=appVersion}={}){this.executable=executable;this.env=env;this.openExternal=openExternal;this.spawnProcess=spawnProcess;this.version=version;this.state={running:false,message:'Sign in to use your ChatGPT allowance.'};}
  status(){return {...this.state};}
  async openPage(){if(!this.state.running || !allowedSignInUrl(this.state.url))throw new Error('Start sign-in first.');await this.openExternal(this.state.url);}
  start(){
    if(this.child)return this.status();
    this.state={running:true,message:'Starting secure ChatGPT sign-in…'};
    const child=this.child=this.spawnProcess(this.executable,['app-server','--stdio'],{env:codexEnvironment(this.env),stdio:['pipe','pipe','pipe'],windowsHide:true});
    let buffer='',loginId;
    const send=message=>{if(this.child===child && !child.stdin.destroyed)child.stdin.write(JSON.stringify(message)+'\n');};
    const finish=message=>{
      if(this.child!==child)return;
      this.child=null;clearTimeout(timer);this.state={running:false,message};child.kill();
    };
    child.stdin.on('error',()=>finish('Sign-in connection closed. Try again.'));
    child.stdout.on('data',chunk=>{
      if(this.child!==child)return;
      buffer+=chunk.toString();if(buffer.length>1024*1024){finish('Invalid sign-in response. Try again.');return;}
      let end;
      while((end=buffer.indexOf('\n'))>=0){
        const line=buffer.slice(0,end);buffer=buffer.slice(end+1);if(!line.trim())continue;
        let message;try{message=JSON.parse(line);}catch{finish('Invalid sign-in response. Try again.');return;}
        if(message.error && [0,1].includes(message.id)){finish('Sign-in could not start. Try again or restart Papertrail.');return;}
        if(message.id===0 && message.result){
          send({method:'initialized'});send({id:1,method:'account/login/start',params:{type:'chatgpt'}});
        }
        if(message.id===1 && message.result){
          if(message.result.type!=='chatgpt' || typeof message.result.loginId!=='string' || !message.result.loginId || !allowedSignInUrl(message.result.authUrl)){finish('The sign-in service returned an unexpected address.');return;}
          loginId=message.result.loginId;
          this.state={running:true,url:message.result.authUrl,message:'Finish signing in in your browser.'};
          this.openExternal(message.result.authUrl).catch(()=>{if(this.child===child)this.state.message='Open the sign-in link below to continue.';});
        }
        if(message.method==='account/login/completed' && message.params?.loginId===loginId){
          finish(message.params.success?'Sign-in finished. Your account is ready.':'Sign-in failed or was cancelled. Try again.');return;
        }
      }
    });
    // Consume diagnostics without forwarding raw responses or credentials.
    child.stderr.on('data',()=>{});
    child.once('error',()=>finish('Could not start the selected Codex sign-in.'));
    child.once('close',()=>finish('Sign-in stopped or failed. Try again.'));
    const timer=this.timer=setTimeout(()=>this.cancel(),300000).unref();
    this.cancelRequest=()=>{if(loginId)send({id:2,method:'account/login/cancel',params:{loginId}});};
    send({id:0,method:'initialize',params:{clientInfo:{name:'papertrail',title:'Papertrail',version:this.version}}});
    return this.status();
  }
  cancel(){this.cancelRequest?.();if(this.child){const child=this.child;this.child=null;child.kill();}clearTimeout(this.timer);this.state={running:false,message:'Sign-in cancelled.'};return this.status();}
}
