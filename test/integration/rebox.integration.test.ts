import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { buildApp } from '../../src/app.js';
import { loadConfig } from '../../src/config.js';
import { encodeUrlToToken } from '../../src/encode.js';

const enabled = process.env.REBOX_INTEGRATION === '1';

describe.skipIf(!enabled)('rebox integration (REBOX_INTEGRATION=1)', () => {
  let baseUrl: string;
  let stop: () => Promise<void>;

  beforeAll(async () => {
    const cfg = loadConfig({
      PORT: '0',
      HOST: '127.0.0.1',
      MAX_CONCURRENT_RENDERS: '2',
    });
    const { app } = await buildApp(cfg, { logger: false });
    await app.listen({ port: 0, host: '127.0.0.1' });
    const addr = app.server.address();
    if (!addr || typeof addr === 'string') throw new Error('no listen address');
    baseUrl = `http://127.0.0.1:${addr.port}`;
    stop = async () => {
      await app.close();
    };
  }, 120_000);

  afterAll(async () => {
    await stop?.();
  });

  it('GET /health', async () => {
    const res = await fetch(`${baseUrl}/health`);
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ status: 'ok' });
  });

  it('GET /ready', async () => {
    const res = await fetch(`${baseUrl}/ready`);
    expect(res.status).toBe(200);
    const j = await res.json();
    expect(j.status).toBe('ready');
  });

  it('GET /rebox/.../text for learn.ai-native.pro returns article JSON', async () => {
    const token = encodeUrlToToken('https://learn.ai-native.pro/');
    const res = await fetch(
      `${baseUrl}/rebox/${token}/text?wait_until=domcontentloaded&timeout_ms=45000`,
    );
    expect(res.status).toBe(200);
    const j = (await res.json()) as {
      finalUrl: string;
      article: { contentHtml?: string; contentMarkdown?: string };
      timingsMs: { navigation: number; defuddle: number };
    };
    expect(j.finalUrl).toMatch(/^https:\/\//);
    const text = (j.article.contentMarkdown ?? j.article.contentHtml ?? '').toLowerCase();
    expect(text.length).toBeGreaterThan(20);
  }, 120_000);

  it('GET /rebox/.../image returns raw PNG bytes', async () => {
    const token = encodeUrlToToken('https://learn.ai-native.pro/');
    const res = await fetch(
      `${baseUrl}/rebox/${token}/image?wait_until=domcontentloaded&timeout_ms=45000&format=png`,
    );
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/image\/png/);
    const buf = Buffer.from(await res.arrayBuffer());
    expect(buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe(
      true,
    );
    expect(buf.length).toBeGreaterThan(100);
  }, 120_000);

  it('second identical /image request is fast (screenshot cache hit)', async () => {
    const token = encodeUrlToToken('https://learn.ai-native.pro/');
    const url = `${baseUrl}/rebox/${token}/image?wait_until=domcontentloaded&timeout_ms=60000&format=png`;
    const r1 = await fetch(url);
    expect(r1.status).toBe(200);
    await r1.arrayBuffer();
    const t0 = Date.now();
    const r2 = await fetch(url);
    expect(r2.status).toBe(200);
    await r2.arrayBuffer();
    expect(Date.now() - t0).toBeLessThan(5000);
  }, 180_000);
});

describe('rebox integration smoke (always)', () => {
  it('buildApp exposes routes', async () => {
    const cfg = loadConfig({ PORT: '0', HOST: '127.0.0.1' });
    const { app } = await buildApp(cfg, { logger: false });
    await app.listen({ port: 0, host: '127.0.0.1' });
    try {
      const addr = app.server.address();
      if (!addr || typeof addr === 'string') throw new Error('addr');
      const baseUrl = `http://127.0.0.1:${addr.port}`;
      const res = await fetch(`${baseUrl}/health`);
      expect(res.ok).toBe(true);
    } finally {
      await app.close();
    }
  }, 120_000);
});
