import { ReboxHttpError } from './errors.js';
import type { NavParams, RenderSnapshot, RenderSnapshotCache, ScreenshotSpec } from './render-cache.js';
import { navCacheKey, screenshotCacheKey } from './render-cache.js';
import {
  RenderEngine,
  getScreenshotBuffer,
  getScreenshotMime,
} from './render-engine.js';

export async function resolveRender(
  cache: RenderSnapshotCache,
  engine: RenderEngine,
  nav: NavParams,
  shot: ScreenshotSpec | null,
): Promise<{
  snapshot: RenderSnapshot;
  image?: { buffer: Buffer; mimeType: string };
}> {
  const nk = navCacheKey(nav);
  const shotSpec = shot;
  const sk = shotSpec ? screenshotCacheKey(shotSpec) : null;

  const existing = cache.peek(nk);
  if (existing) {
    if (shotSpec && sk) {
      const buf = getScreenshotBuffer(existing, shotSpec);
      if (buf) {
        return {
          snapshot: existing,
          image: { buffer: buf, mimeType: getScreenshotMime(existing, shotSpec) },
        };
      }
      const extra = await engine.limiter.run(() => engine.capture(nav, shotSpec));
      const b = extra.screenshots.get(sk);
      const mime = extra.screenshotMimes.get(sk) ?? 'image/png';
      if (b) {
        existing.screenshots.set(sk, b);
        existing.screenshotMimes.set(sk, mime);
        return {
          snapshot: existing,
          image: { buffer: b, mimeType: mime },
        };
      }
      throw new ReboxHttpError('INTERNAL', 'Screenshot missing after capture', 500);
    }
    return { snapshot: existing };
  }

  const snapshot = await cache.getOrCreate(nk, () =>
    engine.limiter.run(() => engine.capture(nav, shotSpec)),
  );

  if (shotSpec && sk) {
    const buf = getScreenshotBuffer(snapshot, shotSpec);
    if (buf) {
      return {
        snapshot,
        image: { buffer: buf, mimeType: getScreenshotMime(snapshot, shotSpec) },
      };
    }
  }

  return { snapshot };
}
