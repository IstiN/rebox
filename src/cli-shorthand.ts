/**
 * When the user runs `rebox [global flags] <https://...> [text options...]`
 * without an explicit subcommand, insert `text` before the URL.
 * Globals: -b, -k, --base-url, --api-key, --header-style (and = forms).
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

  const url = rest[0];
  if (!/^https?:\/\//i.test(url)) return args;

  if (rest.length > 1 && !rest[1].startsWith('-')) return args;

  return [...globals, 'text', ...rest];
}
