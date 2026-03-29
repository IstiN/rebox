const B64URL_RE = /^[A-Za-z0-9_-]+$/;

/** One path segment: full URL via encodeURIComponent (slashes → %2F). */
export function encodeUrlPathSegment(url: string): string {
  return encodeURIComponent(url);
}

export function decodeUrlPathSegment(segment: string): string {
  let out: string;
  try {
    out = decodeURIComponent(segment.replace(/\+/g, ' ')).trim();
  } catch {
    throw new DecodeError('INVALID_ENCODING', 'invalid percent-encoding in path');
  }
  if (!out) {
    throw new DecodeError('INVALID_ENCODING', 'empty URL path segment');
  }
  return out;
}

export function encodeUrlToToken(url: string): string {
  return Buffer.from(url, 'utf8').toString('base64url').replace(/=+$/, '');
}

export function decodeUrlToken(token: string): string {
  if (!B64URL_RE.test(token)) {
    throw new DecodeError('INVALID_ENCODING', 'encodedUrl must be base64url (no padding)');
  }
  const padLen = (4 - (token.length % 4)) % 4;
  const padded = token + '='.repeat(padLen);
  const b64 = padded.replace(/-/g, '+').replace(/_/g, '/');
  let decoded: string;
  try {
    decoded = Buffer.from(b64, 'base64').toString('utf8');
  } catch {
    throw new DecodeError('INVALID_ENCODING', 'failed to decode base64url');
  }
  if (!decoded.trim()) {
    throw new DecodeError('INVALID_ENCODING', 'empty decoded URL');
  }
  return decoded;
}

export class DecodeError extends Error {
  constructor(
    public readonly code: 'INVALID_ENCODING',
    message: string,
  ) {
    super(message);
    this.name = 'DecodeError';
  }
}
