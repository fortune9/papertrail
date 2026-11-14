import http from 'node:http';
import { promises as fs, createReadStream } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Library } from './library.js';
import { AssistantService } from './assistant-service.js';
import { searchOptions } from './search.js';

const project = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const json = (res, status, body) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)); };
async function body(req) {
  let result = '';
  for await (const chunk of req) { result += chunk; if (result.length > 65536) throw new Error('Request too large.'); }
  return JSON.parse(result || '{}');
}
export function createHandler(library, assistant, port = 3210) {
return async (req, res) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; frame-src 'self'; object-src 'none'; frame-ancestors 'none'");
  try {
    const allowedHosts = [`127.0.0.1:${port}`, `localhost:${port}`];
    if (!allowedHosts.includes(req.headers.host)) return json(res,403,{error:'Local access only.'});
    if (req.headers.origin && !allowedHosts.some(h => req.headers.origin === `http://${h}`)) return json(res,403,{error:'Cross-origin access denied.'});
    const url = new URL(req.url, `http://127.0.0.1:${port}`);
    const route = url.pathname;
    if (req.method === 'GET' && route === '/api/status') return json(res,200,{...library.stats(),
      ...(assistant.getStatus?await assistant.getStatus(url.searchParams.get('refreshAI')==='1'):{ai:assistant.configured})});
    if (req.method === 'GET' && route === '/api/search') {
      const q = (url.searchParams.get('q') || '').slice(0,1000);
      const offset = Math.max(0, Math.min(Number(url.searchParams.get('offset')) || 0, 100000));
      const parseBoolean=(name)=>{const value=url.searchParams.get(name);if(value===null)return undefined;if(!['true','false'].includes(value))throw new Error(`Invalid ${name} option.`);return value==='true';};
      const options=searchOptions({caseInsensitive:parseBoolean('caseInsensitive'),fuzzy:parseBoolean('fuzzy'),
        ...(url.searchParams.has('fields')?{fields:url.searchParams.get('fields').split(',').filter(Boolean)}:{})});
      return json(res,200,library.search(q,40,offset,options));
    }
    if (req.method === 'POST' && route === '/api/import') {
      const { folder } = await body(req);
      if (typeof folder !== 'string' || !folder.trim()) return json(res,400,{error:'Enter a folder path.'});
      return json(res,202,await library.startImport(folder));
    }
    if (req.method === 'POST' && route === '/api/import/cancel') {
      if (library.job) library.job.cancelled = true;
      return json(res,200,{ok:true});
    }
    const paperRoute = route.match(/^\/api\/papers\/(\d+)(\/file)?$/);
    const metadataRoute=route.match(/^\/api\/papers\/(\d+)\/metadata$/);
    if(req.method==='POST' && metadataRoute) {
      const id=Number(metadataRoute[1]);if(!library.detail(id))return json(res,404,{error:'Paper not found.'});
      return json(res,200,library.updateMetadata(id,await body(req)));
    }
    if (req.method === 'GET' && paperRoute) {
      const paper = library.detail(Number(paperRoute[1]));
      if (!paper) return json(res,404,{error:'Paper not found.'});
      if (!paperRoute[2]) return json(res,200,paper);
      const real = await fs.realpath(paper.path);
      const relative = path.relative(paper.root,real);
      if (relative.startsWith('..') || path.isAbsolute(relative) || !/\.pdf$/i.test(real)) return json(res,403,{error:'File is outside its library folder.'});
      const stat = await fs.stat(real);
      res.writeHead(200,{'Content-Type':'application/pdf','Content-Length':stat.size,'Content-Disposition':"inline; filename*=UTF-8''"+encodeURIComponent(path.basename(real))});
      createReadStream(real).on('error', () => res.destroy()).pipe(res); return;
    }
    if (req.method === 'POST' && route === '/api/ask') {
      const { question, query, options, backend } = await body(req);
      if (typeof question !== 'string' || !question.trim() || question.length > 2000) return json(res,400,{error:'Enter a question under 2,000 characters.'});
      const engine=assistant.select?assistant.select(backend):assistant;
      const connection=engine.refreshStatus?await engine.refreshStatus():null;
      if(res.destroyed)return;
      if (!engine.configured) return json(res,400,{error:connection?.message || 'Configure the optional AI provider in .env first. See README.'});
      if (assistant.busy) return json(res,409,{error:'Assistant is already answering.'});
      const sources = library.search(typeof query === 'string' && query.trim() ? query : question,6,0,searchOptions(options)).papers.filter(p=>p.status==='ready').map(p=>({ ...p,
        excerpt: library.db.prepare('SELECT text FROM pages WHERE paper_id=? AND number=?').get(p.id,p.match_page || 1)?.text.slice(0,10000) || '' }));
      if (!sources.length) return json(res,400,{error:'No relevant text found. Search with topic keywords first.'});
      const abort = new AbortController();
      res.on('close',()=>abort.abort());
      res.writeHead(200,{'Content-Type':'application/x-ndjson','X-Accel-Buffering':'no'});
      const emit = event => { if (!res.destroyed) res.write(JSON.stringify(event)+'\n'); };
      emit({type:'sources',sources:sources.map(({id,title,match_page})=>({id,title,page:match_page || 1}))});
      try { await engine.ask(question,sources,emit,abort.signal); }
      catch(e) { emit({type:'error',error:e.message}); }
      res.end(); return;
    }
    const assets = { '/':'index.html', '/app.js':'app.js', '/highlight.js':'highlight.js', '/style.css':'style.css' };
    if (req.method === 'GET' && assets[route]) {
      const file = assets[route];
      res.writeHead(200,{'Content-Type':file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'text/html'});
      res.end(await fs.readFile(path.join(project,'public',file))); return;
    }
    json(res,404,{error:'Not found.'});
  } catch(e) {
    if (!res.headersSent) json(res,400,{error:e.code === 'ENOENT' ? 'Folder or file not found. Check its local path.' : e.message});
    else res.end();
  }
};
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
const data = path.resolve(process.env.DATA_DIR || path.join(project, 'data'));
await fs.mkdir(data, { recursive: true, mode: 0o700 });
const library = new Library(path.join(data, 'library.sqlite'));
const assistant = new AssistantService(data);
const port = Number(process.env.PORT || 3210);
const server = http.createServer(createHandler(library, assistant, port));
server.on('error', error => { console.error(`Could not start local server: ${error.message}`); process.exitCode = 1; library.db.close(); });
server.listen(port,'127.0.0.1',()=>console.log(`Papertrail is ready at http://127.0.0.1:${port}`));
let stopping = false;
async function stop() {
  if (stopping) return; stopping = true;
  if (library.job) library.job.cancelled = true;
  server.close();
  const timeout = setTimeout(()=>process.exit(1),8000).unref();
  await assistant.shutdown();
  // Allow an in-flight extraction to finish its transaction before closing SQLite.
  while (library.job?.running) await new Promise(resolve=>setTimeout(resolve,100));
  clearTimeout(timeout);
  library.db.close(); process.exit(0);
}
process.on('SIGINT',stop); process.on('SIGTERM',stop);
}
