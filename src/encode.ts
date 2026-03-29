const B64URL_RE = /^[A-Za-z0-9_-]+$/;

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
