import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { Writable, Readable } from 'node:stream';
import { Library } from '../src/library.js';
import { createHandler } from '../src/server.js';
import { Assistant } from '../src/assistant.js';
import { DatabaseSync } from 'node:sqlite';
import { extractMetadata } from '../src/metadata.js';

function pdf(pages) {
  const objects = ['<< /Type /Catalog /Pages 2 0 R >>', `<< /Type /Pages /Count ${pages.length} /Kids [${pages.map((_,i)=>`${4+i*2} 0 R`).join(' ')}] >>`, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'];
  for(const [i,text] of pages.entries()) {
    const stream=`BT /F1 12 Tf 40 700 Td (${text.replace(/[()\\]/g,'\\$&')}) Tj ET`;
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${5+i*2} 0 R >>`, `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
  }
  let out='%PDF-1.4\n'; const offsets=[0];
  objects.forEach((object,i)=>{offsets.push(out.length);out+=`${i+1} 0 obj\n${object}\nendobj\n`;});
  const xref=out.length;out+=`xref\n0 ${objects.length+1}\n0000000000 65535 f \n`;
  out+=offsets.slice(1).map(offset=>`${String(offset).padStart(10,'0')} 00000 n \n`).join('');
  return out+`trailer\n<< /Size ${objects.length+1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
}
async function imported(lib, folder) { await lib.startImport(folder); while(lib.job.running)await new Promise(r=>setTimeout(r,10)); }
async function request(handler,url,{method='GET',data,host='127.0.0.1:3210',origin}={}) {
  const req=Readable.from(data?[JSON.stringify(data)]:[]); Object.assign(req,{url,method,headers:{host,...(origin?{origin}:{})}});
  let output='';const res=new Writable({write(chunk,_,cb){output+=chunk;cb();}});
  res.headers={};res.setHeader=(k,v)=>res.headers[k]=v;res.writeHead=(status,headers)=>{res.statusCode=status;res.headersSent=true;Object.assign(res.headers,headers);};
  await handler(req,res);return {status:res.statusCode,headers:res.headers,output,json:()=>JSON.parse(output)};
}

test('recursive import, page retrieval, failure isolation, incremental updates and persistence',async()=>{
  const dir=await fs.mkdtemp('/tmp/papertrail-test-');const root=path.join(dir,'papers');await fs.mkdir(path.join(root,'nested'),{recursive:true});
  const database=path.join(dir,'library.sqlite');let lib=new Library(database);
  try {
    const first=path.join(root,'nested','Cancer methylation.PDF');
    await fs.writeFile(first,pdf(['Introduction to liquid biopsy','Distinctive methylation biomarker evidence']));
    await fs.writeFile(path.join(root,'blank.pdf'),pdf(['']));
    await fs.writeFile(path.join(root,'broken.pdf'),'invalid PDF');
    await fs.writeFile(path.join(dir,'outside.pdf'),pdf(['external-secret']));
    await fs.symlink(path.join(dir,'outside.pdf'),path.join(root,'link.pdf'));
    await imported(lib,root);
    assert.equal(lib.stats().total,3);assert.equal(lib.stats().ready,1);assert.equal(lib.stats().scanned,1);assert.equal(lib.stats().errors,1);
    const result=lib.search('Distinctive');assert.equal(result.total,1);assert.equal(result.papers[0].match_page,2);assert.match(result.papers[0].snippet,/biomarker/);
    assert.equal(lib.detail(result.papers[0].id).content.length,2);
    assert.equal(lib.search('external-secret').total,0);assert.equal(lib.search('" OR * --').total,0);
    await imported(lib,root);assert.equal(lib.job.unchanged,2);assert.equal(lib.job.failed,1);
    await fs.writeFile(first,pdf(['A revised replacement result']));await imported(lib,root);
    assert.equal(lib.search('Distinctive').total,0);assert.equal(lib.search('replacement').total,1);
    lib.db.close();lib=new Library(database);assert.equal(lib.search('replacement').total,1);
    await fs.unlink(first);await imported(lib,root);assert.equal(lib.job.removed,1);assert.equal(lib.search('replacement').total,0);
    await assert.rejects(()=>lib.startImport(path.join(root,'missing')));
    await lib.startImport(root);lib.job.cancelled=true;while(lib.job.running)await new Promise(r=>setTimeout(r,10));assert.equal(lib.job.removed,0);
  }finally{lib.db.close();await fs.rm(dir,{recursive:true,force:true});}
});

test('HTTP handlers enforce local origin, serve UI, validate input and stream terminal answers',async()=>{
  const lib=new Library(':memory:');
  const assistant={configured:false};const handler=createHandler(lib,assistant);
  try {
    assert.equal((await request(handler,'/api/status')).json().total,0);
    assert.equal((await request(handler,'/api/status',{host:'evil.example:3210'})).status,403);
    assert.equal((await request(handler,'/api/import',{method:'POST',origin:'https://evil.example',data:{folder:'/tmp'}})).status,403);
    assert.equal((await request(handler,'/api/import',{method:'POST',data:{folder:1}})).status,400);
    assert.equal((await request(handler,'/api/papers/999')).status,404);
    assert.equal((await request(handler,'/api/ask',{method:'POST',data:{question:'test'}})).status,400);
    const ui=await request(handler,'/');assert.equal(ui.status,200);assert.match(ui.output,/Your research, within reach/);assert.match(ui.headers['Content-Security-Policy'],/script-src 'self'/);
    const highlighter=await request(handler,'/highlight.js');assert.equal(highlighter.status,200);assert.equal(highlighter.headers['Content-Type'],'text/javascript');
    assert.equal((await request(handler,'/../../.env')).status,404);
    lib.db.prepare("INSERT INTO papers(path,root,title,mtime,size,pages,status) VALUES('/tmp/test.pdf','/tmp','Cancer',0,0,1,'ready')").run();
    lib.db.prepare("INSERT INTO pages(paper_id,number,text) VALUES(1,1,'Methylation evidence')").run();
    lib.db.prepare("INSERT INTO search(title,text,paper_id,page) VALUES('Cancer','Methylation evidence',1,1)").run();
    assistant.configured=true;assistant.ask=async(q,sources,emit)=>{assert.match(sources[0].excerpt,/evidence/);emit({type:'text',text:'Reading'});emit({type:'done',text:'Supported [Paper 1, p. 1]'});};
    const streamed=await request(handler,'/api/ask',{method:'POST',data:{question:'Methylation'}});
    const events=streamed.output.trim().split('\n').map(JSON.parse);assert.deepEqual(events.map(e=>e.type),['sources','text','done']);
    assistant.ask=async()=>{throw new Error('Fixture provider failed');};
    assert.match((await request(handler,'/api/ask',{method:'POST',data:{question:'Methylation'}})).output,/Fixture provider failed/);
  }finally{lib.db.close();}
});

test('assistant reconciles streamed output, detects failed terminal status and cancels',async()=>{
  const assistant=new Assistant('/tmp/unused');Object.defineProperty(assistant,'configured',{value:true});
  let cancelled=false,status='completed';
  const session={cancel:async()=>{cancelled=true;},send:async()=>({async *events(){yield {text:'draft'};},result:async()=>({status,finalOutput:'Final answer'})})};
  assistant.open=async()=>({agent:{newSession:async()=>session},AttemptOutput:class{ text='';apply(e){this.text=e.text;}interrupt(){} }});
  let events=[];await assistant.ask('Question',[],e=>events.push(e),new AbortController().signal);assert.equal(events.at(-1).text,'Final answer');assert.equal(assistant.busy,false);
  status='failed';await assert.rejects(()=>assistant.ask('Question',[],()=>{},new AbortController().signal),/failed/);assert.equal(assistant.busy,false);
  const abort=new AbortController();status='completed';await assistant.ask('Question',[],()=>abort.abort(),abort.signal);assert.equal(cancelled,true);
});

test('whole-word retrieval excludes related stems and prefixes, including after legacy migration',async()=>{
  const dir=await fs.mkdtemp('/tmp/papertrail-search-');
  const database=path.join(dir,'legacy.sqlite');
  let lib;
  const legacy=new DatabaseSync(database);
  try {
    // Reproduce the original index, with fixed IDs and page numbers to test preservation.
    legacy.exec(`CREATE TABLE roots(path TEXT PRIMARY KEY);
      CREATE TABLE papers(id INTEGER PRIMARY KEY, path TEXT UNIQUE NOT NULL, root TEXT NOT NULL,
        title TEXT NOT NULL, mtime REAL NOT NULL, size INTEGER NOT NULL, pages INTEGER NOT NULL,
        status TEXT NOT NULL, error TEXT, indexed TEXT DEFAULT CURRENT_TIMESTAMP);
      CREATE TABLE pages(id INTEGER PRIMARY KEY, paper_id INTEGER REFERENCES papers(id) ON DELETE CASCADE,
        number INTEGER NOT NULL, text TEXT NOT NULL);
      CREATE VIRTUAL TABLE search USING fts5(title,text,paper_id UNINDEXED,page UNINDEXED,tokenize='porter unicode61');`);
    const insert=(id,title,text,page=1,status='ready')=>{
      legacy.prepare('INSERT INTO papers(id,path,root,title,mtime,size,pages,status) VALUES(?,?,?,?,?,?,?,?)').run(id,`/missing/${id}.pdf`,'/missing',title,123,456,text?1:0,status);
      if(text)legacy.prepare('INSERT INTO pages(paper_id,number,text) VALUES(?,?,?)').run(id,page,text);
      legacy.prepare('INSERT INTO search VALUES(?,?,?,?)').run(title,text,id,page);
    };
    insert(11,'Liquid biopsy in cancer current status challenges','Proteins promote the transformation, invasion, and proliferation of tumor cells.',10);
    insert(22,'DNA model','A Transformer-based architecture for methylation.',2);
    insert(33,'Other review','Transformed cells and transformative treatments.');
    insert(44,'Plural model','Several transformers support inference.');
    insert(55,'Transformer notes','No extractable text',1,'error');
    insert(66,'Blank scan','',1,'no-text');
    assert.equal(legacy.prepare("SELECT count(*) n FROM search WHERE search MATCH 'transformer'").get().n,5);
    const before=legacy.prepare('SELECT * FROM papers ORDER BY id').all();
    const pagesBefore=legacy.prepare('SELECT * FROM pages ORDER BY id').all();
    legacy.close();lib=new Library(database);
    assert.equal(lib.db.prepare('PRAGMA user_version').get().user_version,2);
    assert.deepEqual(lib.db.prepare('SELECT * FROM papers ORDER BY id').all().map(row=>Object.fromEntries(Object.keys(before[0]).map(key=>[key,row[key]]))),before.map(row=>({...row})));
    assert.deepEqual(lib.db.prepare('SELECT * FROM pages ORDER BY id').all(),pagesBefore);
    assert.deepEqual(lib.search('transformer').papers.map(p=>p.id).sort((a,b)=>a-b),[22,55]);
    assert.deepEqual(lib.search('TRANSFORMER').papers.map(p=>p.id).sort((a,b)=>a-b),[22,55]);
    assert.equal(lib.search('transformation').papers[0].id,11);
    assert.equal(lib.search('transformed').papers[0].id,33);
    assert.equal(lib.search('transformers').papers[0].id,44);
    assert.equal(lib.search('trans').total,0);
    assert.equal(lib.search('transformer').papers.find(p=>p.id===22).match_page,2);
    assert.match(lib.search('transformer').papers.find(p=>p.id===22).snippet,/Transformer-based/);
    assert.equal(lib.search('blank').papers[0].id,66); // Preserve title-only entries.
    const handler=createHandler(lib,{configured:false});
    const response=await request(handler,'/api/search?q=transformer');
    assert.equal(response.status,200);assert.equal(response.json().papers.some(p=>p.id===11),false);
    lib.db.close();lib=new Library(database);
    assert.equal(lib.search('transformer').total,2); // Migration does not repeat or duplicate rows.
    assert.equal(lib.db.prepare('SELECT count(*) n FROM search').get().n,6);
  }finally{lib?.db.close();if(legacy.isOpen)legacy.close();await fs.rm(dir,{recursive:true,force:true});}
});

test('field scopes, case controls, fuzzy typos and metadata corrections work through the API',async()=>{
  const dir=await fs.mkdtemp('/tmp/papertrail-options-');
  const lib=new Library(path.join(dir,'library.sqlite'));
  try{
    const root=path.join(dir,'papers');await fs.mkdir(root);
    const file=path.join(root,'Transformer methods.pdf');
    await fs.writeFile(file,pdf(['Alice Smith, Bob Jones','Abstract: Methylation evidence.\nIntroduction\nBodyonly marker.']));
    await imported(lib,root);
    const id=lib.search('Transformer').papers[0].id;
    lib.updateMetadata(id,{authors:'Alice Smith; Bob Jones',abstract:'Distinctive methylation abstractmarker'});
    assert.equal(lib.search('Alice',40,0,{fields:['title']}).total,0);
    assert.equal(lib.search('Alice',40,0,{fields:['authors']}).total,1);
    assert.equal(lib.search('abstractmarker',40,0,{fields:['text']}).total,0);
    const abstract=lib.search('abstractmarker',40,0,{fields:['abstract']});assert.equal(abstract.total,1);assert.deepEqual(abstract.papers[0].matched_fields,['abstract']);assert.match(abstract.papers[0].snippet,/abstractmarker/);
    assert.equal(lib.search('bodyonly',40,0,{fields:['abstract']}).total,0);
    assert.equal(lib.search('Transformer',40,0,{fields:['title'],caseInsensitive:false}).total,1);
    assert.equal(lib.search('transformer',40,0,{fields:['title'],caseInsensitive:false}).total,0);
    assert.equal(lib.search('transformer',40,0,{fields:['title'],caseInsensitive:true}).total,1);
    assert.equal(lib.search('transfomer',40,0,{fields:['title']}).total,0);
    for(const q of ['transfomer','tranformer','transfromer','transformerx','transforner'])assert.equal(lib.search(q,40,0,{fields:['title'],fuzzy:true}).total,1,q);
    assert.equal(lib.search('Transformer',40,0,{fields:['title'],caseInsensitive:false,fuzzy:true}).total,1);
    assert.equal(lib.search('transformer',40,0,{fields:['title'],caseInsensitive:false,fuzzy:true}).total,0);
    assert.equal(lib.search('Alic',40,0,{fields:['authors'],fuzzy:true}).total,0); // Short words stay exact.
    assert.equal(lib.search('Bob',40,0,{fields:[]}).total,0);
    assert.equal(lib.search('',40,0,{fields:[]}).total,0);
    assert.throws(()=>lib.search('test',40,0,{fields:['unknown']}),/Invalid/);
    const handler=createHandler(lib,{configured:false});
    assert.equal((await request(handler,'/api/search?q=transfomer&fields=title&fuzzy=true')).json().total,1);
    assert.equal((await request(handler,'/api/search?q=transformer&fields=title&caseInsensitive=false')).json().total,0);
    assert.equal((await request(handler,'/api/search?q=Alice&fields=authors')).json().total,1);
    const highlighted=(await request(handler,'/api/search?q=Alice&fields=authors')).json().papers[0];
    assert.equal(highlighted.snippet.slice(highlighted.highlights.snippet[0].start,highlighted.highlights.snippet[0].end),'Alice');
    assert.deepEqual(highlighted.highlights.title,[]);
    assert.equal((await request(handler,'/api/search?q=Alice&fields=unknown')).status,400);
    assert.equal((await request(handler,'/api/search?q=Alice&fuzzy=maybe')).status,400);
    assert.equal((await request(handler,`/api/papers/${id}/metadata`,{method:'POST',data:{authors:3,abstract:''}})).status,400);
    assert.equal((await request(handler,`/api/papers/${id}/metadata`,{method:'POST',data:{authors:'Carol Brown',abstract:'Corrected abstractmarker'}})).status,200);
    assert.equal(lib.search('Alice',40,0,{fields:['authors']}).total,0);
    assert.equal(lib.search('Carol',40,0,{fields:['authors']}).total,1);
    await fs.writeFile(file,pdf(['Completely revised PDF contents']));await imported(lib,root);
    assert.equal(lib.detail(id).authors,'Carol Brown');assert.equal(lib.detail(id).abstract,'Corrected abstractmarker');
    assert.equal(lib.search('Carol',40,0,{fields:['authors']}).total,1);
    // The assistant must honor field selection as well, rather than silently expanding scope.
    const assistantHandler=createHandler(lib,{configured:true,ask:async()=>{throw new Error('Should not be called');}});
    const rejected=await request(assistantHandler,'/api/ask',{method:'POST',data:{question:'Carol',options:{fields:['title']}}});
    assert.equal(rejected.status,400);assert.match(rejected.json().error,/No relevant text/);
  }finally{lib.db.close();await fs.rm(dir,{recursive:true,force:true});}
});

test('version 1 databases backfill detected metadata without rereading PDFs or changing page rows',async()=>{
  const dir=await fs.mkdtemp('/tmp/papertrail-v1-'),database=path.join(dir,'library.sqlite');
  let lib=new Library(database);
  try{
    lib.db.prepare("INSERT INTO papers(id,path,root,title,mtime,size,pages,status) VALUES(42,'/not-present/paper.pdf','/not-present','Study',123,456,1,'ready')").run();
    lib.db.prepare('INSERT INTO pages(paper_id,number,text) VALUES(42,1,?)').run('Alice Smith, Bob Jones\n\nAbstract\nMethylation discovery.\nKeywords: biology\nIntroduction\nOther text.');
    const pagesBefore=lib.detail(42).content;
    lib.db.exec(`DROP TABLE search_vocab; DROP TABLE search;
      CREATE VIRTUAL TABLE search USING fts5(title,text,paper_id UNINDEXED,page UNINDEXED,tokenize='unicode61 remove_diacritics 0');
      ALTER TABLE papers DROP COLUMN abstract; ALTER TABLE papers DROP COLUMN authors;
      ALTER TABLE papers DROP COLUMN abstract_page; ALTER TABLE papers DROP COLUMN authors_page; ALTER TABLE papers DROP COLUMN metadata_edited;
      PRAGMA user_version=1;`);
    lib.db.close();lib=new Library(database);
    assert.equal(lib.db.prepare('PRAGMA user_version').get().user_version,2);
    assert.deepEqual(lib.detail(42).content,pagesBefore);
    assert.equal(lib.search('Alice',40,0,{fields:['authors']}).papers[0].id,42);
    assert.equal(lib.search('discovery',40,0,{fields:['abstract']}).papers[0].id,42);
    assert.equal(lib.search('Other',40,0,{fields:['abstract']}).total,0);
    lib.db.close();lib=new Library(database);assert.equal(lib.search('Alice',40,0,{fields:['authors']}).total,1);
    const missing=extractMetadata([{number:1,text:'A title\nThis document has no labeled metadata.'}]);assert.equal(missing.abstract,'');assert.equal(missing.authors,'');
  }finally{lib.db.close();await fs.rm(dir,{recursive:true,force:true});}
});
