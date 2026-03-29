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
      const shotKey = `${nk}::${sk}`;
      const { buffer: b, mimeType: mime } = await cache.coalesceShot(shotKey, async () => {
        if (getScreenshotBuffer(existing, shotSpec)) {
          const hit = getScreenshotBuffer(existing, shotSpec)!;
          return { buffer: hit, mimeType: getScreenshotMime(existing, shotSpec) };
        }
        const extra = await engine.limiter.run(() => engine.capture(nav, shotSpec));
        const nb = extra.screenshots.get(sk);
        const nm = extra.screenshotMimes.get(sk) ?? 'image/png';
        if (!nb) {
          throw new ReboxHttpError('INTERNAL', 'Screenshot missing after capture', 500);
        }
        existing.screenshots.set(sk, nb);
        existing.screenshotMimes.set(sk, nm);
        return { buffer: nb, mimeType: nm };
      });
      return {
        snapshot: existing,
        image: { buffer: b, mimeType: mime },
      };
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
