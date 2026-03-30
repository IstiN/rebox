import { describe, expect, it } from 'vitest';

import { extractClientApiKey } from '../../src/auth-util.js';

describe('extractClientApiKey', () => {
  it('reads X-API-Key', () => {
    expect(extractClientApiKey({ 'x-api-key': ' abc ', authorization: undefined })).toBe('abc');
  });

  it('reads Authorization Bearer', () => {
    expect(extractClientApiKey({ authorization: 'Bearer mytoken', 'x-api-key': undefined })).toBe(
      'mytoken',
    );
  });

  it('reads Authorization ApiKey', () => {
    expect(extractClientApiKey({ authorization: 'ApiKey x', 'x-api-key': undefined })).toBe('x');
  });

  it('prefers X-API-Key when both set', () => {
    expect(
      extractClientApiKey({ 'x-api-key': 'from-header', authorization: 'Bearer from-bearer' }),
    ).toBe('from-header');
  });
});
