import { appendHighlighted } from './highlight.js';
const $ = id => document.getElementById(id);
const el = (tag, text, cls) => { const node = document.createElement(tag); if (text != null) node.textContent = text; if (cls) node.className = cls; return node; };
const desktop=window.papertrailDesktop;
if(desktop){try{const preferences=await desktop.getPreferences();if(preferences.backend)localStorage.setItem('papertrail.assistantBackend',preferences.backend);if(preferences.searchOptions)localStorage.setItem('papertrail.searchOptions',JSON.stringify(preferences.searchOptions));}catch{}}
const saveDesktopPreferences=()=>desktop?.savePreferences({backend:$('assistant-backend').value,searchOptions:getOptions()}).catch(error=>notify(error.message));
let query = '', offset = 0, sequence = 0, wasRunning = false, aiAbort;
let selectedPaper,selectedPaperTitle;
let assistantStatus,desktopTools,backendInitialized=false;
try{const saved=localStorage.getItem('papertrail.assistantBackend');if(['openworker','codex'].includes(saved)){$('assistant-backend').value=saved;backendInitialized=true;}}catch{}
function updateAssistantControls(){
  const backend=$('assistant-backend').value;
  const selected=assistantStatus?.aiBackends?.find(item=>item.id===backend);
  $('ai-status').textContent=selected?.message || 'Checking assistant connection…';
  if(desktop && !selected?.configured && desktopTools?.tools[backend]?.installed)$('ai-status').textContent=backend==='codex'?'Sign in with ChatGPT to enable the research companion.':'Open Settings to configure an API provider or Ollama.';
  if(desktop){$('desktop-sign-in').disabled=!desktopTools?.tools.codex.installed || !!desktopTools?.job.running;$('desktop-setup-ai').hidden=false;}
  $('desktop-sign-in').hidden=!desktop || backend!=='codex';
  $('ask').disabled=!selected?.configured || !!aiAbort || !!desktopTools?.job.running;
  $('assistant-backend').disabled=!!aiAbort;
  $('assistant-footer').textContent=backend==='codex'?'Search stays offline. When you ask, excerpts go through local Codex to OpenAI using your ChatGPT sign-in.':'Your search works without AI. When enabled, relevant excerpts go to your configured provider.';
}
$('assistant-backend').onchange=()=>{try{localStorage.setItem('papertrail.assistantBackend',$('assistant-backend').value);}catch{}saveDesktopPreferences();$('answer').textContent='';$('sources').replaceChildren();updateAssistantControls();};
$('check-ai').onclick=async()=>{const button=$('check-ai');button.disabled=true;try{await status(true);}catch(e){notify(e.message);}finally{button.disabled=false;}};
const getOptions=()=>({caseInsensitive:$('case-insensitive').checked,fuzzy:$('fuzzy').checked,prefix:$('prefix').checked,fields:[...$('search-fields').querySelectorAll('input:checked')].map(input=>input.value)});
function optionHint(){const o=getOptions();$('search-hint').textContent=!o.fields.length?'Select at least one search field.':`${o.prefix?(o.fuzzy?'Word beginnings + fuzzy spelling':'Word beginnings (perf → Performance)'):o.fuzzy?'Fuzzy: one spelling edit for words of 5+ characters':'Whole words'} · ${o.caseInsensitive?'Case insensitive':'Case sensitive'} · Any unquoted term; double quotes match an exact phrase. Abstracts/authors are detected; review in paper details.`;}
try{const saved=JSON.parse(localStorage.getItem('papertrail.searchOptions'));if(saved){$('case-insensitive').checked=saved.caseInsensitive!==false;$('fuzzy').checked=saved.fuzzy===true;$('prefix').checked=saved.prefix===true;if(Array.isArray(saved.fields))for(const input of $('search-fields').querySelectorAll('input'))input.checked=saved.fields.includes(input.value);}}catch{}
optionHint();
async function api(url, data) {
  const res = await fetch(url,data ? {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)} : {});
  const json = await res.json(); if (!res.ok) throw new Error(json.error); return json;
}
function notify(message) { $('notification').textContent=message; $('notification').hidden=!message; }
const pdfUrl = (id,page=1) => `/api/papers/${id}/file#page=${page}`;
async function folderDialog() {try{if(desktop){const folder=await desktop.chooseFolder();if(!folder)return;$('folder').value=folder;}$('import-dialog').showModal();$('folder').focus();}catch(error){notify(error.message);}}
$('add-folder').onclick=folderDialog;
$('close-import').onclick=()=>$('import-dialog').close();
$('close-paper').onclick=()=>$('paper-dialog').close();
$('import-form').onsubmit=async event=>{event.preventDefault(); const button=event.submitter; button.disabled=true; try { await api('/api/import',{folder:$('folder').value}); $('import-dialog').close(); notify(''); await status(); } catch(e){notify(e.message);} finally{button.disabled=false;} };
$('cancel-import').onclick=async()=>{try{await api('/api/import/cancel',{});await status();}catch(e){notify(e.message);}};
async function showPaper(id,page=1) {
  try {
    const paper=await api(`/api/papers/${id}`);
    selectedPaper=id;$('paper-authors').value=paper.authors || '';$('paper-abstract').value=paper.abstract || '';$('metadata-status').textContent='';
    selectedPaperTitle=paper.title;$('paper-metadata-title').value=paper.title;
    $('title-source').textContent=paper.title_source==='legacy'?'Title awaits PDF extraction. Rescan its folder.':`Title source: ${({'pdf-metadata':'PDF metadata verified against page text','pdf-layout':'PDF page layout','pdf-text':'PDF opening text',manual:'your correction',unavailable:'not detected'})[paper.title_source] || 'not detected'}.`;
    $('metadata-note').textContent=paper.metadata_edited?'Saved corrections. Changes remain when rescanning.':'Detected from opening pages; review and correct if needed. Missing fields do not match field-only searches.';
    $('paper-title').textContent=paper.title; $('paper-path').textContent=paper.path;
    $('paper-link').href=pdfUrl(id,page);
    $('page-select').replaceChildren(...paper.content.map(p=>{const option=el('option',`Page ${p.number}`);option.value=p.number;return option;}));
    $('page-select').value=String(page);
    const display=()=>{const number=Number($('page-select').value);$('paper-text').textContent=paper.content.find(p=>p.number===number)?.text || paper.error || 'No extractable text. This PDF may need OCR.';$('paper-link').href=pdfUrl(id,number || 1);};
    $('page-select').onchange=display;display();$('paper-dialog').showModal();
  }catch(e){notify(e.message);}
}
$('metadata-form').onsubmit=async event=>{event.preventDefault();event.submitter.disabled=true;try{const title=$('paper-metadata-title').value;const paper=await api(`/api/papers/${selectedPaper}/metadata`,{authors:$('paper-authors').value,abstract:$('paper-abstract').value,...(title!==selectedPaperTitle?{title}:{})});selectedPaperTitle=paper.title;$('paper-title').textContent=paper.title;if(paper.title_source==='manual')$('title-source').textContent='Title source: your correction.';$('metadata-status').textContent=' Saved';$('metadata-note').textContent='Saved corrections. Changes remain when rescanning.';await search();}catch(e){$('metadata-status').textContent=e.message;}finally{event.submitter.disabled=false;}};
function card(paper) {
  const card=el('article',null,'paper-card');
  const meta=el('div',null,'paper-meta');meta.append(el('span','PDF','pdf-label'),el('span',`${paper.pages} pages`),el('span',paper.status==='ready'?'Text indexed':paper.status==='no-text'?'Needs OCR':'Import error'));card.append(meta);
  if(paper.matched_fields?.length)meta.append(el('span','Match: '+paper.matched_fields.map(f=>f==='text'?'full text':f).join(', ')));
  if(paper.title_source==='legacy')meta.append(el('span','Title needs rescan'));
  const h=el('h3'),button=el('button');appendHighlighted(button,paper.title,paper.highlights?.title);button.onclick=()=>showPaper(paper.id,paper.match_page||1);h.append(button);card.append(h);
  const passage=el('p');appendHighlighted(passage,paper.snippet || paper.error || (paper.status==='no-text'?'No extractable text found. You can still open the original PDF.':'Open this paper to read the extracted pages or search for a passage.'),paper.highlights?.snippet);card.append(passage);
  const bottom=el('div',null,'paper-bottom'),location=el('span',paper.path);location.title=paper.path;
  const link=el('a',`Open PDF${paper.match_page?' · p. '+paper.match_page:''} ↗`);link.href=pdfUrl(paper.id,paper.match_page||1);link.target='_blank';link.rel='noopener';bottom.append(location,link);card.append(bottom);return card;
}
async function search(append=false) {
  const current=++sequence;if(!append)offset=0;
  try {
    const options=getOptions(),params=new URLSearchParams({q:query,offset,caseInsensitive:options.caseInsensitive,fuzzy:options.fuzzy,prefix:options.prefix,fields:options.fields.join(',')});
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
for(const input of document.querySelectorAll('.search-options input'))input.onchange=()=>{clearTimeout(debounce);query=$('search').value.trim();optionHint();try{localStorage.setItem('papertrail.searchOptions',JSON.stringify(getOptions()));}catch{}saveDesktopPreferences();search();};
$('search').oninput=()=>{clearTimeout(debounce);debounce=setTimeout(()=>{query=$('search').value.trim();search();},220);};
$('search-button').onclick=()=>{clearTimeout(debounce);query=$('search').value.trim();search();};
$('search').onkeydown=e=>{if(e.key==='Enter')$('search-button').click();};
$('more').onclick=()=>search(true);
document.addEventListener('keydown',e=>{if(e.key==='/'&&!['INPUT','TEXTAREA','SELECT'].includes(document.activeElement.tagName)){e.preventDefault();$('search').focus();}});
async function status(refreshAI=false) {
  const data=await api('/api/status'+(refreshAI?'?refreshAI=1':''));
  for(const key of ['total','pages','ready'])$(key).textContent=data[key].toLocaleString();
  $('attention').textContent=data.errors+data.scanned;$('nav-count').textContent=data.total;
  $('roots').replaceChildren(...data.roots.map(root=>{const item=el('div',null,'root-item');item.append(el('div','▱ '+root));const b=el('button','Rescan folder','text-button');b.disabled=!!data.job?.running;b.onclick=async()=>{try{await api('/api/import',{folder:root});await status();}catch(e){notify(e.message);}};item.append(b);return item;}));
  if(!data.roots.length)$('roots').textContent='Your folders will appear here.';
  assistantStatus=data;
  if(!backendInitialized){$('assistant-backend').value=data.aiDefaultBackend || 'openworker';backendInitialized=true;}
  updateAssistantControls();
  const job=data.job;$('job').hidden=!job;
  if(job){$('job-title').textContent=job.running?(job.cancelled?'Stopping after current PDF…':'Indexing your library…'):job.cancelled?'Import stopped':'Import complete';$('cancel-import').hidden=!job.running||job.cancelled;$('progress').max=Math.max(1,job.discovered);$('progress').value=job.processed;$('job-detail').textContent=`${job.processed} / ${job.discovered} PDFs · ${job.indexed} indexed · ${job.unchanged} unchanged · ${job.failed} errors · ${job.removed} removed${job.current?' · '+job.current:''}`;$('issues').hidden=!job.issues.length;$('issue-list').textContent=job.issues.join('\n');}
  if(wasRunning&&!job?.running)await search();wasRunning=!!job?.running;
}
$('ask').onclick=async()=>{
  const question=$('question').value.trim();if(!question){$('question').focus();return;}
  aiAbort=new AbortController();$('ask').disabled=true;$('stop-ai').hidden=false;$('answer').textContent='Reading relevant passages…';$('sources').replaceChildren();
  updateAssistantControls();
  try{
    const res=await fetch('/api/ask',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({question,query,options:getOptions(),backend:$('assistant-backend').value}),signal:aiAbort.signal});
    if(!res.ok)throw new Error((await res.json()).error);
    const reader=res.body.getReader(),decoder=new TextDecoder();let buffer='',terminal=false;
    while(true){const {done,value}=await reader.read();if(done)break;buffer+=decoder.decode(value,{stream:true});let end;while((end=buffer.indexOf('\n'))>=0){const event=JSON.parse(buffer.slice(0,end));buffer=buffer.slice(end+1);if(event.type==='text'||event.type==='done')$('answer').textContent=event.text;if(event.type==='done')terminal=true;if(event.type==='error')throw new Error(event.error);if(event.type==='sources')$('sources').replaceChildren(...event.sources.map(s=>{const a=el('a',`[Paper ${s.id}, p. ${s.page}] ${s.title}`);a.href=pdfUrl(s.id,s.page);a.target='_blank';a.rel='noopener';return a;}));}}
    if(!terminal)throw new Error('Connection ended before the answer completed.');
  }catch(e){if(e.name==='AbortError')$('answer').append(el('p','Answer stopped.'));else $('answer').append(el('p',e.message));}
  finally{aiAbort=null;$('stop-ai').hidden=true;updateAssistantControls();status().catch(e=>notify(e.message));}
};
$('stop-ai').onclick=()=>aiAbort?.abort();
let signInTimer;
async function renderSignIn(){
  const state=await desktop.signInStatus();$('sign-in-message').textContent=state.message;
  $('sign-in-link').hidden=!state.url;if(state.url)$('sign-in-link').href=state.url;
  $('sign-in-link').onclick=event=>{event.preventDefault();desktop.openSignInPage().catch(error=>notify(error.message));};
  $('cancel-sign-in').hidden=!state.running;
  if(!state.running){clearInterval(signInTimer);await status(true);}
}
async function signIn(){try{await desktop.startSignIn();$('sign-in-dialog').showModal();await renderSignIn();clearInterval(signInTimer);signInTimer=setInterval(()=>renderSignIn().catch(error=>notify(error.message)),1000);}catch(error){notify(error.message);}}
function renderTools(state){
  desktopTools=state;
  for(const id of ['codex','openworker']){
    const tool=state.tools[id],name=id==='codex'?'Codex':'OpenWorker';
    $(id+'-tool-status').textContent=tool.installed?`${name} ${tool.version} · ${tool.source==='existing'?'Existing installation':'Downloaded for Papertrail'} · ${tool.launcher || tool.path}${id==='openworker'?' · Configure the model and provider below to enable answers.':''}`:`${name} is not installed for Papertrail. Available version: ${tool.version}. ${tool.note || ''}`;
    $('download-'+id).disabled=tool.installed || state.job.running;
    $('download-'+id).textContent=tool.installed?name+' installed':'Download '+name;
  }
  $('detect-tools').disabled=state.job.running;$('choose-codex').disabled=state.job.running;$('use-codex-path').disabled=state.job.running;$('codex-executable-path').disabled=state.job.running;
  const job=state.job,progress=job.running && job.phase==='download' && job.received?` ${(job.received/1048576).toFixed(1)}${job.total?' / '+(job.total/1048576).toFixed(1):''} MB`:'';
  $('tool-download-status').textContent=(job.message || '')+progress;
  $('cancel-tool-download').hidden=!job.running;
}
async function toolAction(callback){
  try{$('settings-message').textContent='';renderTools(await callback());await status(true);}catch(error){$('settings-message').textContent=error.message;notify(error.message);}
}
async function showSettings(){
  try{renderTools(await desktop.getTools());$('codex-executable-path').value=desktopTools.tools.codex.launcher || desktopTools.tools.codex.path || '';const settings=await desktop.getSettings();$('provider-model').value=settings.model;$('provider-url').value=settings.baseUrl;$('provider-api').value=settings.api;$('provider-key').value='';$('provider-key').placeholder=settings.hasApiKey?'A key is already set; leave blank to keep it':'Optional for a local provider';$('remember-key').checked=settings.rememberKey && settings.secureStorageAvailable;$('remember-key').disabled=!settings.secureStorageAvailable;$('clear-key').checked=false;$('settings-storage').textContent=settings.dataDirectory+' · Desktop server: '+settings.serverAddress;$('settings-note').textContent=settings.warning || (settings.secureStorageAvailable?'Keys can be remembered using your desktop keyring.':'Desktop keyring unavailable. API keys can be used for this session only.');$('settings-message').textContent='';$('settings-dialog').showModal();}catch(error){notify(error.message);}
}
if(desktop){
  $('desktop-settings').hidden=false;$('desktop-settings').onclick=showSettings;
  $('desktop-sign-in').onclick=signIn;
  $('desktop-setup-ai').onclick=showSettings;
  $('detect-tools').onclick=()=>toolAction(()=>desktop.detectTools());
  $('choose-codex').onclick=()=>toolAction(()=>desktop.chooseCodex());
  $('use-codex-path').onclick=()=>toolAction(()=>desktop.useCodexPath($('codex-executable-path').value.trim()));
  let readingTools=false;
  const refreshTools=async()=>{if(readingTools)return;readingTools=true;try{renderTools(await desktop.getTools());updateAssistantControls();}catch(error){notify(error.message);}finally{readingTools=false;}};
  await refreshTools();setInterval(refreshTools,750);
  for(const id of ['codex','openworker'])$('download-'+id).onclick=()=>toolAction(()=>desktop.installTool(id));
  $('cancel-tool-download').onclick=()=>toolAction(()=>desktop.cancelToolDownload());
  $('cancel-sign-in').onclick=async()=>{await desktop.cancelSignIn();await renderSignIn();};
  $('close-sign-in').onclick=()=>{$('sign-in-dialog').close();};
  $('close-settings').onclick=()=>{$('provider-key').value='';$('settings-dialog').close();};
  $('settings-form').onsubmit=async event=>{event.preventDefault();const button=event.submitter;button.disabled=true;try{await desktop.saveSettings({model:$('provider-model').value,baseUrl:$('provider-url').value,api:$('provider-api').value,apiKey:$('provider-key').value,rememberKey:$('remember-key').checked,clearApiKey:$('clear-key').checked});$('provider-key').value='';$('settings-message').textContent='Settings saved.';await status(true);}catch(error){$('settings-message').textContent=error.message;}finally{button.disabled=false;}};
  $('import-library').onclick=async()=>{try{const result=await desktop.importLibrary();if(result)$('settings-message').textContent=`Imported ${result.papers} papers. Restarting Papertrail…`;}catch(error){$('settings-message').textContent=error.message;}};
  desktop.onCommand(command=>{if(command==='choose-folder')folderDialog();if(command==='settings')showSettings();});
}
await Promise.all([search(),status().catch(e=>notify(e.message))]);
setInterval(()=>status().catch(e=>notify(e.message)),1500);
