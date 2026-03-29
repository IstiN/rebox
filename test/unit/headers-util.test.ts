import { describe, expect, it } from 'vitest';

import { asciiHeaderValue } from '../../src/headers-util.js';

describe('asciiHeaderValue', () => {
  it('keeps ASCII', () => {
    expect(asciiHeaderValue('Hello')).toBe('Hello');
  });

  it('drops non-ASCII', () => {
    expect(asciiHeaderValue('Привет')).toBe('');
  });
});
