import { createHash } from 'node:crypto';

import type { Config } from './config.js';

export type WaitUntil = 'load' | 'domcontentloaded' | 'networkidle';

export interface ScreenshotSpec {
  format: 'png' | 'webp';
  fullPage: boolean;
  maxHeightPx?: number;
  quality?: number;
}

export interface NavParams {
  url: string;
  waitUntil: WaitUntil;
  timeoutMs: number;
  viewportW: number;
  viewportH: number;
  locale?: string;
  userAgent?: string;
}

export interface RenderSnapshot {
  finalUrl: string;
  title: string;
  html: string;
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

  /** @internal testing */
  _clear(): void {
    this.map.clear();
    this.inflight.clear();
  }
}
