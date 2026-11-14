export const SEARCH_FIELDS = ['title', 'text', 'abstract', 'authors'];
export function searchOptions(input = {}) {
  if (!input || typeof input !== 'object') throw new Error('Invalid search options.');
  const fields = input.fields === undefined ? ['title', 'text'] : input.fields;
  if (!Array.isArray(fields) || fields.some(f => !SEARCH_FIELDS.includes(f))) throw new Error('Invalid search fields.');
  for (const key of ['caseInsensitive', 'fuzzy']) if (input[key] !== undefined && typeof input[key] !== 'boolean') throw new Error(`Invalid ${key} option.`);
  return { fields: [...new Set(fields)], caseInsensitive: input.caseInsensitive !== false, fuzzy: input.fuzzy === true };
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
  return a===b || (options.fuzzy && [...a].length>=5 && oneEdit(a,b));
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
