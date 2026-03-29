import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { buildApp } from '../../src/app.js';
import { loadConfig } from '../../src/config.js';

const enabled = process.env.REBOX_INTEGRATION === '1';

function q(params: Record<string, string>): string {
  return new URLSearchParams(params).toString();
}

function pathRebox(targetUrl: string, kind: 'text' | 'image' | 'audio'): string {
  return `/rebox/${encodeURIComponent(targetUrl)}/${kind}`;
}

describe.skipIf(!enabled)('rebox integration (REBOX_INTEGRATION=1)', () => {
  let baseUrl: string;
  let stop: () => Promise<void>;

  beforeAll(async () => {
    const cfg = loadConfig({
      PORT: '0',
      HOST: '127.0.0.1',
      MAX_CONCURRENT_RENDERS: '2',
      REBOX_DEFAULT_SETTLE_MS: '2500',
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

  it('GET / returns API map (path segment URL)', async () => {
    const res = await fetch(`${baseUrl}/`);
    expect(res.status).toBe(200);
    const j = (await res.json()) as { service: string; routes: { text: string } };
    expect(j.service).toBe('rebox');
    expect(j.routes.text).toMatch(/\/rebox\/.+\/text$/);
    expect(j.routes.text).not.toContain('?url=');
  });

  it('GET /health', async () => {
    const res = await fetch(`${baseUrl}/health`);
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ status: 'ok' });
  });

  it('GET /rebox/:encoded/text — learn.ai-native.pro without trailing slash', async () => {
    const path = pathRebox('https://learn.ai-native.pro', 'text');
    const res = await fetch(`${baseUrl}${path}?${q({ timeout_ms: '90000' })}`);
    expect(res.status).toBe(200);
    const j = (await res.json()) as { visibleText: string };
    expect(j.visibleText.length).toBeGreaterThan(50);
  }, 120_000);

  it('GET /ready', async () => {
    const res = await fetch(`${baseUrl}/ready`);
    expect(res.status).toBe(200);
    const j = await res.json();
    expect(j.status).toBe('ready');
  });

  it('GET /rebox/.../text learn.ai-native.pro/ returns visibleText + article', async () => {
    const url = 'https://learn.ai-native.pro/';
    const res = await fetch(`${baseUrl}${pathRebox(url, 'text')}?${q({ timeout_ms: '90000' })}`);
    expect(res.status).toBe(200);
    const j = (await res.json()) as {
      finalUrl: string;
      visibleText: string;
      article: { contentHtml?: string; contentMarkdown?: string };
    };
    expect(j.finalUrl).toMatch(/^https:\/\//);
    expect(j.visibleText.length).toBeGreaterThan(80);
    const extracted = (j.article.contentMarkdown ?? j.article.contentHtml ?? '').length;
    expect(extracted + j.visibleText.length).toBeGreaterThan(80);
  }, 120_000);

  it('GET /rebox/.../image learn.ai-native.pro returns PNG', async () => {
    const url = 'https://learn.ai-native.pro/';
    const res = await fetch(`${baseUrl}${pathRebox(url, 'image')}?${q({ timeout_ms: '90000', format: 'png' })}`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/image\/png/);
    const buf = Buffer.from(await res.arrayBuffer());
    expect(buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe(
      true,
    );
  }, 120_000);

  it('second identical /image is fast (cache)', async () => {
    const url = 'https://learn.ai-native.pro/';
    const path = pathRebox(url, 'image');
    const qs = q({ timeout_ms: '90000', format: 'png' });
    const r1 = await fetch(`${baseUrl}${path}?${qs}`);
    expect(r1.status).toBe(200);
    await r1.arrayBuffer();
    const t0 = Date.now();
    const r2 = await fetch(`${baseUrl}${path}?${qs}`);
    expect(r2.status).toBe(200);
    await r2.arrayBuffer();
    expect(Date.now() - t0).toBeLessThan(8000);
  }, 180_000);
});

describe('rebox integration smoke (always)', () => {
  it('buildApp exposes routes', async () => {
    const cfg = loadConfig({
      PORT: '0',
      HOST: '127.0.0.1',
      REBOX_DEFAULT_SETTLE_MS: '0',
    });
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
