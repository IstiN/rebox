import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { buildApp } from '../../src/app.js';
import { loadConfig } from '../../src/config.js';

const enabled = process.env.REBOX_INTEGRATION === '1';

function q(params: Record<string, string>): string {
  return new URLSearchParams(params).toString();
}

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/**
 * Parallel fetches against real sites (Google, YouTube, learn.ai) + coalescing check.
 * Run: REBOX_INTEGRATION=1 npx vitest run test/integration/parallel.integration.test.ts
 */
describe.skipIf(!enabled)('parallel integration (REBOX_INTEGRATION=1)', () => {
  let baseUrl: string;
  let stop: () => Promise<void>;

  beforeAll(async () => {
    const cfg = loadConfig({
      PORT: '0',
      HOST: '127.0.0.1',
      MAX_CONCURRENT_RENDERS: '2',
      REBOX_DEFAULT_SETTLE_MS: '1500',
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

  const imageOpts = q({
    timeout_ms: '120000',
    format: 'png',
    fullPage: 'false',
    wait_until: 'domcontentloaded',
    settle_ms: '1500',
  });

  it('parallel /image for google, youtube, learn.ai (distinct URLs)', async () => {
    const urls = [
      'https://www.google.com/',
      'https://www.youtube.com/',
      'https://learn.ai-native.pro/',
    ];
    const res = await Promise.all(
      urls.map((u) => fetch(`${baseUrl}/rebox/${encodeURIComponent(u)}/image?${imageOpts}`)),
    );
    for (let i = 0; i < res.length; i++) {
      const r = res[i]!;
      if (r.status !== 200) {
        const body = await r.text();
        throw new Error(`${urls[i]} -> HTTP ${r.status}: ${body.slice(0, 300)}`);
      }
      const buf = Buffer.from(await r.arrayBuffer());
      expect(buf.subarray(0, 8).equals(PNG_MAGIC), `${urls[i]} not a PNG`).toBe(true);
      expect(buf.length, `${urls[i]} empty image`).toBeGreaterThan(500);
    }
  }, 300_000);

  it('parallel /image same URL after /text coalesces (one extra capture)', async () => {
    const u = 'https://example.com/';
    const enc = encodeURIComponent(u);
    const textUrl = `${baseUrl}/rebox/${enc}/text?${q({ timeout_ms: '45000', settle_ms: '0', wait_until: 'domcontentloaded' })}`;
    const tr = await fetch(textUrl);
    expect(tr.status).toBe(200);
    await tr.json();

    const imgQs = q({ timeout_ms: '45000', format: 'png', fullPage: 'false', wait_until: 'domcontentloaded' });
    const imgPath = `${baseUrl}/rebox/${enc}/image?${imgQs}`;
    const t0 = Date.now();
    const [a, b, c] = await Promise.all([fetch(imgPath), fetch(imgPath), fetch(imgPath)]);
    const elapsed = Date.now() - t0;
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    expect(c.status).toBe(200);
    await Promise.all([a.arrayBuffer(), b.arrayBuffer(), c.arrayBuffer()]);
    expect(elapsed).toBeLessThan(120_000);
  }, 180_000);

  it('burst of mixed /text + /image on different hosts', async () => {
    const pairs: { u: string; kind: 'text' | 'image' }[] = [
      { u: 'https://example.com/', kind: 'text' },
      { u: 'https://example.org/', kind: 'image' },
      { u: 'https://learn.ai-native.pro/', kind: 'text' },
      { u: 'https://www.google.com/', kind: 'image' },
    ];
    const common = q({ timeout_ms: '90000', wait_until: 'domcontentloaded', settle_ms: '1000' });
    const res = await Promise.all(
      pairs.map(({ u, kind }) => {
        const extra = kind === 'image' ? '&format=png&fullPage=false' : '';
        return fetch(`${baseUrl}/rebox/${encodeURIComponent(u)}/${kind}?${common}${extra}`);
      }),
    );
    for (let i = 0; i < res.length; i++) {
      const r = res[i]!;
      if (r.status !== 200) {
        const body = await r.text();
        throw new Error(`${pairs[i]!.kind} ${pairs[i]!.u} -> ${r.status}: ${body.slice(0, 200)}`);
      }
    }
  }, 300_000);
});
