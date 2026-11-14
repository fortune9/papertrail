import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { PassThrough,Readable,Writable } from 'node:stream';
import { SettingsStore,PreferencesStore,validateSettings } from '../desktop/settings.js';
import { DesktopLogin,allowedSignInUrl } from '../desktop/login.js';
import { prepareLibraryImport,installLibraryImport } from '../desktop/library-import.js';
import { trustedDesktopSender,libraryPdfUrl } from '../desktop/security.js';
import { Library } from '../src/library.js';
import { createHandler } from '../src/server.js';

test('desktop settings keep API credentials out of public state and require secure persistence',async()=>{
  const dir=await fs.mkdtemp('/tmp/papertrail-settings-');
  let checks=0;
  const crypto={isAsyncEncryptionAvailable:async()=>{checks++;return true;},encryptStringAsync:async text=>Buffer.from('fixture:'+text),decryptStringAsync:async data=>({result:data.toString().slice(8)})};
  try{
    const store=new SettingsStore(dir,crypto);await store.load();assert.equal(checks,0); // Offline first launch does not initialize the keyring.
    const result=await store.save({model:'test-model',baseUrl:'https://api.openai.com/v1',api:'responses',apiKey:'unit-secret-key',rememberKey:true});
    assert.equal(result.hasApiKey,true);assert.equal(result.apiKey,undefined);assert.equal(JSON.stringify(result).includes('unit-secret-key'),false);
    assert.equal((await fs.readFile(path.join(dir,'settings.json'),'utf8')).includes('unit-secret-key'),false);
    const reloaded=new SettingsStore(dir,crypto);await reloaded.load();assert.equal(reloaded.environment().OPENAI_API_KEY,'unit-secret-key');
    await reloaded.save({model:'local-model',baseUrl:'http://127.0.0.1:11434/v1',api:'chat-completions',rememberKey:false});
    assert.equal(reloaded.environment().OPENAI_API_KEY,'unit-secret-key');assert.equal(JSON.parse(await fs.readFile(path.join(dir,'settings.json'),'utf8')).encryptedKey,undefined);
    const restarted=new SettingsStore(dir,crypto);await restarted.load();assert.equal(restarted.environment().OPENAI_API_KEY,'');
    const unavailable=new SettingsStore(dir,{...crypto,isAsyncEncryptionAvailable:async()=>false});
    await assert.rejects(()=>unavailable.save({model:'x',apiKey:'secret',rememberKey:true}),/keyring is unavailable/);
    await unavailable.save({model:'x',apiKey:'secret',rememberKey:false});assert.equal(unavailable.environment().OPENAI_API_KEY,'secret');
    await unavailable.save({model:'x',clearApiKey:true});assert.equal(unavailable.environment().OPENAI_API_KEY,'');
    assert.throws(()=>validateSettings({baseUrl:'https://secret@example.com/v1'}),/without credentials/);
    assert.throws(()=>validateSettings({baseUrl:'file:///tmp/config'}),/HTTP/);
    assert.throws(()=>validateSettings({model:{}}),/must be text/);
  }finally{await fs.rm(dir,{recursive:true,force:true});}
});

test('desktop preferences survive changing server origins and serialize concurrent writes',async()=>{
  const dir=await fs.mkdtemp('/tmp/papertrail-preferences-');
  try{
    const validate=input=>{if(!['codex','openworker'].includes(input.backend))throw new Error('Invalid backend');return {backend:input.backend};};
    const store=new PreferencesStore(dir,validate);await store.load();
    await Promise.all([store.save({backend:'openworker'}),store.save({backend:'codex'})]);
    const next=new PreferencesStore(dir,validate);assert.deepEqual(await next.load(),{backend:'codex'});
    await assert.rejects(()=>next.save({backend:'unknown'}),/Invalid/);
  }finally{await fs.rm(dir,{recursive:true,force:true});}
});

