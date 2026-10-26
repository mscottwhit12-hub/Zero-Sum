/**
 * Tiny, safe Markdown subset for GM-written rule entries: headings (#), bullet lists (-),
 * paragraphs, **bold**, *italic*, and [links](https://…). Everything is HTML-escaped first,
 * so the output is safe for {@html}.
 */
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

function inline(s: string): string {
  return esc(s)
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*]+)\*/g, '$1<em>$2</em>')
    .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
}

export function markdown(src: string): string {
  const out: string[] = [];
  let list: string[] = [];
  let para: string[] = [];
  const flush = () => {
    if (para.length) out.push(`<p>${para.map(inline).join('<br>')}</p>`);
    if (list.length) out.push(`<ul>${list.map((l) => `<li>${inline(l)}</li>`).join('')}</ul>`);
    para = [];
    list = [];
  };
  for (const raw of src.split(/\r?\n/)) {
    const line = raw.trimEnd();
    const h = /^(#{1,3})\s+(.*)$/.exec(line);
    const li = /^\s*[-*]\s+(.*)$/.exec(line);
    if (!line.trim()) flush();
    else if (h) {
      flush();
      out.push(`<h4>${inline(h[2]!)}</h4>`);
    } else if (li) {
      if (para.length) flush();
      list.push(li[1]!);
    } else {
      if (list.length) flush();
      para.push(line);
    }
  }
  flush();
  return out.join('');
}
