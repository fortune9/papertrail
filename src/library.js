import { DatabaseSync } from 'node:sqlite';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { extractMetadata } from './metadata.js';
import { readPaperTitle } from './titles.js';
import { searchOptions, parseQuery, oneEdit, searchRanges } from './search.js';
const exec = promisify(execFile);

export class Library {
  constructor(filename) {
    this.db = new DatabaseSync(filename);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
      CREATE TABLE IF NOT EXISTS roots(path TEXT PRIMARY KEY);
      CREATE TABLE IF NOT EXISTS papers(id INTEGER PRIMARY KEY, path TEXT UNIQUE NOT NULL, root TEXT NOT NULL,
        title TEXT NOT NULL, mtime REAL NOT NULL, size INTEGER NOT NULL, pages INTEGER NOT NULL,
        status TEXT NOT NULL, error TEXT, indexed TEXT DEFAULT CURRENT_TIMESTAMP);
      CREATE TABLE IF NOT EXISTS pages(id INTEGER PRIMARY KEY, paper_id INTEGER REFERENCES papers(id) ON DELETE CASCADE,
        number INTEGER NOT NULL, text TEXT NOT NULL);`);
    this.migrateSearch();
    this.job = null;
  }
  migrateSearch() {
    const version = this.db.prepare('PRAGMA user_version').get().user_version;
    if (version === 3) return;
    if (version > 3) {
      this.db.close();
      throw new Error(`Database version ${version} is newer than this app supports.`);
    }
    // v0 used Porter stemming; v1 added literal tokens. Backfill metadata and
    // rebuild the derived index from stored pages without rereading PDFs.
    this.db.exec('BEGIN IMMEDIATE');
    try {
      if(version<2) {
      this.db.exec(`ALTER TABLE papers ADD COLUMN abstract TEXT NOT NULL DEFAULT '';
        ALTER TABLE papers ADD COLUMN authors TEXT NOT NULL DEFAULT '';
        ALTER TABLE papers ADD COLUMN abstract_page INTEGER NOT NULL DEFAULT 1;
        ALTER TABLE papers ADD COLUMN authors_page INTEGER NOT NULL DEFAULT 1;
        ALTER TABLE papers ADD COLUMN metadata_edited INTEGER NOT NULL DEFAULT 0;`);
      for (const paper of this.db.prepare('SELECT id FROM papers').all()) {
        const metadata = extractMetadata(this.db.prepare('SELECT number,text FROM pages WHERE paper_id=? ORDER BY number').all(paper.id));
        this.db.prepare('UPDATE papers SET abstract=?,authors=?,abstract_page=?,authors_page=? WHERE id=?')
          .run(metadata.abstract,metadata.authors,metadata.abstract_page,metadata.authors_page,paper.id);
      }
      this.db.exec(`DROP TABLE IF EXISTS search_vocab; DROP TABLE IF EXISTS search;
        CREATE VIRTUAL TABLE search USING fts5(title, text, paper_id UNINDEXED, page UNINDEXED, abstract, authors,
          tokenize='unicode61 remove_diacritics 0');
        CREATE VIRTUAL TABLE search_vocab USING fts5vocab(search,'col');
        INSERT INTO search(title,text,paper_id,page)
          SELECT p.title, coalesce(pg.text,''), p.id, coalesce(pg.number,1)
          FROM papers p LEFT JOIN pages pg ON pg.paper_id=p.id;
        PRAGMA user_version=2;`);
      this.db.exec(`UPDATE search SET abstract=coalesce((SELECT p.abstract FROM papers p WHERE p.id=search.paper_id AND p.abstract_page=search.page),''),
        authors=coalesce((SELECT p.authors FROM papers p WHERE p.id=search.paper_id AND p.authors_page=search.page),'');
        `);
      }
      this.db.exec(`ALTER TABLE papers ADD COLUMN title_source TEXT NOT NULL DEFAULT 'legacy';
        ALTER TABLE papers ADD COLUMN title_page INTEGER NOT NULL DEFAULT 1;
        ALTER TABLE papers ADD COLUMN title_version INTEGER NOT NULL DEFAULT 0;
        PRAGMA user_version=3; COMMIT;`);
    } catch(e) { this.db.exec('ROLLBACK'); this.db.close(); throw e; }
  }
  stats() {
    return { ...this.db.prepare(`SELECT count(*) total, coalesce(sum(status='ready'),0) ready,
      coalesce(sum(status='no-text'),0) scanned, coalesce(sum(status='error'),0) errors,
      coalesce(sum(pages),0) pages FROM papers`).get(),
      roots: this.db.prepare('SELECT path FROM roots ORDER BY path').all().map(r => r.path), job: this.job };
  }
  search(query = '', limit = 40, offset = 0, input = {}) {
    const options = searchOptions(input);
    if (!options.fields.length) return { total: 0, papers: [] };
    const clauses = parseQuery(query);
    if (!clauses.length) return { total: this.db.prepare('SELECT count(*) n FROM papers').get().n,
      papers: this.db.prepare('SELECT * FROM papers ORDER BY indexed DESC,id DESC LIMIT ? OFFSET ?').all(limit, offset) };
    // Whole words are the default. Optional prefix matching is explicit and does not change the stored index.
    const words=clauses.filter(clause=>clause.type==='word').flatMap(clause=>clause.words);
    const originals = new Set(words.map(w=>w.toLowerCase()));
    const expanded = new Set(originals);
    if (options.fuzzy) for (const word of words) {
      const lower=word.toLowerCase(), length=[...lower].length;
      if (length<5) continue;
      const vocabulary=this.db.prepare(`SELECT DISTINCT term FROM search_vocab WHERE col IN (${options.fields.map(()=>'?').join(',')}) AND length(term) BETWEEN ? AND ? ORDER BY term`).all(...options.fields,length-1,length+1);
      for (const {term} of vocabulary.filter(v=>oneEdit(lower,v.term)).slice(0,32)) expanded.add(term);
    }
    const expressions=[...expanded].map(w => `"${w}"${options.prefix && originals.has(w)?'*':''}`);
    for(const clause of clauses.filter(clause=>clause.type==='phrase'))expressions.push(`"${clause.words.map(word=>word.toLowerCase()).join(' ')}"`);
    const match = `{${options.fields.join(' ')}} : (${expressions.join(' OR ')})`;
    const rows = this.db.prepare(`SELECT p.*, search.page match_page,
      search.text matched_text, search.abstract matched_abstract, search.authors matched_authors,
      snippet(search,-1,'','',' … ',48) snippet, bm25(search,5,1,0,0,3,3) score
      FROM search JOIN papers p ON p.id=search.paper_id WHERE search MATCH ? ORDER BY score LIMIT 4000`).all(match);
    const grouped = new Map();
    for (const row of rows) {
      const content={title:row.title,text:row.matched_text,abstract:row.matched_abstract,authors:row.matched_authors};
      const ranges=Object.fromEntries(options.fields.map(field=>[field,searchRanges(content[field],clauses,options)]));
      const fields=options.fields.filter(field=>ranges[field].length);
      delete row.matched_text;delete row.matched_abstract;delete row.matched_authors;
      if (!fields.length) continue;
      row.matched_fields=fields;
      // In case-sensitive mode, FTS may choose a differently-cased occurrence.
      // Use an excerpt containing a verified matching token in the selected field.
      const field=fields.find(f=>f!=='title') || fields[0];
      const source=(content[field] || '').normalize('NFC');
      const occurrence=searchRanges(source,clauses,options)[0];
      if (occurrence) {
        let start=Math.max(0,occurrence.start-100),end=Math.max(occurrence.end,Math.min(source.length,occurrence.start+500));
        // Never turn a clipped word into a different apparent whole-word hit.
        for(const token of source.matchAll(/[\p{L}\p{N}][\p{L}\p{N}\p{M}]*/gu)) {
          const tokenEnd=token.index+token[0].length;
          if(token.index<start && tokenEnd>start)start=token.index;
          if(token.index<end && tokenEnd>end)end=tokenEnd;
        }
        row.snippet=(start?'… ':'')+source.slice(start,end)+(source.length>end?' …':'');
      }
      row.highlights={title:fields.includes('title')?ranges.title:[],snippet:searchRanges(row.snippet,clauses,options)};
      if (!grouped.has(row.id)) grouped.set(row.id, row);
    }
    const papers = [...grouped.values()];
    return { total: papers.length, capped: rows.length === 4000, papers: papers.slice(offset, offset + limit) };
  }
  detail(id) {
    const paper = this.db.prepare('SELECT * FROM papers WHERE id=?').get(id);
    if (!paper) return null;
    return { ...paper, content: this.db.prepare('SELECT number,text FROM pages WHERE paper_id=? ORDER BY number').all(id) };
  }
  indexMetadata(id) {
    const paper=this.db.prepare('SELECT * FROM papers WHERE id=?').get(id);
    this.db.prepare('UPDATE search SET title=? WHERE paper_id=?').run(paper.title,id);
    this.db.prepare(`UPDATE search SET abstract=CASE WHEN page=? THEN ? ELSE '' END,
      authors=CASE WHEN page=? THEN ? ELSE '' END WHERE paper_id=?`).run(paper.abstract_page,paper.abstract,paper.authors_page,paper.authors,id);
  }
  updateMetadata(id, input) {
    if (!this.detail(id)) throw new Error('Paper not found.');
    if (typeof input.abstract!=='string' || input.abstract.length>12000 || typeof input.authors!=='string' || input.authors.length>4000) throw new Error('Authors must be under 4,000 characters and abstract under 12,000.');
    if(input.title!==undefined && (typeof input.title!=='string' || !input.title.trim() || input.title.length>1000))throw new Error('Title must contain 1 to 1,000 characters.');
    this.db.exec('BEGIN');
    try {
      this.db.prepare('UPDATE papers SET abstract=?,authors=?,metadata_edited=1 WHERE id=?').run(input.abstract.trim(),input.authors.trim(),id);
      if(input.title!==undefined)this.db.prepare("UPDATE papers SET title=?,title_source='manual',title_version=1 WHERE id=?").run(input.title.trim(),id);
      this.indexMetadata(id);this.db.exec('COMMIT');
    } catch(e) {this.db.exec('ROLLBACK');throw e;}
    return this.detail(id);
  }
  async startImport(folder) {
    if (this.job?.running) throw new Error('An import is already running.');
    const root = await fs.realpath(path.resolve(folder));
    if (!(await fs.stat(root)).isDirectory()) throw new Error('Choose a directory.');
    this.db.prepare('INSERT OR IGNORE INTO roots VALUES (?)').run(root);
    const job = this.job = { running: true, root, discovered: 0, processed: 0, indexed: 0, unchanged: 0, failed: 0, removed: 0, current: '', issues: [], cancelled: false };
    this.importFolder(root, job).catch(e => { job.issues.push(e.message); }).finally(() => { job.running = false; job.current = ''; });
    return job;
  }
  async importFolder(root, job) {
    const files = [], seen = new Set(); let complete = true;
    const issue = (message) => { if (job.issues.length < 100) job.issues.push(message); };
    const walk = async dir => {
      if (job.cancelled) return;
      let entries;
      try { entries = await fs.readdir(dir, { withFileTypes: true }); }
      catch(e) { complete = false; issue(`${dir}: ${e.message}`); return; }
      for (const entry of entries) {
        if (job.cancelled) break;
        const file = path.join(dir, entry.name);
        // Do not follow symlinks out of the selected directory or into cycles.
        if (entry.isDirectory()) await walk(file);
        else if (entry.isFile() && /\.pdf$/i.test(entry.name)) { files.push(file); job.discovered++; }
      }
    };
    await walk(root);
    for (const file of files) {
      if (job.cancelled) break;
      seen.add(file); job.current = file;
      try {
        const stat = await fs.stat(file);
        const old = this.db.prepare('SELECT * FROM papers WHERE path=?').get(file);
        if (old && old.mtime === stat.mtimeMs && old.size === stat.size && old.status !== 'error') {
          if(!old.title_version) {
            const actual=await fs.realpath(file),relative=path.relative(root,actual);
            if(relative.startsWith('..') || path.isAbsolute(relative) || stat.size>100*1024*1024)throw new Error('PDF cannot be read within the selected folder and size limit.');
            const title=await readPaperTitle(actual,this.detail(old.id).content);
            this.db.exec('BEGIN');
            try{this.db.prepare('UPDATE papers SET title=?,title_source=?,title_page=?,title_version=1 WHERE id=?').run(title.title,title.title_source,title.title_page,old.id);this.indexMetadata(old.id);this.db.exec('COMMIT');}
            catch(e){this.db.exec('ROLLBACK');throw e;}
            job.indexed++;
          } else job.unchanged++;
          continue;
        }
        let pages = [], error = null;
        try {
          if (stat.size > 100 * 1024 * 1024) throw new Error('PDF exceeds 100 MB limit.');
          const actual = await fs.realpath(file);
          const relative = path.relative(root, actual);
          if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('PDF resolves outside the selected folder.');
          const { stdout } = await exec(process.env.PDFTOTEXT_PATH || 'pdftotext', ['-enc', 'UTF-8', actual, '-'], { timeout: 60000, maxBuffer: 32 * 1024 * 1024 });
          pages = stdout.split('\f');
          if (!pages.at(-1)?.trim()) pages.pop();
        } catch (e) { error = e.code === 'ENOENT' ? 'pdftotext is missing. Install Poppler; see README.' : e.message.slice(0, 500); }
        const status = error ? 'error' : pages.some(p => p.trim()) ? 'ready' : 'no-text';
        const extractedPages=pages.map((text,i)=>({number:i+1,text}));
        const titleInfo=old?.title_source==='manual'?{title:old.title,title_source:'manual',title_page:Math.min(old.title_page,Math.max(1,pages.length))}:
          error?{title:'Untitled paper',title_source:'unavailable',title_page:1}:await readPaperTitle(file,extractedPages);
        const title=titleInfo.title;
        this.db.exec('BEGIN');
        try {
          if (old) { this.db.prepare('DELETE FROM search WHERE paper_id=?').run(old.id); this.db.prepare('DELETE FROM pages WHERE paper_id=?').run(old.id); }
          const result = this.db.prepare(`INSERT INTO papers(path,root,title,mtime,size,pages,status,error) VALUES(?,?,?,?,?,?,?,?)
            ON CONFLICT(path) DO UPDATE SET title=excluded.title,mtime=excluded.mtime,size=excluded.size,pages=excluded.pages,
            status=excluded.status,error=excluded.error,indexed=CURRENT_TIMESTAMP RETURNING id`).get(file,root,title,stat.mtimeMs,stat.size,pages.length,status,error);
          for (let i = 0; i < pages.length; i++) {
            this.db.prepare('INSERT INTO pages(paper_id,number,text) VALUES(?,?,?)').run(result.id,i+1,pages[i]);
            this.db.prepare('INSERT INTO search(title,text,paper_id,page) VALUES(?,?,?,?)').run(title,pages[i],result.id,i+1);
          }
          if (!pages.length) this.db.prepare('INSERT INTO search(title,text,paper_id,page) VALUES(?,?,?,?)').run(title,'',result.id,1);
          const metadata=old?.metadata_edited ? {
            abstract:old.abstract,authors:old.authors,
            abstract_page:Math.min(old.abstract_page,Math.max(1,pages.length)),authors_page:Math.min(old.authors_page,Math.max(1,pages.length))
          } : extractMetadata(pages.map((text,i)=>({number:i+1,text})));
          this.db.prepare('UPDATE papers SET title_source=?,title_page=?,title_version=1 WHERE id=?').run(titleInfo.title_source,titleInfo.title_page,result.id);
          this.db.prepare('UPDATE papers SET abstract=?,authors=?,abstract_page=?,authors_page=? WHERE id=?')
            .run(metadata.abstract,metadata.authors,metadata.abstract_page,metadata.authors_page,result.id);
          this.indexMetadata(result.id);
          this.db.exec('COMMIT');
        } catch(e) { this.db.exec('ROLLBACK'); throw e; }
        if (error) { job.failed++; issue(`${file}: ${error}`); } else job.indexed++;
      } catch(e) { job.failed++; issue(`${file}: ${e.message}`); complete = false; }
      finally { job.processed++; }
      await new Promise(resolve => setImmediate(resolve));
    }
    if (complete && !job.cancelled) {
      for (const paper of this.db.prepare('SELECT id,path FROM papers WHERE root=?').all(root)) if (!seen.has(paper.path)) {
        this.db.exec('BEGIN');
        try { this.db.prepare('DELETE FROM search WHERE paper_id=?').run(paper.id); this.db.prepare('DELETE FROM papers WHERE id=?').run(paper.id); this.db.exec('COMMIT'); job.removed++; }
        catch(e) { this.db.exec('ROLLBACK'); throw e; }
      }
    }
  }
}