test('desktop sign-in uses structured Codex login, validates browser URLs and supports cancellation',async()=>{
  let child,spawnArgs;const opened=[],sent=[];
  const spawnProcess=(...args)=>{
    spawnArgs=args;child=new EventEmitter();child.stdout=new PassThrough();child.stderr=new PassThrough();child.stdin=new Writable({write(chunk,_encoding,callback){sent.push(JSON.parse(chunk.toString()));callback();}});child.kill=()=>{child.killed=true;};return child;
  };
  const login=new DesktopLogin('/bundled/codex',{HOME:'/home/test',OPENAI_API_KEY:'never-forwarded'},async url=>{opened.push(url);},{spawnProcess});
  try{
    assert.equal(login.start().running,true);assert.deepEqual(spawnArgs[1],['app-server','--stdio']);assert.equal(spawnArgs[2].env.OPENAI_API_KEY,undefined);
    child.stdout.write('{"id":0,"result":{}}\n');
    assert.ok(sent.some(message=>message.method==='initialize'));assert.ok(sent.some(message=>message.method==='account/login/start' && message.params.type==='chatgpt'));
    child.stdout.write('{"id":1,"result":{"type":"chatgpt","loginId":"one","authUrl":"https://auth.openai.com/oauth/');assert.equal(opened.length,0);
    child.stdout.write('authorize?state=fixture"}}\n');assert.equal(opened.length,1);assert.equal(login.status().url,opened[0]);
    child.stdout.write('{"method":"account/login/completed","params":{"loginId":"one","success":true}}\n');
    assert.equal(login.status().running,false);assert.match(login.status().message,/ready/);assert.equal(child.killed,true);assert.equal(login.status().url,undefined);
    login.start();child.stdout.write('{"id":0,"result":{}}\n');child.stdout.write('{"id":1,"result":{"type":"chatgpt","loginId":"two","authUrl":"https://evil.example/oauth"}}\n');
    assert.equal(login.status().running,false);assert.equal(opened.length,1);
    login.start();assert.equal(login.cancel().running,false);assert.equal(child.killed,true);
    assert.equal(allowedSignInUrl('https://auth.openai.com.evil.example/login'),false);assert.equal(allowedSignInUrl('https://user:pass@auth.openai.com/login'),false);assert.equal(allowedSignInUrl('file:///tmp/test'),false);
  }finally{login.cancel();}
});

test('library import snapshots a live WAL database without altering the original',async()=>{
  const dir=await fs.mkdtemp('/tmp/papertrail-import-'),source=path.join(dir,'source.sqlite'),destination=path.join(dir,'desktop');
  const sourceLibrary=new Library(source);
  try{
    sourceLibrary.db.prepare("INSERT INTO papers(id,path,root,title,mtime,size,pages,status) VALUES(7,'/papers/test.pdf','/papers','Preserved title',0,0,1,'ready')").run();
    sourceLibrary.db.prepare("INSERT INTO pages(paper_id,number,text) VALUES(7,1,'Original page evidence')").run();sourceLibrary.db.prepare("INSERT INTO search(title,text,paper_id,page) VALUES('Preserved title','Original page evidence',7,1)").run();
    const prepared=await prepareLibraryImport(source,destination);assert.equal(prepared.papers,1);
    const empty=new Library(path.join(destination,'library.sqlite'));empty.db.close();
    await installLibraryImport(prepared.staged,destination);
    const imported=new Library(path.join(destination,'library.sqlite'));
    try{assert.equal(imported.detail(7).title,'Preserved title');assert.equal(imported.search('evidence').total,1);assert.equal(imported.detail(7).content[0].text,'Original page evidence');}
    finally{imported.db.close();}
    assert.equal(sourceLibrary.detail(7).content[0].text,'Original page evidence');
    await assert.rejects(()=>prepareLibraryImport(path.join(destination,'library.sqlite'),destination),/already the desktop/);
    await fs.writeFile(path.join(dir,'invalid.sqlite'),'not a database');await assert.rejects(()=>prepareLibraryImport(path.join(dir,'invalid.sqlite'),destination));
  }finally{sourceLibrary.db.close();await fs.rm(dir,{recursive:true,force:true});}
});

test('desktop IPC trusts only the main application frame and PDF windows are constrained',()=>{
  const origin='http://127.0.0.1:4444',frame={url:origin+'/'};const contents={mainFrame:frame},window={webContents:contents};
  assert.equal(trustedDesktopSender({sender:contents,senderFrame:frame},window,origin),true);
  assert.equal(trustedDesktopSender({sender:contents,senderFrame:{url:origin+'/'}},window,origin),false);
  assert.equal(trustedDesktopSender({sender:{},senderFrame:frame},window,origin),false);
  frame.url='https://evil.example/';assert.equal(trustedDesktopSender({sender:contents,senderFrame:frame},window,origin),false);
  assert.equal(libraryPdfUrl(origin+'/api/papers/7/file#page=2',origin),true);assert.equal(libraryPdfUrl('file:///etc/passwd',origin),false);assert.equal(libraryPdfUrl(origin+'/api/import',origin),false);
});

test('desktop HTTP sessions require a private header and validate the assigned port',async()=>{
  const lib=new Library(':memory:');
  const handler=createHandler(lib,{configured:false},()=>4444,{token:'private-test-token'});
  async function invoke(headers){
    const req=Readable.from([]);Object.assign(req,{url:'/api/status',method:'GET',headers:{host:'127.0.0.1:4444',...headers}});
    let output='';const res=new Writable({write(chunk,_enc,callback){output+=chunk;callback();}});res.setHeader=()=>{};res.writeHead=status=>{res.statusCode=status;};
    await handler(req,res);return {status:res.statusCode,output};
  }
  try{
    assert.equal((await invoke({})).status,403);assert.equal((await invoke({'x-papertrail-token':'wrong'})).status,403);
    const accepted=await invoke({'x-papertrail-token':'private-test-token'});assert.equal(accepted.status,200);assert.equal(accepted.output.includes('private-test-token'),false);
    assert.equal((await invoke({host:'127.0.0.1:5555','x-papertrail-token':'private-test-token'})).status,403);
  }finally{lib.db.close();}
});
