import test from 'node:test';
import assert from 'node:assert/strict';
import { matchRanges, searchOptions, tokens, parseQuery, searchRanges } from '../src/search.js';
import { appendHighlighted } from '../public/highlight.js';
import { Library } from '../src/library.js';

const hits=(text,query,options={})=>matchRanges(text,tokens(query),searchOptions(options)).map(r=>text.slice(r.start,r.end));

test('highlight spans follow whole-word, case and fuzzy rules and preserve Unicode offsets',()=>{
  const text='🧬 Transformer transformer transformers transformation TRANSFORMER';
  assert.deepEqual(hits(text,'transformer'),['Transformer','transformer','TRANSFORMER']);
  assert.deepEqual(hits(text,'transformer',{caseInsensitive:false}),['transformer']);
  assert.deepEqual(hits(text,'transfomer',{fuzzy:true}),['Transformer','transformer','TRANSFORMER']);
  assert.deepEqual(hits(text,'transfomer'),[]);
  assert.deepEqual(hits('DNA dna','dna',{caseInsensitive:false,fuzzy:true}),['dna']);
  assert.deepEqual(hits('Transformer methylation transformer-based','transformer methylation'),['Transformer','methylation','transformer']);
  assert.deepEqual(hits('cafe\u0301 café','café'),['cafe\u0301','café']);
  assert.deepEqual(hits(text,''),[]);
});

test('rendering highlights preserves untrusted text as text and ignores invalid spans',()=>{
  const document={
    createTextNode:text=>({kind:'text',textContent:text}),
    createElement:tag=>({kind:tag,textContent:''})
  };
  const target={ownerDocument:document,children:[],append(node){this.children.push(node);}};
  const text='<img src=x onerror=alert(1)> Transformer & <script>example</script>';
  appendHighlighted(target,text,matchRanges(text,['transformer'],searchOptions()));
  assert.equal(target.children.map(n=>n.textContent).join(''),text);
  assert.deepEqual(target.children.map(n=>n.kind),['text','mark','text']);
  assert.equal(target.children[1].textContent,'Transformer');
  const invalid={...target,children:[]};
  appendHighlighted(invalid,'abc',[{start:-1,end:2},{start:0,end:999},{start:0,end:1},{start:0,end:2}]);
  assert.equal(invalid.children.map(n=>n.textContent).join(''),'abc');
  assert.equal(invalid.children.filter(n=>n.kind==='mark').length,1);
});

test('library highlights only enabled fields and avoids partial-word clipping in snippets',()=>{
  const lib=new Library(':memory:');
  try{
    const text='transformer '+'x'.repeat(480)+' transformers';
    lib.db.prepare("INSERT INTO papers(id,path,root,title,mtime,size,pages,status) VALUES(1,'/tmp/test.pdf','/tmp','Transformer methods',0,0,1,'ready')").run();
    lib.db.prepare('INSERT INTO pages(paper_id,number,text) VALUES(1,1,?)').run(text);
    lib.db.prepare('INSERT INTO search(title,text,paper_id,page) VALUES(?,?,1,1)').run('Transformer methods',text);
    const result=lib.search('transformer').papers[0];
    assert.deepEqual(result.highlights.title.map(r=>result.title.slice(r.start,r.end)),['Transformer']);
    assert.deepEqual(result.highlights.snippet.map(r=>result.snippet.slice(r.start,r.end)),['transformer']);
    assert.match(result.snippet,/transformers$/);
    const scoped=lib.search('transformer',40,0,{fields:['text']}).papers[0];assert.deepEqual(scoped.highlights.title,[]);
    const sensitive=lib.search('transformer',40,0,{caseInsensitive:false}).papers[0];assert.deepEqual(sensitive.highlights.title,[]);
    const fuzzy=lib.search('transfomer',40,0,{fuzzy:true}).papers[0];assert.equal(fuzzy.highlights.snippet.length,1);
    assert.equal(lib.search('').papers[0].highlights,undefined);
  }finally{lib.db.close();}
});


test('phrase highlighting merges overlaps and preserves original Unicode offsets without fuzzy expansion',()=>{
  const text='🧬 cafe\u0301 model and café models';
  const clauses=parseQuery('"café model" café');
  const ranges=searchRanges(text,clauses,searchOptions({prefix:true,fuzzy:true}));
  assert.deepEqual(ranges.map(range=>text.slice(range.start,range.end)),['cafe\u0301 model','café']);
  assert.deepEqual(searchRanges(text,parseQuery('"café model"'),searchOptions({prefix:true,fuzzy:true})).map(range=>text.slice(range.start,range.end)),['cafe\u0301 model']);
  assert.deepEqual(parseQuery('"unfinished phrase').map(clause=>clause.words),[['unfinished'],['phrase']]);
  assert.deepEqual(parseQuery('""'),[]);
});
