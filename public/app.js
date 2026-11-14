import { appendHighlighted } from './highlight.js';
const $ = id => document.getElementById(id);
const el = (tag, text, cls) => { const node = document.createElement(tag); if (text != null) node.textContent = text; if (cls) node.className = cls; return node; };
let query = '', offset = 0, sequence = 0, wasRunning = false, aiAbort;
let selectedPaper;
const getOptions=()=>({caseInsensitive:$('case-insensitive').checked,fuzzy:$('fuzzy').checked,fields:[...$('search-fields').querySelectorAll('input:checked')].map(input=>input.value)});
function optionHint(){const o=getOptions();$('search-hint').textContent=!o.fields.length?'Select at least one search field.':`${o.fuzzy?'Fuzzy: one spelling edit for words of 5+ characters':'Whole words'} · ${o.caseInsensitive?'Case insensitive':'Case sensitive'} · Any term in selected fields. Abstracts/authors are detected; review in paper details.`;}
try{const saved=JSON.parse(localStorage.getItem('papertrail.searchOptions'));if(saved){$('case-insensitive').checked=saved.caseInsensitive!==false;$('fuzzy').checked=saved.fuzzy===true;if(Array.isArray(saved.fields))for(const input of $('search-fields').querySelectorAll('input'))input.checked=saved.fields.includes(input.value);}}catch{}
optionHint();
async function api(url, data) {
  const res = await fetch(url,data ? {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)} : {});
  const json = await res.json(); if (!res.ok) throw new Error(json.error); return json;
}
function notify(message) { $('notification').textContent=message; $('notification').hidden=!message; }
const pdfUrl = (id,page=1) => `/api/papers/${id}/file#page=${page}`;
function folderDialog() { $('import-dialog').showModal(); $('folder').focus(); }
$('add-folder').onclick=folderDialog;
$('close-import').onclick=()=>$('import-dialog').close();
$('close-paper').onclick=()=>$('paper-dialog').close();
$('import-form').onsubmit=async event=>{event.preventDefault(); const button=event.submitter; button.disabled=true; try { await api('/api/import',{folder:$('folder').value}); $('import-dialog').close(); notify(''); await status(); } catch(e){notify(e.message);} finally{button.disabled=false;} };
$('cancel-import').onclick=async()=>{try{await api('/api/import/cancel',{});await status();}catch(e){notify(e.message);}};
async function showPaper(id,page=1) {
  try {
    const paper=await api(`/api/papers/${id}`);
    selectedPaper=id;$('paper-authors').value=paper.authors || '';$('paper-abstract').value=paper.abstract || '';$('metadata-status').textContent='';
    $('metadata-note').textContent=paper.metadata_edited?'Saved corrections. Changes remain when rescanning.':'Detected from opening pages; review and correct if needed. Missing fields do not match field-only searches.';
    $('paper-title').textContent=paper.title; $('paper-path').textContent=paper.path;
    $('paper-link').href=pdfUrl(id,page);
    $('page-select').replaceChildren(...paper.content.map(p=>{const option=el('option',`Page ${p.number}`);option.value=p.number;return option;}));
    $('page-select').value=String(page);
    const display=()=>{const number=Number($('page-select').value);$('paper-text').textContent=paper.content.find(p=>p.number===number)?.text || paper.error || 'No extractable text. This PDF may need OCR.';$('paper-link').href=pdfUrl(id,number || 1);};
    $('page-select').onchange=display;display();$('paper-dialog').showModal();
  }catch(e){notify(e.message);}
}
$('metadata-form').onsubmit=async event=>{event.preventDefault();event.submitter.disabled=true;try{await api(`/api/papers/${selectedPaper}/metadata`,{authors:$('paper-authors').value,abstract:$('paper-abstract').value});$('metadata-status').textContent=' Saved';$('metadata-note').textContent='Saved corrections. Changes remain when rescanning.';await search();}catch(e){$('metadata-status').textContent=e.message;}finally{event.submitter.disabled=false;}};
function card(paper) {
  const card=el('article',null,'paper-card');
  const meta=el('div',null,'paper-meta');meta.append(el('span','PDF','pdf-label'),el('span',`${paper.pages} pages`),el('span',paper.status==='ready'?'Text indexed':paper.status==='no-text'?'Needs OCR':'Import error'));card.append(meta);
  if(paper.matched_fields?.length)meta.append(el('span','Match: '+paper.matched_fields.map(f=>f==='text'?'full text':f).join(', ')));
  const h=el('h3'),button=el('button');appendHighlighted(button,paper.title,paper.highlights?.title);button.onclick=()=>showPaper(paper.id,paper.match_page||1);h.append(button);card.append(h);
  const passage=el('p');appendHighlighted(passage,paper.snippet || paper.error || (paper.status==='no-text'?'No extractable text found. You can still open the original PDF.':'Open this paper to read the extracted pages or search for a passage.'),paper.highlights?.snippet);card.append(passage);
  const bottom=el('div',null,'paper-bottom'),location=el('span',paper.path);location.title=paper.path;
  const link=el('a',`Open PDF${paper.match_page?' · p. '+paper.match_page:''} ↗`);link.href=pdfUrl(paper.id,paper.match_page||1);link.target='_blank';link.rel='noopener';bottom.append(location,link);card.append(bottom);return card;
}
async function search(append=false) {
  const current=++sequence;if(!append)offset=0;
  try {
    const options=getOptions(),params=new URLSearchParams({q:query,offset,caseInsensitive:options.caseInsensitive,fuzzy:options.fuzzy,fields:options.fields.join(',')});
    const data=await api(`/api/search?${params}`);if(current!==sequence)return;
    if(!append)$('results').replaceChildren();
    $('results-heading').textContent=query?'Search results':'All papers';
    $('results-count').textContent=`${data.total.toLocaleString()}${data.capped?'+':''} papers`;
    if(!data.total){const empty=el('div',null,'empty');empty.append(el('div','▤','empty-icon'),el('h3',!options.fields.length?'Choose where to search.':query?'A new trail awaits.':'Make room for discovery.'),el('p',!options.fields.length?'Select at least one field above.':query?'No papers match these terms and options. Try another field or a broader topic.':'Add your PDF folder to build a searchable home for your research. Every page, one place.'));if(!query&&options.fields.length){const b=el('button','＋ Add your first folder','secondary');b.onclick=folderDialog;empty.append(b);}$('results').append(empty);}
    else $('results').append(...data.papers.map(card));
    offset+=data.papers.length;$('more').hidden=offset>=data.total;
  }catch(e){notify(e.message);}
}
let debounce;
for(const input of document.querySelectorAll('.search-options input'))input.onchange=()=>{clearTimeout(debounce);query=$('search').value.trim();optionHint();try{localStorage.setItem('papertrail.searchOptions',JSON.stringify(getOptions()));}catch{}search();};
$('search').oninput=()=>{clearTimeout(debounce);debounce=setTimeout(()=>{query=$('search').value.trim();search();},220);};
$('search-button').onclick=()=>{clearTimeout(debounce);query=$('search').value.trim();search();};
$('search').onkeydown=e=>{if(e.key==='Enter')$('search-button').click();};
$('more').onclick=()=>search(true);
document.addEventListener('keydown',e=>{if(e.key==='/'&&!['INPUT','TEXTAREA','SELECT'].includes(document.activeElement.tagName)){e.preventDefault();$('search').focus();}});
async function status() {
  const data=await api('/api/status');
  for(const key of ['total','pages','ready'])$(key).textContent=data[key].toLocaleString();
  $('attention').textContent=data.errors+data.scanned;$('nav-count').textContent=data.total;
  $('roots').replaceChildren(...data.roots.map(root=>{const item=el('div',null,'root-item');item.append(el('div','▱ '+root));const b=el('button','Rescan folder','text-button');b.disabled=!!data.job?.running;b.onclick=async()=>{try{await api('/api/import',{folder:root});await status();}catch(e){notify(e.message);}};item.append(b);return item;}));
  if(!data.roots.length)$('roots').textContent='Your folders will appear here.';
  $('ai-status').textContent=data.ai?'Ready · Answers use your current search results.':'Optional · Set up a provider in .env to enable.';
  $('ask').disabled=!data.ai||!!aiAbort;
  const job=data.job;$('job').hidden=!job;
  if(job){$('job-title').textContent=job.running?(job.cancelled?'Stopping after current PDF…':'Indexing your library…'):job.cancelled?'Import stopped':'Import complete';$('cancel-import').hidden=!job.running||job.cancelled;$('progress').max=Math.max(1,job.discovered);$('progress').value=job.processed;$('job-detail').textContent=`${job.processed} / ${job.discovered} PDFs · ${job.indexed} indexed · ${job.unchanged} unchanged · ${job.failed} errors · ${job.removed} removed${job.current?' · '+job.current:''}`;$('issues').hidden=!job.issues.length;$('issue-list').textContent=job.issues.join('\n');}
  if(wasRunning&&!job?.running)await search();wasRunning=!!job?.running;
}
$('ask').onclick=async()=>{
  const question=$('question').value.trim();if(!question){$('question').focus();return;}
  aiAbort=new AbortController();$('ask').disabled=true;$('stop-ai').hidden=false;$('answer').textContent='Reading relevant passages…';$('sources').replaceChildren();
  try{
    const res=await fetch('/api/ask',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({question,query,options:getOptions()}),signal:aiAbort.signal});
    if(!res.ok)throw new Error((await res.json()).error);
    const reader=res.body.getReader(),decoder=new TextDecoder();let buffer='',terminal=false;
    while(true){const {done,value}=await reader.read();if(done)break;buffer+=decoder.decode(value,{stream:true});let end;while((end=buffer.indexOf('\n'))>=0){const event=JSON.parse(buffer.slice(0,end));buffer=buffer.slice(end+1);if(event.type==='text'||event.type==='done')$('answer').textContent=event.text;if(event.type==='done')terminal=true;if(event.type==='error')throw new Error(event.error);if(event.type==='sources')$('sources').replaceChildren(...event.sources.map(s=>{const a=el('a',`[Paper ${s.id}, p. ${s.page}] ${s.title}`);a.href=pdfUrl(s.id,s.page);a.target='_blank';a.rel='noopener';return a;}));}}
    if(!terminal)throw new Error('Connection ended before the answer completed.');
  }catch(e){if(e.name==='AbortError')$('answer').append(el('p','Answer stopped.'));else $('answer').append(el('p',e.message));}
  finally{aiAbort=null;$('stop-ai').hidden=true;status().catch(e=>notify(e.message));}
};
$('stop-ai').onclick=()=>aiAbort?.abort();
await Promise.all([search(),status().catch(e=>notify(e.message))]);
setInterval(()=>status().catch(e=>notify(e.message)),1500);
