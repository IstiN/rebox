import { describe, expect, it } from 'vitest';

import { buildChromeLikeUserAgent } from '../../src/chromium-stealth.js';

describe('buildChromeLikeUserAgent', () => {
  it('embeds the Chromium version and never HeadlessChrome', () => {
    const ua = buildChromeLikeUserAgent('145.0.7632.6');
    expect(ua).toContain('Chrome/145.0.7632.6');
    expect(ua).toContain('Safari/537.36');
    expect(ua).not.toMatch(/HeadlessChrome/i);
  });
});
