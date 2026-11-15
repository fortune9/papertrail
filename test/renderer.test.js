import test from 'node:test';
import assert from 'node:assert/strict';
import {promises as fs} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {Readable,Writable} from 'node:stream';
import {Library} from '../src/library.js';
import {createHandler} from '../src/server.js';
import {appendHighlighted} from '../public/highlight.js';

async function desktopRenderer(library,{prefix=false}={}){
  const html=await fs.readFile(new URL('../public/index.html',import.meta.url),'utf8');
  const source=await fs.readFile(new URL('../public/app.js',import.meta.url),'utf8');
  const nodes=new Map(),timeouts=[];let document;
  class Node {
    constructor(tag='div'){this.tagName=tag.toUpperCase();this.children=[];this._text='';this.value='';this.checked=false;this.ownerDocument=document;this.hidden=false;}
    get textContent(){return this._text+this.children.map(child=>child.textContent).join('');}
    set textContent(value){this._text=String(value);this.children=[];}
    append(...children){this.children.push(...children);}
    replaceChildren(...children){this.children=children;this._text='';}
    querySelectorAll(selector){return fields.filter(field=>selector!=='input:checked' || field.checked);}
    click(){return this.onclick?.({});}
    focus(){}
  }
  document={createElement:tag=>new Node(tag),createTextNode:text=>{const node=new Node('#text');node.textContent=text;return node;},getElementById:id=>nodes.get(id),addEventListener(){},activeElement:{tagName:'BODY'}};
  for(const match of html.matchAll(/<([\w-]+)\b[^>]*\bid="([^"]+)"[^>]*>/g)){
    const node=new Node(match[1]);node.checked=/\bchecked\b/.test(match[0]);nodes.set(match[2],node);
  }
  const fields=['title','abstract','authors','text'].map(value=>{const node=new Node('input');node.value=value;node.checked=['title','text'].includes(value);return node;});
  document.querySelectorAll=()=>[nodes.get('case-insensitive'),nodes.get('fuzzy'),nodes.get('prefix'),...fields];
  nodes.get('assistant-backend').value='openworker';
  const storage=new Map(),requests=[],handler=createHandler(library,{configured:false});
  let releaseOld;
  const fetch=async url=>{
    const parsed=new URL(url,'http://127.0.0.1:3210');requests.push(parsed);
    if(parsed.searchParams.get('q')==='perfo' && parsed.searchParams.get('prefix')!=='true')await new Promise(resolve=>{releaseOld=resolve;});
    const req=Readable.from([]);Object.assign(req,{url,method:'GET',headers:{host:'127.0.0.1:3210'}});
    let body='';const res=new Writable({write(chunk,_encoding,callback){body+=chunk;callback();}});res.setHeader=()=>{};res.writeHead=status=>{res.statusCode=status;};await handler(req,res);
    return {ok:res.statusCode===200,json:async()=>JSON.parse(body)};
  };
  const tools={tools:{codex:{installed:false,version:'0.169.0'},openworker:{installed:false,version:'0.1.0-beta.3'}},job:{running:false}};
  const bridge={getPreferences:async()=>({backend:'codex',searchOptions:{fields:['title'],caseInsensitive:true,fuzzy:false,prefix}}),savePreferences:async()=>{},getTools:async()=>tools,onCommand(){}};
  await runInNewContext('(async()=>{'+source.replace(/^import .*?;\n/,'')+'\n})()',{
    document,window:{papertrailDesktop:bridge},localStorage:{getItem:key=>storage.get(key) || null,setItem:(key,value)=>storage.set(key,value)},
    appendHighlighted,URLSearchParams,AbortController,fetch,setTimeout:callback=>{timeouts.push(callback);return timeouts.length;},clearTimeout(){},setInterval(){},clearInterval(){}
  });
  const settle=()=>new Promise(resolve=>setImmediate(resolve));
  return {nodes,fields,requests,settle,releaseOld:()=>releaseOld(),type:async value=>{nodes.get('search').value=value;nodes.get('search').oninput();timeouts.pop()();await settle();}};
}

