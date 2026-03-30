import { describe, expect, it } from 'vitest';

import { buildApp } from '../../src/app.js';
import { loadConfig } from '../../src/config.js';

describe('plain /rebox/* routes', () => {
  it('GET /rebox/text without url returns 400', async () => {
    const cfg = loadConfig({ PORT: '0', HOST: '127.0.0.1' });
    const { app } = await buildApp(cfg, { logger: false });
    const res = await app.inject({ method: 'GET', url: '/rebox/text' });
    await app.close();
    expect(res.statusCode).toBe(400);
    const j = JSON.parse(res.body) as { code: string };
    expect(j.code).toBe('INVALID_URL');
  });
});
