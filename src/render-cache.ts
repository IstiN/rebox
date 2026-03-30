import { createHash } from 'node:crypto';

import type { Config } from './config.js';

export type WaitUntil = 'load' | 'domcontentloaded' | 'networkidle';

export interface ScreenshotSpec {
  format: 'png' | 'webp';
  fullPage: boolean;
  maxHeightPx?: number;
  quality?: number;
  /** When true (default for full-page shots), scroll to expand lazy content before capture */
  scrollFullPage?: boolean;
}

export interface NavParams {
  url: string;
  waitUntil: WaitUntil;
  timeoutMs: number;
  viewportW: number;
  viewportH: number;
  /** Milliseconds to wait in the page after navigation (hydration). */
  settleMs: number;
  locale?: string;
  userAgent?: string;
}

export interface RenderSnapshot {
  finalUrl: string;
  title: string;
  html: string;
  /** Plain text from the live DOM (helps when article extractors miss SPAs). */
  visibleText: string;
  navigationMs: number;
  createdAt: number;
  screenshots: Map<string, Buffer>;
  /** Parallel to `screenshots` keys from `screenshotCacheKey` */
  screenshotMimes: Map<string, string>;
}

function stableSerializeNav(p: NavParams): string {
  return JSON.stringify({
    url: p.url,
    waitUntil: p.waitUntil,
    timeoutMs: p.timeoutMs,
    viewportW: p.viewportW,
    viewportH: p.viewportH,
    settleMs: p.settleMs,
    locale: p.locale ?? '',
    userAgent: p.userAgent ?? '',
  });
}

export function navCacheKey(p: NavParams): string {
  return createHash('sha256').update(stableSerializeNav(p)).digest('hex');
}

export function screenshotCacheKey(parts: ScreenshotSpec): string {
  return JSON.stringify(parts);
}

export class RenderSnapshotCache {
  private readonly map = new Map<string, RenderSnapshot>();
  private readonly inflight = new Map<string, Promise<RenderSnapshot>>();
  /** Coalesce concurrent screenshot fills for the same nav + shot variant (cache had HTML only). */
  private readonly inflightShot = new Map<string, Promise<{ buffer: Buffer; mimeType: string }>>();

  constructor(private readonly cfg: Config) {}

  peek(key: string): RenderSnapshot | undefined {
    const e = this.map.get(key);
    if (!e) return undefined;
    if (Date.now() - e.createdAt > this.cfg.cacheTtlMs) {
      this.map.delete(key);
      return undefined;
    }
    return e;
  }

  getOrCreate(key: string, factory: () => Promise<RenderSnapshot>): Promise<RenderSnapshot> {
    const cached = this.peek(key);
    if (cached) return Promise.resolve(cached);

    const running = this.inflight.get(key);
    if (running) return running;

    const p = factory()
      .then((snap) => {
        this.map.set(key, snap);
        return snap;
      })
      .finally(() => {
        this.inflight.delete(key);
      });

    this.inflight.set(key, p);
    return p;
  }

  /**
   * Run `factory` once per composite key; parallel callers share the same promise
   * (e.g. many /image requests after one /text for the same URL).
   */
  coalesceShot(
    compositeKey: string,
    factory: () => Promise<{ buffer: Buffer; mimeType: string }>,
  ): Promise<{ buffer: Buffer; mimeType: string }> {
    const cur = this.inflightShot.get(compositeKey);
    if (cur) return cur;
    const p = factory().finally(() => {
      this.inflightShot.delete(compositeKey);
    });
    this.inflightShot.set(compositeKey, p);
    return p;
  }

  /** @internal testing */
  _clear(): void {
    this.map.clear();
    this.inflight.clear();
    this.inflightShot.clear();
  }
}
