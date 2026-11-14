// Run with the packaged Electron executable in Node mode, without a global Node
// install. This verifies bundled components; it is not a graphical/login test.
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import assert from 'node:assert/strict';
import { Library } from '../src/library.js';
import { desktopPaths } from './paths.js';
import { Assistant } from '../src/assistant.js';
const exec=promisify(execFile),appRoot=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const paths=desktopPaths({packaged:true,resourcesPath:path.dirname(appRoot),appRoot});
const directory=await fs.mkdtemp(path.join(os.tmpdir(),'papertrail-packaged-smoke-'));
let assistant,library;
try{
  const {stdout}=await exec(paths.codex,['--version'],{timeout:10000});assert.match(stdout,/0\.169\.0/);
  assistant=new Assistant(directory,{env:{AI_MODEL:'fixture',AI_BASE_URL:'http://127.0.0.1:9/v1',AI_API:'chat-completions'},executable:paths.openworker,agentName:'packaged-smoke-v1',providerName:'PackagedFixture'});
  const {agent}=await assistant.open();await agent.newSession();await assistant.shutdown();assistant=null;
  const pdfDirectory=path.join(directory,'papers');await fs.mkdir(pdfDirectory);
  const text='BT /F1 18 Tf 40 700 Td (Packaged Papertrail Evidence) Tj ET';
  const objects=['<< /Type /Catalog /Pages 2 0 R >>','<< /Type /Pages /Count 1 /Kids [4 0 R] >>','<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>','<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents 5 0 R >>',`<< /Length ${text.length} >>\nstream\n${text}\nendstream`];
  let pdf='%PDF-1.4\n';const offsets=[];for(const [i,object]of objects.entries()){offsets.push(pdf.length);pdf+=`${i+1} 0 obj\n${object}\nendobj\n`;}
  const start=pdf.length;pdf+='xref\n0 6\n0000000000 65535 f \n'+offsets.map(n=>String(n).padStart(10,'0')+' 00000 n \n').join('')+`trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${start}\n%%EOF\n`;
  await fs.writeFile(path.join(pdfDirectory,'misleading-filename.pdf'),pdf);
  library=new Library(path.join(directory,'library.sqlite'));await library.startImport(pdfDirectory);while(library.job.running)await new Promise(resolve=>setTimeout(resolve,20));
  assert.equal(library.stats().ready,1);assert.equal(library.search('Evidence').total,1);assert.equal(library.search('').papers[0].title,'Packaged Papertrail Evidence');
  library.db.close();library=new Library(path.join(directory,'library.sqlite'));assert.equal(library.search('Evidence').total,1);
  console.log(JSON.stringify({electron:process.versions.electron,node:process.versions.node,sqlite:process.versions.sqlite,codex:'0.169.0',openworker:'runtime/agent/session/shutdown passed',pdf:'title/extraction/search/reopen passed'}));
}finally{library?.db.close();await assistant?.shutdown();await fs.rm(directory,{recursive:true,force:true});}
