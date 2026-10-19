// Telegram formatting (BLUEPRINT §5.15): HTML parse mode, with `<`, `>` and `&` escaped, and messages chunked at
// 4,000 characters (Telegram's limit is 4,096 after entity parsing). The reports are "markdown-lite" (core's
// report/format.ts): `# ` / `## ` headings and `**bold**` become <b>, `- ` bullets become "• "; everything else is
// escaped, so text from an ad platform can never become markup.

export const TELEGRAM_CHUNK = 4_000;

export function escapeHtml(text: string): string {
  return text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

/** Shortens text for one line (before escaping). */
export const clip = (text: string, max = 80): string => (text.length > max ? `${text.slice(0, max - 1)}…` : text);

/** Telegram refused the message itself (bad markup, too long): retrying the same text won't help. */
export const isBadRequest = (error: unknown): boolean =>
  typeof error === 'object' && error !== null && 'error_code' in error && error.error_code === 400;

/** Our HTML (only `<b>` and `<code>` tags, and escaped text) as plain text, for a message Telegram refused. */
export const htmlToPlain = (html: string): string =>
  html
    .replaceAll(/<\/?(?:b|code)>/g, '')
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&amp;', '&');

/** One markdown-lite line as Telegram HTML. `**` pairs become bold; an unpaired `**` stays as text. */
function lineToHtml(line: string): string {
  const heading = /^#{1,3} (.*)$/.exec(line);
  if (heading) return `<b>${escapeHtml(heading[1] ?? '')}</b>`;
  const body = line.startsWith('- ') ? `• ${line.slice(2)}` : line;
  const parts = escapeHtml(body).split('**');
  if (parts.length % 2 === 0) return escapeHtml(body); // unbalanced: no bold at all
  return parts.map((p, i) => (i % 2 === 1 ? `<b>${p}</b>` : p)).join('');
}

export function markdownLiteToHtml(markdown: string): string {
  return markdown.split('\n').map(lineToHtml).join('\n');
}

/** Removes the tags of our own markup (only `<b>` is used), keeping the escaped text. */
const stripTags = (html: string): string => html.replaceAll(/<\/?b>/g, '');

/** Splits a line that alone is over the limit, never inside an HTML entity. Its bold is dropped (a tag can't span
 *  two messages). */
function splitLong(line: string, max: number): string[] {
  const text = stripTags(line);
  const out: string[] = [];
  let rest = text;
  while (rest.length > max) {
    let cut = max;
    const amp = rest.lastIndexOf('&', cut);
    if (amp !== -1 && amp > cut - 6 && rest.indexOf(';', amp) >= cut) cut = amp; // don't cut "&amp;" in two
    const space = rest.lastIndexOf(' ', cut);
    if (space > max / 2) cut = space;
    out.push(rest.slice(0, cut));
    rest = rest.slice(cut).replace(/^ /, '');
  }
  if (rest !== '') out.push(rest);
  return out;
}

/** Chunks HTML at line boundaries, each chunk at most `max` characters. Every chunk is valid on its own: our tags
 *  never span lines. */
export function chunkHtml(html: string, max = TELEGRAM_CHUNK): string[] {
  const chunks: string[] = [];
  let current = '';
  const flush = (): void => {
    if (current.trim() !== '') chunks.push(current.replace(/\n+$/, ''));
    current = '';
  };
  for (const line of html.split('\n')) {
    const pieces = line.length > max ? splitLong(line, max) : [line];
    for (const piece of pieces) {
      const next = current === '' ? piece : `${current}\n${piece}`;
      if (next.length > max) {
        flush();
        current = piece;
      } else current = next;
    }
  }
  flush();
  return chunks;
}
