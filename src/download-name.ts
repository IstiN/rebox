/**
 * Build a safe download basename (no path segments, no extension) for screenshots.
 */

export type FilenameSource = 'host' | 'title';

const INVALID = /[/\\:*?"<>|\0\n\r]/g;

export function sanitizeBasename(raw: string, maxLen = 120): string {
  let s = raw.replace(INVALID, '-').replace(/\s+/g, ' ').trim();
  s = s.replace(/^\.+/, '').replace(/\.+$/, '');
  if (!s) return '';
  return s.length > maxLen ? s.slice(0, maxLen) : s;
}

export function hostnameBasename(finalUrl: string): string {
  try {
    const host = new URL(finalUrl).hostname;
    return sanitizeBasename(host) || 'screenshot';
  } catch {
    return 'screenshot';
  }
}

/** ASCII-ish slug from document title for filenames. */
export function titleBasename(title: string, maxLen = 80): string {
  const s = title
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, maxLen);
  return sanitizeBasename(s, maxLen) || '';
}

export function resolveScreenshotBasename(
  finalUrl: string,
  pageTitle: string,
  opts: {
    saveAs?: string;
    filenameSource?: FilenameSource;
  },
): string {
  const custom = opts.saveAs?.trim();
  if (custom) {
    const base = sanitizeBasename(custom);
    if (base) return base;
  }
  if (opts.filenameSource === 'title') {
    const fromTitle = titleBasename(pageTitle);
    if (fromTitle) return fromTitle;
  }
  return hostnameBasename(finalUrl);
}

/** RFC 6266-style Content-Disposition for inline image save dialogs. */
export function contentDispositionInlineFilename(stem: string, ext: 'png' | 'webp'): string {
  const full = `${stem}.${ext}`;
  const asciiSafe = /^[\x20-\x7e]+$/.test(full) && !full.includes('"');
  if (asciiSafe) {
    return `inline; filename="${full}"`;
  }
  const fallbackStem = sanitizeBasename(
    stem
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^\x20-\x7e]+/g, '_'),
  );
  const fb = `${fallbackStem || 'screenshot'}.${ext}`;
  return `inline; filename="${fb}"; filename*=UTF-8''${encodeURIComponent(full)}`;
}
