import { chromium, type Browser, type Page } from 'playwright';

import type { Config } from './config.js';
import { ReboxHttpError } from './errors.js';
import type { NavParams, RenderSnapshot, ScreenshotSpec } from './render-cache.js';
import { screenshotCacheKey } from './render-cache.js';

export class Limiter {
  private active = 0;
  private readonly waiters: Array<() => void> = [];

  constructor(private readonly max: number) {}

  async run<T>(fn: () => Promise<T>): Promise<T> {
    await this.acquire();
    try {
      return await fn();
    } finally {
      this.release();
    }
  }

  private acquire(): Promise<void> {
    if (this.active < this.max) {
      this.active++;
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      this.waiters.push(() => {
        this.active++;
        resolve();
      });
    });
  }

  private release(): void {
    this.active--;
    const next = this.waiters.shift();
    if (next) next();
  }
}

export class RenderEngine {
  private browser: Browser | null = null;
  readonly limiter: Limiter;

  constructor(private readonly cfg: Config) {
    this.limiter = new Limiter(cfg.maxConcurrentRenders);
  }

  async warm(): Promise<void> {
    await this.ensureBrowser();
  }

  async ensureBrowser(): Promise<Browser> {
    if (this.browser?.isConnected()) return this.browser;
    try {
      this.browser = await chromium.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
      });
    } catch (e) {
      throw new ReboxHttpError(
        'BROWSER_CRASH',
        e instanceof Error ? e.message : 'Failed to launch browser',
        502,
      );
    }
    return this.browser;
  }

  async close(): Promise<void> {
    await this.browser?.close().catch(() => {});
    this.browser = null;
  }

  /**
   * Single navigation; optionally capture one screenshot variant before closing the context.
   */
  async capture(nav: NavParams, screenshot: ScreenshotSpec | null): Promise<RenderSnapshot> {
    const browser = await this.ensureBrowser();
    const context = await browser.newContext({
      viewport: { width: nav.viewportW, height: nav.viewportH },
      locale: nav.locale,
      userAgent: nav.userAgent,
    });
    const page = await context.newPage();
    const t0 = Date.now();
    try {
      await page.goto(nav.url, {
        waitUntil: nav.waitUntil,
        timeout: nav.timeoutMs,
      });
    } catch (e) {
      await context.close().catch(() => {});
      const msg = e instanceof Error ? e.message : String(e);
      if (/timeout|Timeout/i.test(msg)) {
        throw new ReboxHttpError('TIMEOUT', msg, 408);
      }
      throw new ReboxHttpError('NAVIGATION_FAILED', msg, 502);
    }
    const navigationMs = Date.now() - t0;

    let html: string;
    try {
      html = await page.content();
    } catch (e) {
      await context.close().catch(() => {});
      throw new ReboxHttpError(
        'NAVIGATION_FAILED',
        e instanceof Error ? e.message : String(e),
        502,
      );
    }

    if (html.length > this.cfg.maxHtmlChars) {
      await context.close().catch(() => {});
      throw new ReboxHttpError('BODY_TOO_LARGE', 'Rendered HTML exceeds limit', 413);
    }

    const title = await page.title();
    const finalUrl = page.url();
    const screenshots = new Map<string, Buffer>();
    const screenshotMimes = new Map<string, string>();

    if (screenshot) {
      const sk = screenshotCacheKey(screenshot);
      try {
        const { buffer, mimeType } = await this.takeScreenshot(page, screenshot, nav.viewportW, nav.viewportH);
        if (buffer.length > this.cfg.maxScreenshotBytes) {
          await context.close().catch(() => {});
          throw new ReboxHttpError('SCREENSHOT_TOO_LARGE', 'Screenshot exceeds limit', 413);
        }
        screenshots.set(sk, buffer);
        screenshotMimes.set(sk, mimeType);
      } catch (e) {
        await context.close().catch(() => {});
        if (e instanceof ReboxHttpError) throw e;
        throw new ReboxHttpError(
          'NAVIGATION_FAILED',
          e instanceof Error ? e.message : String(e),
          502,
        );
      }
    }

    await context.close().catch(() => {});

    return {
      finalUrl,
      title,
      html,
      navigationMs,
      createdAt: Date.now(),
      screenshots,
      screenshotMimes,
    };
  }

  private async takeScreenshot(
    page: Page,
    spec: ScreenshotSpec,
    viewportW: number,
    viewportH: number,
  ): Promise<{ buffer: Buffer; mimeType: string }> {
    const base: Parameters<Page['screenshot']>[0] = {
      fullPage: spec.fullPage,
      timeout: 120_000,
    };

    if (!spec.fullPage && spec.maxHeightPx) {
      const h = Math.min(spec.maxHeightPx, viewportH);
      base.clip = { x: 0, y: 0, width: viewportW, height: h };
    }

    if (spec.format === 'png') {
      const buffer = await page.screenshot({ ...base, type: 'png' });
      return { buffer, mimeType: 'image/png' };
    }

    if (spec.format === 'webp') {
      try {
        const buffer = await page.screenshot({
          ...base,
          type: 'webp' as 'png',
          quality: spec.quality,
        } as Parameters<Page['screenshot']>[0]);
        return { buffer, mimeType: 'image/webp' };
      } catch {
        const buffer = await page.screenshot({ ...base, type: 'png' });
        return { buffer, mimeType: 'image/png' };
      }
    }

    const buffer = await page.screenshot({ ...base, type: 'png' });
    return { buffer, mimeType: 'image/png' };
  }
}

export function getScreenshotMime(snapshot: RenderSnapshot, spec: ScreenshotSpec): string {
  const sk = screenshotCacheKey(spec);
  return snapshot.screenshotMimes.get(sk) ?? 'image/png';
}

export function getScreenshotBuffer(snapshot: RenderSnapshot, spec: ScreenshotSpec): Buffer | undefined {
  return snapshot.screenshots.get(screenshotCacheKey(spec));
}
