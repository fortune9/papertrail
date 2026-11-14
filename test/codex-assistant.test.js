import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { Readable, Writable } from 'node:stream';
import { CodexAssistant, codexEnvironment } from '../src/codex-assistant.js';
import { AssistantService } from '../src/assistant-service.js';
import { createHandler } from '../src/server.js';
import { Library } from '../src/library.js';

const sources=[{id:7,title:'Synthetic study',match_page:2,excerpt:'The synthetic cohort contained 120 participants.'}];

async function fixture(mode='complete',extraEnv={}) {
  const dir=await fs.mkdtemp('/tmp/papertrail-codex-fixture-');
  const executable=path.join(dir,'codex-fixture'),record=path.join(dir,'request.json');
  // POSIX fixture exercises the actual SDK subprocess/JSONL transport without
  // a model, credentials or another JS runtime inside the child process.
  const quote=value=>"'"+value.replace(/'/g,"'\\''")+"'";
  const event=value=>`printf '%s\\n' ${quote(JSON.stringify(value))}\n`;
  let script=`#!/bin/sh\nif [ "$1" = login ]; then printf '%s\\n' 'Logged in using ChatGPT'; exit 0; fi\ncat > ${quote(record+'.input')}\nprintf '%s\\n' "$@" > ${quote(record+'.args')}\nenv > ${quote(record+'.env')}\n`;
  script+=event({type:'thread.started',thread_id:'fixture-thread'});
  script+=event({type:'item.updated',item:{id:'answer',type:'agent_message',text:'Draft'}});
  if(mode==='wait')script+='while :; do sleep 1; done\n';
  if(mode==='failed')script+=event({type:'turn.failed',error:{message:'Fixture provider failure'}});
  if(mode==='tool')script+=event({type:'item.started',item:{id:'tool',type:'command_execution',command:'disallowed',status:'in_progress'}});
  if(mode==='error')script+=event({type:'error',message:'Fixture stream failure'});
  if(mode==='complete'){
    script+=event({type:'item.completed',item:{id:'answer',type:'agent_message',text:'120 participants [Paper 7, p. 2].'}});
    script+=event({type:'turn.completed',usage:{input_tokens:1,cached_input_tokens:0,output_tokens:1}});
  }
  await fs.writeFile(executable,script,{mode:0o700});
  const env={...process.env,CODEX_PATH:executable,OPENAI_API_KEY:'test-key-must-not-reach-codex',CODEX_API_KEY:'also-not-forwarded',AWS_SECRET_ACCESS_KEY:'not-forwarded',...extraEnv};
  const assistant=new CodexAssistant({env});
  return {dir,record,assistant,async close(){await assistant.shutdown();await fs.rm(dir,{recursive:true,force:true});}};
}

test('real Codex SDK subprocess streams answers, keeps source scope and enforces subscription-only config',async()=>{
  const f=await fixture();
  try{
    const events=[];
    await f.assistant.ask('How many participants?',sources,e=>events.push(e),new AbortController().signal);
    assert.equal(events.at(-1).type,'done');assert.equal(events.at(-1).text,'120 participants [Paper 7, p. 2].');
    assert.equal(events.filter(e=>e.type==='done').length,1);assert.equal(f.assistant.busy,false);
    const request={input:await fs.readFile(f.record+'.input','utf8'),args:(await fs.readFile(f.record+'.args','utf8')).trim().split('\n'),
      env:Object.fromEntries((await fs.readFile(f.record+'.env','utf8')).trim().split('\n').map(line=>{const n=line.indexOf('=');return [line.slice(0,n),line.slice(n+1)];}))};
    assert.match(request.input,/\[Paper 7, p\. 2\] Synthetic study/);assert.match(request.input,/120 participants/);
    assert.equal(request.env.OPENAI_API_KEY,undefined);assert.equal(request.env.CODEX_API_KEY,undefined);assert.equal(request.env.AWS_SECRET_ACCESS_KEY,undefined);
    assert.ok(request.args.includes('read-only'));assert.ok(request.args.includes('approval_policy="never"'));
    assert.ok(request.args.includes('web_search="disabled"'));assert.ok(request.args.includes('forced_login_method="chatgpt"'));
    assert.ok(request.args.includes('features.shell_tool=false'));assert.ok(request.args.includes('features.multi_agent=false'));assert.ok(request.args.includes('mcp_servers={}'));
    const cwd=request.args[request.args.indexOf('--cd')+1];
    assert.match(cwd,/papertrail-codex-question-/);await assert.rejects(()=>fs.stat(cwd),{code:'ENOENT'});
    // A second question starts fresh and works after the first process has exited.
    const next=[];await f.assistant.ask('Repeat the answer',sources,e=>next.push(e),new AbortController().signal);assert.equal(next.at(-1).type,'done');
  }finally{await f.close();}
});

test('Codex SDK failure, incomplete stream and attempted tool action never emit successful completion',async()=>{
  for(const [mode,message] of [['failed',/Fixture provider failure/],['incomplete',/before the answer completed/],['error',/Fixture stream failure/],['tool',/attempted a tool action/]]){
    const f=await fixture(mode);
    try{const events=[];await assert.rejects(()=>f.assistant.ask('Question',sources,e=>events.push(e),new AbortController().signal),message);assert.equal(events.some(e=>e.type==='done'),false);assert.equal(f.assistant.busy,false);}
    finally{await f.close();}
  }
});

test('Codex cancellation and shutdown stop an active SDK subprocess and release busy state',async()=>{
  const f=await fixture('wait');
  try{
    const abort=new AbortController();
    const running=f.assistant.ask('Question',sources,e=>{if(e.type==='text')abort.abort(new DOMException('Stop','AbortError'));},abort.signal);
    await assert.rejects(()=>f.assistant.ask('Concurrent question',sources,()=>{},new AbortController().signal),/already answering/);
    await assert.rejects(()=>running,{name:'AbortError'});assert.equal(f.assistant.busy,false);
    let started;const ready=new Promise(resolve=>{started=resolve;});
    const second=f.assistant.ask('Question',sources,()=>started(),new AbortController().signal);
    const rejected=assert.rejects(()=>second,{name:'AbortError'});
    await ready;await f.assistant.shutdown();await rejected;assert.equal(f.assistant.busy,false);
  }finally{await f.close();}
});

test('Codex status is cached, detects missing login, and never falls back to API-key authentication',async()=>{
  let calls=0;
  const assistant=new CodexAssistant({env:{PATH:process.env.PATH,OPENAI_API_KEY:'hidden'},runCommand:async(_exe,_args,options)=>{
    calls++;assert.equal(options.env.OPENAI_API_KEY,undefined);return {stdout:'Logged in using ChatGPT'};
  }});
  assert.equal((await assistant.refreshStatus()).configured,true);await assistant.refreshStatus();assert.equal(calls,1);await assistant.refreshStatus(true);assert.equal(calls,2);
  const apiOnly=new CodexAssistant({runCommand:async()=>({stdout:'Logged in using an API key'})});assert.equal((await apiOnly.refreshStatus()).configured,false);
  await assert.rejects(()=>apiOnly.ask('Question',sources,()=>{},new AbortController().signal),/Sign in with ChatGPT/);
  const missing=new CodexAssistant({runCommand:async()=>{throw Object.assign(new Error('missing'),{code:'ENOENT'});}});
  assert.match((await missing.refreshStatus()).message,/not found/);
  assert.deepEqual(codexEnvironment({HOME:'/home/example',OPENAI_API_KEY:'secret'}),{HOME:'/home/example'});
  assert.throws(()=>new CodexAssistant({env:{CODEX_TIMEOUT_MS:'NaN'}}),/CODEX_TIMEOUT_MS/);
});

test('Codex timeout stops the SDK subprocess with a useful error and no successful terminal event',async()=>{
  const f=await fixture('wait',{CODEX_TIMEOUT_MS:'1000'});
  try{
    const events=[];await assert.rejects(()=>f.assistant.ask('Question',sources,e=>events.push(e),new AbortController().signal),/Codex timed out/);
    assert.equal(events.some(e=>e.type==='done'),false);assert.equal(f.assistant.busy,false);
  }finally{await f.close();}
});

async function request(handler,url,data) {
  const req=Readable.from(data?[JSON.stringify(data)]:[]);Object.assign(req,{url,method:data?'POST':'GET',headers:{host:'127.0.0.1:3210'}});
  let output='';const res=new Writable({write(chunk,_enc,callback){output+=chunk;callback();}});
  res.setHeader=()=>{};res.writeHead=status=>{res.statusCode=status;res.headersSent=true;};
  await handler(req,res);return {status:res.statusCode,output,json:()=>JSON.parse(output)};
}

test('HTTP backend selection preserves OpenWorker default, supports Codex and rejects unknown/busy choices',async()=>{
  const calls=[];
  const openworker={configured:true,busy:false,ask:async(q,s,e)=>{calls.push('openworker');e({type:'done',text:'OpenWorker answer'});},shutdown:async()=>{}};
  const codex={configured:true,busy:false,refreshStatus:async()=>({id:'codex',configured:true,label:'Local Codex',message:'Signed in'}),ask:async(q,s,e)=>{calls.push('codex');assert.equal(s[0].id,7);e({type:'text',text:'Draft'});e({type:'done',text:'Codex answer'});},shutdown:async()=>{}};
  const service=new AssistantService('/tmp/unused',{openworker,codex,defaultBackend:'openworker'});
  const lib=new Library(':memory:');
  try{
    lib.db.prepare("INSERT INTO papers(id,path,root,title,mtime,size,pages,status) VALUES(7,'/tmp/study.pdf','/tmp','Study',0,0,1,'ready')").run();
    lib.db.prepare("INSERT INTO pages(paper_id,number,text) VALUES(7,1,'120 participants')").run();lib.db.prepare("INSERT INTO search(title,text,paper_id,page) VALUES('Study','120 participants',7,1)").run();
    const handler=createHandler(lib,service);
    const status=(await request(handler,'/api/status')).json();assert.equal(status.aiDefaultBackend,'openworker');assert.equal(status.aiBackends.length,2);
    assert.match((await request(handler,'/api/ask',{question:'participants'})).output,/OpenWorker answer/);
    assert.match((await request(handler,'/api/ask',{question:'participants',backend:'codex'})).output,/Codex answer/);
    assert.deepEqual(calls,['openworker','codex']);
    assert.equal((await request(handler,'/api/ask',{question:'participants',backend:'bad'})).status,400);
    openworker.busy=true;assert.equal((await request(handler,'/api/ask',{question:'participants',backend:'codex'})).status,409);openworker.busy=false;
    codex.configured=false;assert.equal((await request(handler,'/api/ask',{question:'participants',backend:'codex'})).status,400);
    assert.throws(()=>new AssistantService('/tmp/unused',{openworker,codex,defaultBackend:'bad'}),/supported assistant/);
  }finally{lib.db.close();await service.shutdown();}
});
