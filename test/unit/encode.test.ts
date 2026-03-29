import { describe, expect, it } from 'vitest';

import {
  DecodeError,
  decodeUrlPathSegment,
  decodeUrlToken,
  encodeUrlPathSegment,
  encodeUrlToToken,
} from '../../src/encode.js';

describe('encodeUrlPathSegment / decodeUrlPathSegment', () => {
  it('roundtrips full URL for one path segment', () => {
    const url = 'https://learn.ai-native.pro/path?q=1';
    const seg = encodeUrlPathSegment(url);
    expect(seg).not.toContain('/');
    expect(decodeUrlPathSegment(seg)).toBe(url);
  });
});

describe('encodeUrlToToken / decodeUrlToken', () => {
  it('roundtrips a typical https URL', () => {
    const url = 'https://learn.ai-native.pro/path?q=1';
    const token = encodeUrlToToken(url);
    expect(token).not.toContain('=');
    expect(decodeUrlToken(token)).toBe(url);
  });

  it('roundtrips unicode', () => {
    const url = 'https://example.com/привет';
    const token = encodeUrlToToken(url);
    expect(decodeUrlToken(token)).toBe(url);
  });

  it('rejects invalid characters in token', () => {
    expect(() => decodeUrlToken('bad token!')).toThrow(DecodeError);
  });

  it('rejects whitespace-only decoded URL', () => {
    const token = Buffer.from('   ', 'utf8').toString('base64url').replace(/=+$/, '');
    expect(() => decodeUrlToken(token)).toThrow(DecodeError);
  });
});
