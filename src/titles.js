import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const exec=promisify(execFile);
const clean=text=>text.normalize('NFKC').replace(/\s+/g,' ').trim();
const comparable=text=>clean(text).toLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').trim();
const decode=text=>text.replace(/&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos);/gi,(_,entity)=>{
  const named={amp:'&',lt:'<',gt:'>',quot:'"',apos:"'"};
  if(entity[0]!=='#')return named[entity.toLowerCase()];
  const n=entity[1].toLowerCase()==='x'?parseInt(entity.slice(2),16):Number(entity.slice(1));
  return n>0 && n<=0x10ffff?String.fromCodePoint(n):'';
});
const plausible=text=>text.length>=8 && text.length<=1000 && (text.match(/\p{L}+/gu)||[]).length>=2 &&
  !/https?:|www\.|doi\.org|@|^(?:review|review article|article|research article|open access|abstract|summary|introduction|graphical abstract|public summary|highlights|authors|untitled|microsoft word|problem solving protocol|insights & perspectives)$/i.test(text) &&
  !/\.docx?$|downloaded from|copyright|all rights reserved|\bjournal\b|^signal transduction and targeted therapy$|^briefings in bioinformatics/i.test(text);

export function titleFromLayout(xml) {
  const metadata=clean(decode(/<title>([\s\S]*?)<\/title>/i.exec(xml)?.[1] || ''));
  const candidates=[];
  let pageNumber=0;
  for(const page of xml.matchAll(/<page\b([^>]*)>([\s\S]*?)<\/page>/g)) {
    pageNumber++;
    const height=Number(/\bheight="([\d.]+)"/.exec(page[1])?.[1]) || 800;
    const visible=clean([...page[2].matchAll(/<word\b[^>]*>([\s\S]*?)<\/word>/g)].map(w=>decode(w[1])).join(' '));
    if(plausible(metadata) && comparable(visible).includes(comparable(metadata)))return {title:metadata,title_source:'pdf-metadata',title_page:pageNumber};
    for(const block of page[2].matchAll(/<block\b([^>]*)>([\s\S]*?)<\/block>/g)) {
      const y=Number(/\byMin="([\d.]+)"/.exec(block[1])?.[1]);
      if(!Number.isFinite(y) || y>height*.6)continue;
      const words=[...block[2].matchAll(/<word\b([^>]*)>([\s\S]*?)<\/word>/g)];
      const title=clean(words.map(w=>decode(w[2])).join(' '));
      if(!plausible(title))continue;
      const sizes=words.map(w=>Number(/\byMax="([\d.]+)"/.exec(w[1])?.[1])-Number(/\byMin="([\d.]+)"/.exec(w[1])?.[1])).filter(n=>n>0).sort((a,b)=>a-b);
      const size=sizes[Math.floor(sizes.length/2)] || 0;
      if(size) candidates.push({title,title_source:'pdf-layout',title_page:pageNumber,size,header:y<height*.2,score:size*3-y/height*5-pageNumber*2});
    }
  }
  // Large repeated section banners can be more prominent than article titles.
  const filtered=candidates.filter(c=>!c.header || c.title.split(' ').length>6 || !candidates.some(other=>other.title_page!==c.title_page && comparable(other.title)===comparable(c.title) && Math.abs(other.size-c.size)/c.size<.15));
  const best=filtered.sort((a,b)=>b.score-a.score)[0];
  if(!best)return null;
  const {score,size,header,...result}=best;return result;
}

export function titleFromText(pages) {
  for(const page of pages.slice(0,3)) {
    const groups=page.text.normalize('NFKC').split(/\n\s*\n/);
    for(const group of groups) {
      const lines=[];
      for(const line of group.split('\n').map(s=>s.trim()).filter(Boolean)) {
        if(/^(?:abstract|summary|authors|correspondence|keywords|received|published)\b/i.test(line))break;
        if((line.match(/\b\p{Lu}\p{Ll}+(?: \p{Lu}[\p{L}.]+)+/gu)||[]).length>=2 && /,/.test(line))break;
        if(/https?:|www\.|doi\.org|\b\d{4}\b/.test(line))continue;
        lines.push(line);
      }
      const title=clean(lines.join(' '));
      if(plausible(title))return {title,title_source:'pdf-text',title_page:page.number};
    }
  }
  return {title:'Untitled paper',title_source:'unavailable',title_page:1};
}

export async function readPaperTitle(file,pages,executable=process.env.PDFTOTEXT_PATH || 'pdftotext') {
  try {
    const {stdout}=await exec(executable,['-f','1','-l','3','-enc','UTF-8','-bbox-layout',file,'-'],{timeout:15000,maxBuffer:8*1024*1024});
    const title=titleFromLayout(stdout);if(title)return title;
  }catch { /* Text extraction can still provide a title if layout is unavailable. */ }
  return titleFromText(pages);
}
