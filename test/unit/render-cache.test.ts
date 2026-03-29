import { describe, expect, it, vi } from 'vitest';

import { loadConfig } from '../../src/config.js';
import { navCacheKey, RenderSnapshotCache, type NavParams } from '../../src/render-cache.js';

function nav(url: string): NavParams {
  return {
    url,
    waitUntil: 'networkidle',
    timeoutMs: 30_000,
    viewportW: 1280,
    viewportH: 720,
  };
}

describe('navCacheKey', () => {
  it('is stable for equivalent nav params', () => {
    expect(navCacheKey(nav('https://a'))).toBe(navCacheKey(nav('https://a')));
  });

  it('changes when URL changes', () => {
    expect(navCacheKey(nav('https://a'))).not.toBe(navCacheKey(nav('https://b')));
  });
});

describe('RenderSnapshotCache', () => {
  it('dedupes concurrent factory calls for the same key', async () => {
    const base = loadConfig({});
    const cache = new RenderSnapshotCache({ ...base, cacheTtlMs: 60_000 });
    let calls = 0;
    const key = navCacheKey(nav('https://x'));
    const snap = () => ({
      finalUrl: 'https://x',
      title: 't',
      html: '<html></html>',
      navigationMs: 1,
      createdAt: Date.now(),
      screenshots: new Map(),
      screenshotMimes: new Map(),
    });
    const p = cache.getOrCreate(key, async () => {
      calls++;
      await new Promise((r) => setTimeout(r, 20));
      return snap();
    });
    const p2 = cache.getOrCreate(key, async () => {
      calls++;
      return snap();
    });
    await Promise.all([p, p2]);
    expect(calls).toBe(1);
  });

  it('expires entries after TTL', async () => {
    vi.useFakeTimers();
    const base = loadConfig({});
    const cache = new RenderSnapshotCache({ ...base, cacheTtlMs: 1000 });
    const key = navCacheKey(nav('https://y'));
    const t0 = new Date('2020-01-01T00:00:00Z').getTime();
    vi.setSystemTime(t0);
    await cache.getOrCreate(key, async () => ({
      finalUrl: 'https://y',
      title: 't',
      html: '<html></html>',
      navigationMs: 1,
      createdAt: Date.now(),
      screenshots: new Map(),
      screenshotMimes: new Map(),
    }));
    expect(cache.peek(key)).toBeDefined();
    vi.setSystemTime(t0 + 2000);
    expect(cache.peek(key)).toBeUndefined();
    vi.useRealTimers();
  });
});
