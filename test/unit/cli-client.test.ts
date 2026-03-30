import { describe, expect, it } from 'vitest';

import { buildAuthHeaders, normalizeBaseUrl } from '../../src/cli-client.js';

describe('cli-client', () => {
  it('normalizeBaseUrl strips trailing slashes', () => {
    expect(normalizeBaseUrl('https://x/')).toBe('https://x');
    expect(normalizeBaseUrl('  https://x  ')).toBe('https://x');
  });

  it('normalizeBaseUrl rejects empty', () => {
    expect(() => normalizeBaseUrl('')).toThrow('empty');
    expect(() => normalizeBaseUrl('  ')).toThrow('empty');
  });

  it('buildAuthHeaders', () => {
    expect(buildAuthHeaders(undefined, 'bearer')).toEqual({});
    expect(buildAuthHeaders('  ', 'bearer')).toEqual({});
    expect(buildAuthHeaders('k', 'bearer')).toEqual({ Authorization: 'Bearer k' });
    expect(buildAuthHeaders('k', 'x-api-key')).toEqual({ 'X-API-Key': 'k' });
  });
});
