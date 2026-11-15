export const SEARCH_FIELDS = ['title', 'text', 'abstract', 'authors'];
export function searchOptions(input = {}) {
  if (!input || typeof input !== 'object') throw new Error('Invalid search options.');
  const fields = input.fields === undefined ? ['title', 'text'] : input.fields;
  if (!Array.isArray(fields) || fields.some(f => !SEARCH_FIELDS.includes(f))) throw new Error('Invalid search fields.');
  for (const key of ['caseInsensitive', 'fuzzy', 'prefix']) if (input[key] !== undefined && typeof input[key] !== 'boolean') throw new Error(`Invalid ${key} option.`);
  return { fields: [...new Set(fields)], caseInsensitive: input.caseInsensitive !== false, fuzzy: input.fuzzy === true, prefix: input.prefix === true };
}
export const tokens = text => String(text || '').normalize('NFC').match(/[\p{L}\p{N}]+/gu) || [];

// One insertion, deletion, substitution or adjacent transposition. A case-only
// difference cannot count as a typo when case-sensitive matching is selected.
export function oneEdit(a, b) {
  if (a === b) return true;
  const x = [...a], y = [...b];
  if (Math.abs(x.length-y.length)>1) return false;
  let i=0;while(i<x.length && i<y.length && x[i]===y[i])i++;
  if (x.length===y.length) {
    if (x[i]?.toLowerCase()===y[i]?.toLowerCase()) return false;
    return x.slice(i+1).join('')===y.slice(i+1).join('') ||
      (x[i]===y[i+1] && x[i+1]===y[i] && x.slice(i+2).join('')===y.slice(i+2).join(''));
  }
  return x.length>y.length ? x.slice(i+1).join('')===y.slice(i).join('') : x.slice(i).join('')===y.slice(i+1).join('');
}
export function termMatches(query, candidate, options) {
  const a = options.caseInsensitive ? query.toLowerCase() : query;
  const b = options.caseInsensitive ? candidate.toLowerCase() : candidate;
  return a===b || (options.prefix && b.startsWith(a)) || (options.fuzzy && [...a].length>=5 && oneEdit(a,b));
}

// UTF-16 offsets into the original string, suitable for JS slice(). Include
// combining marks so an accented token is matched and highlighted as a unit.
export function matchRanges(text, words, options) {
  const ranges=[];
  for(const match of String(text || '').matchAll(/[\p{L}\p{N}][\p{L}\p{N}\p{M}]*/gu)) {
    if(words.some(word=>termMatches(word,match[0].normalize('NFC'),options))) ranges.push({start:match.index,end:match.index+match[0].length});
  }
  return ranges;
}

// Paired double quotes make an exact token phrase. An unfinished quote stays
// ordinary text so typing a query does not temporarily erase all its terms.
export function parseQuery(text) {
  const clauses=[];let count=0;
  for(const part of String(text || '').replace(/[“”]/g,'"').matchAll(/"([^"]*)"|([^"\s][^"]*)/gu)) {
    const phrase=part[1]!==undefined,words=tokens(phrase?part[1]:part[2]);
    if(!words.length)continue;
    count+=words.length;if(count>24)throw new Error('Search supports up to 24 words. Shorten the query.');
    if(phrase)clauses.push({type:'phrase',words});
    else clauses.push(...words.map(word=>({type:'word',words:[word]})));
  }
  return clauses;
}

export function searchRanges(text,clauses,options) {
  const value=String(text || ''),words=clauses.filter(clause=>clause.type==='word').flatMap(clause=>clause.words);
  const ranges=words.length?matchRanges(value,words,options):[];
  const phrases=clauses.filter(clause=>clause.type==='phrase');
  if(!phrases.length)return ranges;
  const parts=[...value.matchAll(/[\p{L}\p{N}][\p{L}\p{N}\p{M}]*/gu)];
  const fold=word=>options.caseInsensitive?word.normalize('NFC').toLowerCase():word.normalize('NFC');
  const normalized=parts.map(part=>fold(part[0]));
  for(const clause of phrases){
    const phrase=clause.words.map(fold);
    for(let i=0;i<=parts.length-phrase.length;i++)if(phrase.every((word,j)=>word===normalized[i+j])){
      const last=parts[i+phrase.length-1];ranges.push({start:parts[i].index,end:last.index+last[0].length});
    }
  }
  const merged=[];
  for(const range of ranges.sort((a,b)=>a.start-b.start || b.end-a.end)){
    const previous=merged.at(-1);
    if(previous && range.start<=previous.end)previous.end=Math.max(previous.end,range.end);
    else merged.push({...range});
  }
  return merged;
}
