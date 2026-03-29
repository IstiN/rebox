/** HTTP headers should be ASCII; drop non-ASCII titles for header safety. */
export function asciiHeaderValue(s: string, maxLen = 200): string {
  const trimmed = s.slice(0, maxLen);
  if (/^[\t\x20-\x7e]*$/.test(trimmed)) return trimmed;
  return '';
}
