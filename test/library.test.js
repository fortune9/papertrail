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
import { titleFromLayout, titleFromText } from '../src/titles.js';

function pdf(pages, title) {
  const objects = ['<< /Type /Catalog /Pages 2 0 R >>', `<< /Type /Pages /Count ${pages.length} /Kids [${pages.map((_,i)=>`${4+i*2} 0 R`).join(' ')}] >>`, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'];
  for(const [i,text] of pages.entries()) {
    const stream=`BT /F1 12 Tf 40 700 Td (${text.replace(/[()\\]/g,'\\$&')}) Tj ET`;
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${5+i*2} 0 R >>`, `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
  }
  let info='';
  if(title!==undefined){objects.push(`<< /Title (${title.replace(/[()\\]/g,'\\$&')}) >>`);info=` /Info ${objects.length} 0 R`;}
  let out='%PDF-1.4\n'; const offsets=[0];
  objects.forEach((object,i)=>{offsets.push(out.length);out+=`${i+1} 0 obj\n${object}\nendobj\n`;});
  const xref=out.length;out+=`xref\n0 ${objects.length+1}\n0000000000 65535 f \n`;
  out+=offsets.slice(1).map(offset=>`${String(offset).padStart(10,'0')} 00000 n \n`).join('');
  return out+`trailer\n<< /Size ${objects.length+1} /Root 1 0 R${info} >>\nstartxref\n${xref}\n%%EOF\n`;
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
    assert.equal(lib.db.prepare('PRAGMA user_version').get().user_version,3);
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
    await fs.writeFile(file,pdf(['Transformer methods','Alice Smith, Bob Jones','Abstract: Methylation evidence.\nIntroduction\nBodyonly marker.']));
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
      ALTER TABLE papers DROP COLUMN title_source; ALTER TABLE papers DROP COLUMN title_page; ALTER TABLE papers DROP COLUMN title_version;
      PRAGMA user_version=1;`);
    lib.db.close();lib=new Library(database);
    assert.equal(lib.db.prepare('PRAGMA user_version').get().user_version,3);
    assert.deepEqual(lib.detail(42).content,pagesBefore);
    assert.equal(lib.search('Alice',40,0,{fields:['authors']}).papers[0].id,42);
    assert.equal(lib.search('discovery',40,0,{fields:['abstract']}).papers[0].id,42);
    assert.equal(lib.search('Other',40,0,{fields:['abstract']}).total,0);
    lib.db.close();lib=new Library(database);assert.equal(lib.search('Alice',40,0,{fields:['authors']}).total,1);
    const missing=extractMetadata([{number:1,text:'A title\nThis document has no labeled metadata.'}]);assert.equal(missing.abstract,'');assert.equal(missing.authors,'');
  }finally{lib.db.close();await fs.rm(dir,{recursive:true,force:true});}
});

test('titles come from PDF contents and corrected titles survive import and version-2 migration',async()=>{
  const dir=await fs.mkdtemp('/tmp/papertrail-titles-'),root=path.join(dir,'papers'),database=path.join(dir,'library.sqlite');
  let lib=new Library(database);
  try{
    await fs.mkdir(root);
    const file=path.join(root,'misleading-download-name.pdf');
    await fs.writeFile(file,pdf(['Actual Scientific Paper Title','Alice Smith, Bob Jones'],'Actual Scientific Paper Title'));
    await fs.writeFile(path.join(root,'another-wrong-name.pdf'),pdf(['Visible Title Without Metadata'],'Microsoft Word draft.docx'));
    await fs.writeFile(path.join(root,'scanned-title.pdf'),pdf(['']));
    await imported(lib,root);
    const paper=lib.db.prepare('SELECT * FROM papers WHERE path=?').get(file);
    assert.equal(paper.title,'Actual Scientific Paper Title');assert.equal(paper.title_source,'pdf-metadata');
    assert.equal(lib.search('misleading',40,0,{fields:['title']}).total,0);
    const second=lib.db.prepare('SELECT * FROM papers WHERE path=?').get(path.join(root,'another-wrong-name.pdf'));
    assert.equal(second.title,'Visible Title Without Metadata');assert.equal(second.title_source,'pdf-layout');
    assert.equal(lib.db.prepare('SELECT title FROM papers WHERE path=?').get(path.join(root,'scanned-title.pdf')).title,'Untitled paper');
    const before=lib.detail(paper.id).content;
    lib.updateMetadata(paper.id,{authors:'Corrected Author',abstract:'Saved abstract'});
    // Reproduce the immediately previous schema and filename-derived title.
    lib.db.prepare('UPDATE papers SET title=? WHERE id=?').run('misleading download name',paper.id);lib.indexMetadata(paper.id);
    lib.db.exec('ALTER TABLE papers DROP COLUMN title_source; ALTER TABLE papers DROP COLUMN title_page; ALTER TABLE papers DROP COLUMN title_version; PRAGMA user_version=2;');
    lib.db.close();lib=new Library(database);
    assert.equal(lib.db.prepare('PRAGMA user_version').get().user_version,3);
    assert.equal(lib.detail(paper.id).title_source,'legacy');
    await imported(lib,root);assert.equal(lib.job.indexed,3);
    assert.deepEqual(lib.detail(paper.id).content,before);
    assert.equal(lib.detail(paper.id).title,'Actual Scientific Paper Title');assert.equal(lib.detail(paper.id).authors,'Corrected Author');
    assert.equal(lib.search('misleading',40,0,{fields:['title']}).total,0);
    await imported(lib,root);assert.equal(lib.job.unchanged,3);
    const handler=createHandler(lib,{configured:false});
    const result=await request(handler,`/api/papers/${paper.id}/metadata`,{method:'POST',data:{title:'Manually corrected title',authors:'Corrected Author',abstract:'Saved abstract'}});
    assert.equal(result.status,200);assert.equal(result.json().title_source,'manual');
    assert.equal(lib.search('Manually',40,0,{fields:['title']}).total,1);
    assert.equal((await request(handler,`/api/papers/${paper.id}/metadata`,{method:'POST',data:{title:' ',authors:'',abstract:''}})).status,400);
    await fs.writeFile(file,pdf(['A new title in the revised PDF'],'A new title in the revised PDF'));await imported(lib,root);
    assert.equal(lib.detail(paper.id).title,'Manually corrected title');assert.equal(lib.detail(paper.id).abstract,'Saved abstract');
    lib.db.close();lib=new Library(database);assert.equal(lib.detail(paper.id).title,'Manually corrected title');
  }finally{lib.db.close();await fs.rm(dir,{recursive:true,force:true});}
});

test('title layout rejects headers, joins multiline titles and decodes embedded entities safely',()=>{
  const xml=`<html><head><title>Unrelated metadata draft.docx</title></head><body><page height="800">
    <block yMin="10"><word yMin="10" yMax="90">www.publisher.org</word></block>
    <block yMin="50"><word yMin="50" yMax="90">REVIEW</word></block>
    <block yMin="100"><line><word yMin="100" yMax="122">DNA &amp; Cancer:</word></line><line><word yMin="124" yMax="146">New Perspectives</word></line></block>
    <block yMin="200"><word yMin="200" yMax="210">Body paragraph about the research.</word></block>
    </page></body></html>`;
  assert.equal(titleFromLayout(xml).title,'DNA & Cancer: New Perspectives');
  assert.equal(titleFromLayout(xml.replace('Unrelated metadata draft.docx','DNA &amp; Cancer: New Perspectives')).title_source,'pdf-metadata');
  assert.equal(titleFromLayout('<html><title>Misleading metadata</title></html>'),null);
  assert.equal(titleFromText([{number:1,text:'www.publisher.org\n\nA Real Opening Title\nAlice Smith, Bob Jones\n\nAbstract\nText'}]).title,'A Real Opening Title');
  assert.equal(titleFromText([{number:1,text:''}]).title,'Untitled paper');
  const repeated=`<html><title></title><page height="800"><block yMin="50"><word yMin="50" yMax="95">Think again</word></block><block yMin="100"><word yMin="100" yMax="122">A Real Article Title</word></block></page><page height="800"><block yMin="50"><word yMin="50" yMax="95">Think again</word></block></page></html>`;
  assert.equal(titleFromLayout(repeated).title,'A Real Article Title');
});

test('the first title word matches across case and highlights offset zero through the search API',async()=>{
  const directory=await fs.mkdtemp('/tmp/papertrail-title-start-'),root=path.join(directory,'papers');
  const database=path.join(directory,'library.sqlite');let lib;
  const title='Performance and safety of a multi-cancer early detection test';
  try{
    await fs.mkdir(root);await fs.writeFile(path.join(root,'unrelated-filename.pdf'),pdf([title,'Methods and study details'],title));
    lib=new Library(database);await imported(lib,root);
    const handler=createHandler(lib,{configured:false});
    for(const query of ['performance','Performance','PERFORMANCE']){
      const response=await request(handler,'/api/search?'+new URLSearchParams({q:query,fields:'title',caseInsensitive:'true',fuzzy:'false'}));
      assert.equal(response.status,200);assert.equal(response.json().total,1);
      const paper=response.json().papers[0];assert.equal(paper.title,title);assert.deepEqual(paper.matched_fields,['title']);
      assert.deepEqual(paper.highlights.title,[{start:0,end:11}]);assert.equal(paper.title.slice(0,11),'Performance');
    }
    assert.equal((await request(handler,'/api/search?q=performance')).json().total,1);
    assert.equal(lib.search('performance',40,0,{fields:['title'],caseInsensitive:false}).total,0);
    assert.equal(lib.search('Performance',40,0,{fields:['title'],caseInsensitive:false}).total,1);
    assert.equal(lib.search('safety',40,0,{fields:['title']}).total,1);
    assert.equal(lib.search('perform',40,0,{fields:['title']}).total,0);
    assert.equal(lib.search('performance',40,0,{fields:['abstract']}).total,0);
    lib.db.close();lib=new Library(database);
    assert.equal(lib.search('performance',40,0,{fields:['title']}).total,1);
  }finally{lib?.db.close();await fs.rm(directory,{recursive:true,force:true});}
});

test('opt-in prefix search matches partial title words with field, case, fuzzy and highlight rules',async()=>{
  const directory=await fs.mkdtemp('/tmp/papertrail-prefix-'),root=path.join(directory,'papers');let lib;
  const title='Performance and safety of a multi-cancer early detection test';
  try{
    await fs.mkdir(root);
    await fs.writeFile(path.join(root,'first.pdf'),pdf([title,'Study methods'],title));
    await fs.writeFile(path.join(root,'second.pdf'),pdf(['Unrelated study','Performance in the body only'],'Unrelated study'));
    lib=new Library(path.join(directory,'library.sqlite'));await imported(lib,root);
    const titleOptions={fields:['title'],prefix:true};
    for(const query of ['p','pe','per','perf','perfo','perform','performance']){
      const result=lib.search(query,40,0,titleOptions);assert.equal(result.total,1,query);assert.equal(result.papers[0].title,title);
      assert.deepEqual(result.papers[0].highlights.title,[{start:0,end:11}]);
    }
    assert.equal(lib.search('perf',40,0,{fields:['title']}).total,0); // Preserve the original whole-word default.
    assert.equal(lib.search('formance',40,0,titleOptions).total,0); // Prefixes are not arbitrary substrings.
    assert.equal(lib.search('perf',40,0,{...titleOptions,caseInsensitive:false}).total,0);
    assert.equal(lib.search('Perf',40,0,{...titleOptions,caseInsensitive:false}).total,1);
    assert.equal(lib.search('perf',40,0,{prefix:true,fields:['text']}).total,2);
    assert.equal(lib.search('perf',40,0,{prefix:true,fields:['abstract']}).total,0);
    assert.equal(lib.search('performnce',40,0,{...titleOptions,fuzzy:true}).total,1);
    assert.equal(lib.search('performnce',40,0,titleOptions).total,0);
    const handler=createHandler(lib,{configured:false});
    assert.equal((await request(handler,'/api/search?q=perf&fields=title&prefix=true&caseInsensitive=true')).json().total,1);
    assert.equal((await request(handler,'/api/search?q=perf&fields=title&prefix=false')).json().total,0);
    assert.equal((await request(handler,'/api/search?q=perf&prefix=invalid')).status,400);
    const pages=lib.db.prepare('SELECT paper_id,number,text FROM pages ORDER BY paper_id,number').all();
    lib.db.close();lib=new Library(path.join(directory,'library.sqlite'));
    assert.equal(lib.search('perf',40,0,titleOptions).total,1);
    assert.deepEqual(lib.db.prepare('SELECT paper_id,number,text FROM pages ORDER BY paper_id,number').all(),pages);
    assert.equal(lib.db.prepare('PRAGMA user_version').get().user_version,3);
  }finally{lib?.db.close();await fs.rm(directory,{recursive:true,force:true});}
});

test('quoted phrases require adjacent ordered whole words in one selected field and page',async()=>{
  const lib=new Library(':memory:');
  try{
    const add=(id,title,pages)=>{
      lib.db.prepare("INSERT INTO papers(id,path,root,title,mtime,size,pages,status) VALUES(?,?,'/papers',?,0,0,?,'ready')").run(id,`/papers/${id}.pdf`,title,pages.length);
      for(const [index,text]of pages.entries()){
        lib.db.prepare('INSERT INTO pages(paper_id,number,text) VALUES(?,?,?)').run(id,index+1,text);
        lib.db.prepare('INSERT INTO search(title,text,paper_id,page) VALUES(?,?,?,?)').run(title,text,id,index+1);
      }
    };
    add(1,'Foundational model for cancer detection',['Exact phrase study details']);
    add(2,'Foundational methods for a model',['Foundational methods improve the model']);
    add(3,'Model foundational applications',['model foundational']);
    add(4,'Foundational models in oncology',['Foundational models']);
    add(5,'Foundational',['model in another field']);
    add(6,'Only body match',['A foundational model supports this study']);
    add(7,'Phrase across pages',['foundational','model']);
    const title={fields:['title']},phrase='"foundational model"';
    assert.deepEqual(lib.search(phrase,40,0,title).papers.map(p=>p.id),[1]);
    assert.equal(lib.search('foundational model',40,0,title).total,5);
    assert.equal(lib.search('“foundational model”',40,0,title).total,1);
    assert.equal(lib.search('"foundational-model"',40,0,title).total,1);
    assert.equal(lib.search(phrase,40,0,{...title,caseInsensitive:false}).total,0);
    assert.equal(lib.search('"Foundational model"',40,0,{...title,caseInsensitive:false}).total,1);
    assert.equal(lib.search('"foundational mod"',40,0,{...title,prefix:true,fuzzy:true}).total,0);
    assert.equal(lib.search('"foundatinal model"',40,0,{...title,prefix:true,fuzzy:true}).total,0);
    assert.deepEqual(lib.search(phrase,40,0,{fields:['title','text']}).papers.map(p=>p.id).sort((a,b)=>a-b),[1,6]);
    assert.deepEqual(lib.search(phrase,40,0,{fields:['text']}).papers.map(p=>p.id),[6]);
    assert.equal(lib.search(phrase,40,0,{fields:['authors']}).total,0);
    assert.deepEqual(lib.search(phrase+' oncology',40,0,title).papers.map(p=>p.id).sort((a,b)=>a-b),[1,4]);
    const result=lib.search(phrase,40,0,title).papers[0];
    assert.deepEqual(result.highlights.title,[{start:0,end:18}]);assert.equal(result.snippet.slice(result.highlights.snippet[0].start,result.highlights.snippet[0].end),'Foundational model');
    const handler=createHandler(lib,{configured:false});
    assert.equal((await request(handler,'/api/search?'+new URLSearchParams({q:phrase,fields:'title'}))).json().total,1);
    const tooLong='"'+Array(25).fill('word').join(' ')+'"';
    const invalid=await request(handler,'/api/search?'+new URLSearchParams({q:tooLong}));assert.equal(invalid.status,400);assert.match(invalid.json().error,/24 words/);
  }finally{lib.db.close();}
});
