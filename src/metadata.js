// Conservative, offline heuristics. Missing fields remain empty and are editable.
export function extractMetadata(pages) {
  let abstract = '', authors = '', abstract_page = 1, authors_page = 1;
  for (const page of pages.slice(0, 3)) {
    const text = page.text.normalize('NFKC');
    if (!abstract) {
      const heading = /(?:^|\n)[ \t]*(?:abstract|summary)[ \t]*(?::[ \t]*|\n)/i.exec(text);
      if (heading) {
        const rest = text.slice(heading.index + heading[0].length);
        const stop = /\n[ \t]*(?:(?:\d+\.?[ \t]+)?introduction\b|keywords\b|key words\b|academic editor\b|received\b|copyright\b|\d+\.[ \t]+[A-Z])/i.exec(rest);
        abstract = rest.slice(0, stop?.index ?? 12000).trim().slice(0, 12000);
        abstract_page = page.number;
      }
    }
    if (!authors) {
      const opening = text.split(/(?:^|\n)[ \t]*(?:abstract|summary)[ \t]*(?::|\n)/i)[0];
      const explicit = /(?:^|\n)[ \t]*Authors[ \t]*\n([\s\S]*?)(?:\n\s*\n|\nCorrespondence|$)/i.exec(opening);
      if (explicit) authors = explicit[1].trim();
      else {
        const lines = opening.split('\n');
        const index = lines.findIndex(line => {
          if (!line.includes(',') || /university|department|hospital|institute|school|journal|centre|center|copyright|doi\.org/i.test(line)) return false;
          const names = line.match(/\b\p{Lu}\p{Ll}+(?:[ -]\p{Lu}\p{Ll}+| \p{Lu}\.){1,3}/gu) || [];
          return names.length >= 2;
        });
        if (index >= 0) {
          const nameLine=line=>{
            const cleaned=line.replace(/[\d*‡✉,;()]/g,' ').trim();
            const words=cleaned.split(/\s+/).filter(Boolean);
            return words.length>=2 && !/university|department|hospital|institute|school|correspondence|^From\b/i.test(cleaned) &&
              words.every(word=>/^(?:\p{Lu}[\p{L}.'’-]*|and|de|van|von|der)$/u.test(word));
          };
          let start=index;
          for(let j=index-1;j>=Math.max(0,index-6);j--) {
            if(!lines[j].trim())continue;
            if(!nameLine(lines[j]))break;start=j;
          }
          const byline=[];
          for(const line of lines.slice(start,start+30)) {
            if(!line.trim() || /^[\d ,*‡]+$/.test(line.trim()))continue;
            if(!nameLine(line))break;byline.push(line);
          }
          authors = byline.join(' ').replace(/[\d*‡✉]/g, '').replace(/(?:\s*,){2,}/g, ',').replace(/\s+,/g,',').replace(/\s+/g, ' ').replace(/^[, ]+|[, ]+$/g,'');
        }
      }
      if (authors) { authors = authors.slice(0, 4000); authors_page = page.number; }
    }
  }
  return { abstract, authors, abstract_page, authors_page };
}
