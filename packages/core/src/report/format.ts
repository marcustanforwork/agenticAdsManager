// Report-only formatting for the digest and the brief (M07). Money, counts and percentages come from
// `@ads/contracts` (F2), shared with the Telegram cards and the dashboard. The report text is "Telegram
// markdown-lite": `# ` and `## ` headings, `- ` bullets and `**bold**`. The worker turns it into Telegram HTML
// (escaping everything else); `briefs.markdown` stores it as is.

/** Makes text safe to sit inside a markdown-lite line: no line breaks, no `**`, and not read as a heading or bullet.
 *  Used for anything that comes from an ad platform (entity names) before it goes into a report line. */
export function plainText(text: string, max = 80): string {
  const flat = text.replace(/\s+/g, ' ').replaceAll('**', '*').trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}
