// Build text and mark nodes only. PDF/model strings are never parsed as HTML.
export function appendHighlighted(target, text, ranges = []) {
  const value=String(text || '');
  const document=target.ownerDocument;
  let cursor=0;
  for(const {start,end} of ranges) {
    if(!Number.isInteger(start) || !Number.isInteger(end) || start<cursor || end<=start || end>value.length)continue;
    if(start>cursor)target.append(document.createTextNode(value.slice(cursor,start)));
    const mark=document.createElement('mark');mark.textContent=value.slice(start,end);target.append(mark);
    cursor=end;
  }
  if(cursor<value.length)target.append(document.createTextNode(value.slice(cursor)));
}
