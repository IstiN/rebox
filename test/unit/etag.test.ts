import { describe, expect, it } from 'vitest';

import { ifNoneMatchMatches, weakEtag } from '../../src/etag.js';

describe('weakEtag', () => {
  it('is stable for the same input', () => {
    const e = weakEtag('hello');
    expect(e).toMatch(/^W\/"/);
    expect(weakEtag('hello')).toBe(e);
  });

  it('changes when body changes', () => {
    expect(weakEtag('a')).not.toBe(weakEtag('b'));
  });
});

describe('ifNoneMatchMatches', () => {
  it('matches exact etag', () => {
    const t = weakEtag('x');
    expect(ifNoneMatchMatches(t, t)).toBe(true);
  });

  it('matches within list', () => {
    const t = weakEtag('x');
    expect(ifNoneMatchMatches(`abc, ${t}, def`, t)).toBe(true);
  });

  it('returns false when absent', () => {
    expect(ifNoneMatchMatches(undefined, 'W/"a"')).toBe(false);
  });
});
