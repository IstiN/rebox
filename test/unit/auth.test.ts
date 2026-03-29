import { describe, expect, it } from 'vitest';

import { buildApp } from '../../src/app.js';
import { loadConfig } from '../../src/config.js';
import { encodeUrlToToken } from '../../src/encode.js';

describe('API key auth', () => {
  it('returns 401 without key when REBOX_API_KEYS is set', async () => {
    const cfg = loadConfig({
      PORT: '0',
      HOST: '127.0.0.1',
      REBOX_API_KEYS: 'secret-key',
    });
    const { app } = await buildApp(cfg, { logger: false });
    const token = encodeUrlToToken('https://example.com/');
    const res = await app.inject({
      method: 'GET',
      url: `/rebox/${token}/text`,
    });
    await app.close();
    expect(res.statusCode).toBe(401);
  });

  it('allows health without key', async () => {
    const cfg = loadConfig({
      PORT: '0',
      HOST: '127.0.0.1',
      REBOX_API_KEYS: 'secret-key',
    });
    const { app } = await buildApp(cfg, { logger: false });
    const res = await app.inject({ method: 'GET', url: '/health' });
    await app.close();
    expect(res.statusCode).toBe(200);
  });
});
