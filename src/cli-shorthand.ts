import { extractYoutubeVideoId } from './youtube.js';

/**
 * Trim pasted URLs that include terminal escape noise or control characters.
 */
export function sanitizePastedUrl(raw: string): string {
  let s = raw.trim().replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '');
  const bad = s.search(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/);
  if (bad >= 0) s = s.slice(0, bad);
  return s.trimEnd();
}

function shorthandSubcommandForUrl(url: string): 'audio' | 'text' {
  return extractYoutubeVideoId(url) ? 'audio' : 'text';
}

/**
 * When the user runs `rebox [global flags] <https://...> [options...]`
 * without an explicit subcommand, insert `text` or `audio` (YouTube) before the URL.
 * Globals: -b, -k, --base-url, --api-key, --header-style, --no-auto-server (and = forms for URL/key/style).
 */
export function applyUrlShorthand(args: string[]): string[] {
  if (args.length === 0) return args;
  const head = args[0];
  if (head === '-h' || head === '--help' || head === '-V' || head === '--version') {
    return args;
  }

  let i = 0;
  const globals: string[] = [];
  while (i < args.length) {
    const t = args[i];
    if (t === '-h' || t === '--help' || t === '-V' || t === '--version') {
      return args;
    }
    if (t === '--no-auto-server') {
      globals.push(t);
      i += 1;
      continue;
    }
    if (t === '-b' || t === '--base-url' || t === '-k' || t === '--api-key' || t === '--header-style') {
      const v = args[i + 1];
      if (v === undefined) return args;
      globals.push(t, v);
      i += 2;
      continue;
    }
    if (
      t.startsWith('--base-url=') ||
      t.startsWith('--api-key=') ||
      t.startsWith('--header-style=')
    ) {
      globals.push(t);
      i += 1;
      continue;
    }
    if (t.startsWith('-')) {
      return args;
    }
    break;
  }

  const rest = args.slice(i);
  if (rest.length === 0) return args;

  const known = new Set(['health', 'ready', 'info', 'docs', 'openapi', 'text', 'image', 'audio']);
  if (known.has(rest[0])) return args;

  const url = sanitizePastedUrl(rest[0]);
  if (!/^https?:\/\//i.test(url)) return args;

  if (rest.length > 1 && !rest[1].startsWith('-')) return args;

  const sub = shorthandSubcommandForUrl(url);
  const restWithCleanUrl = url === rest[0] ? rest : [url, ...rest.slice(1)];
  return [...globals, sub, ...restWithCleanUrl];
}
