import { describe, expect, it } from 'vitest';

import { loadConfig } from '../../src/config.js';

describe('loadConfig', () => {
  it('parses API keys list', () => {
    const c = loadConfig({
      REBOX_API_KEYS: ' a , b ',
      PORT: '4000',
    });
    expect(c.apiKeys).toEqual(['a', 'b']);
    expect(c.port).toBe(4000);
  });

  it('defaults when unset', () => {
    const c = loadConfig({});
    expect(c.port).toBe(3000);
    expect(c.apiKeys).toEqual([]);
    expect(c.allowHttp).toBe(false);
  });
});