test('actual desktop renderer sends title/case options and renders an opening-word match, ignoring an older response',async()=>{
  const library=new Library(':memory:');
  const title='Performance and safety of a multi-cancer early detection test';
  try{
    library.db.prepare("INSERT INTO papers(id,path,root,title,mtime,size,pages,status) VALUES(1,'/papers/study.pdf','/papers',?,0,0,1,'ready')").run(title);
    library.db.prepare("INSERT INTO pages(paper_id,number,text) VALUES(1,1,'Study methods')").run();
    library.db.prepare("INSERT INTO search(title,text,paper_id,page) VALUES(?,'Study methods',1,1)").run(title);
    const renderer=await desktopRenderer(library);
    assert.equal(renderer.nodes.get('case-insensitive').checked,true);assert.equal(renderer.fields[0].checked,true);
    await renderer.type('perfo');await renderer.type('performance');
    const request=renderer.requests.findLast(url=>url.pathname==='/api/search');
    assert.equal(request.searchParams.get('q'),'performance');assert.equal(request.searchParams.get('caseInsensitive'),'true');assert.equal(request.searchParams.get('fields'),'title');
    assert.equal(renderer.nodes.get('results-count').textContent,'1 papers');
    const card=renderer.nodes.get('results').children[0],button=card.children[1].children[0];
    assert.equal(button.textContent,title);assert.equal(button.children[0].tagName,'MARK');assert.equal(button.children[0].textContent,'Performance');
    renderer.releaseOld();await renderer.settle();
    assert.equal(renderer.nodes.get('results-count').textContent,'1 papers');
    assert.equal(renderer.nodes.get('results').children[0].children[1].children[0].textContent,title);
  }finally{library.db.close();}
});

test('desktop restores prefix search and keeps the title visible as a partial word is typed',async()=>{
  const library=new Library(':memory:'),title='Performance and safety of a multi-cancer early detection test';
  try{
    library.db.prepare("INSERT INTO papers(id,path,root,title,mtime,size,pages,status) VALUES(1,'/papers/study.pdf','/papers',?,0,0,1,'ready')").run(title);
    library.db.prepare("INSERT INTO pages(paper_id,number,text) VALUES(1,1,'Study methods')").run();
    library.db.prepare("INSERT INTO search(title,text,paper_id,page) VALUES(?,'Study methods',1,1)").run(title);
    const renderer=await desktopRenderer(library,{prefix:true});assert.equal(renderer.nodes.get('prefix').checked,true);
    for(const query of ['p','pe','per','perf','perfo','perform','performance']){
      await renderer.type(query);
      assert.equal(renderer.nodes.get('results-count').textContent,'1 papers',query);
      assert.equal(renderer.requests.findLast(url=>url.pathname==='/api/search').searchParams.get('prefix'),'true');
      assert.equal(renderer.nodes.get('results').children[0].children[1].children[0].textContent,title);
    }
    renderer.nodes.get('prefix').checked=false;renderer.nodes.get('prefix').onchange();await renderer.settle();
    await renderer.type('perf');assert.equal(renderer.nodes.get('results-count').textContent,'0 papers');
    renderer.nodes.get('prefix').checked=true;renderer.nodes.get('prefix').onchange();await renderer.settle();
    assert.equal(renderer.nodes.get('results-count').textContent,'1 papers');
  }finally{library.db.close();}
});


test('desktop renderer sends quotes intact and renders phrase-only matches',async()=>{
  const library=new Library(':memory:');
  try{
    for(const [id,title]of [[1,'Foundational model for detection'],[2,'Foundational methods for a model']]){
      library.db.prepare("INSERT INTO papers(id,path,root,title,mtime,size,pages,status) VALUES(?,?,'/papers',?,0,0,1,'ready')").run(id,`/papers/${id}.pdf`,title);
      library.db.prepare("INSERT INTO search(title,text,paper_id,page) VALUES(?,'Study methods',?,1)").run(title,id);
    }
    const renderer=await desktopRenderer(library,{prefix:true});
    await renderer.type('foundational model');assert.equal(renderer.nodes.get('results-count').textContent,'2 papers');
    await renderer.type('"foundational model"');assert.equal(renderer.nodes.get('results-count').textContent,'1 papers');
    assert.equal(renderer.requests.findLast(url=>url.pathname==='/api/search').searchParams.get('q'),'"foundational model"');
    const button=renderer.nodes.get('results').children[0].children[1].children[0];
    assert.equal(button.children[0].textContent,'Foundational model');assert.equal(button.textContent,'Foundational model for detection');
  }finally{library.db.close();}
});
