import { createHash } from 'node:crypto';

export function weakEtag(body: string | Buffer): string {
  const h = createHash('sha256').update(body).digest('hex').slice(0, 32);
  return `W/"${h}"`;
}

export function ifNoneMatchMatches(ifNoneMatch: string | undefined, etag: string): boolean {
  if (!ifNoneMatch) return false;
  const candidates = ifNoneMatch.split(',').map((s) => s.trim());
  return candidates.includes(etag) || candidates.includes('*');
}
