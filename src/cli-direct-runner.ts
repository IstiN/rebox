import { loadConfig, type Config } from './config.js';
import { runDefuddle } from './defuddle-service.js';
import { newRequestId, ReboxHttpError } from './errors.js';
import { resolveRender } from './render-coordinator.js';
import type { ScreenshotSpec } from './render-cache.js';
import { RenderSnapshotCache } from './render-cache.js';
import { RenderEngine } from './render-engine.js';
import {
  assertParsableAbsoluteUrl,
  audioQuerySchema,
  imageQuerySchema,
  parseNavParams,
  textQuerySchema,
} from './rebox-query.js';
import { assertSafeUrl } from './ssrf.js';
import { extractYoutubeVideoId } from './youtube.js';
import { loadYoutubeTranscript } from './youtube-transcript-service.js';

export type TextResultBody = {
  status: 'success';
  finalUrl: string;
  article: Awaited<ReturnType<typeof runDefuddle>>['article'];
  visibleText: string;
  rawHtml?: string;
  timingsMs: { navigation: number; defuddle: number };
  requestId: string;
};

export type AudioResultBody = {
  videoId: string;
  title: string | undefined;
  language: string | undefined;
  segments: Awaited<ReturnType<typeof loadYoutubeTranscript>>['segments'];
  timingsMs: { fetch: number };
  requestId: string;
};

let singleton: CliDirectRunner | null = null;

export function getCliDirectRunner(): CliDirectRunner {
  if (!singleton) singleton = new CliDirectRunner();
  return singleton;
}

export async function shutdownCliDirectRunner(): Promise<void> {
  if (singleton) {
    await singleton.close();
    singleton = null;
  }
}

/**
 * In-process rebox (Playwright + Defuddle + transcripts) for the CLI without HTTP.
 */
export class CliDirectRunner {
  private readonly cfg: Config;
  private readonly engine: RenderEngine;
  private readonly cache: RenderSnapshotCache;

  constructor() {
    this.cfg = loadConfig();
    this.engine = new RenderEngine(this.cfg);
    this.cache = new RenderSnapshotCache(this.cfg);
  }

  async warmBrowser(): Promise<void> {
    await this.engine.warm();
  }

  async close(): Promise<void> {
    await this.engine.close();
    this.cache._clear();
  }

  async runText(href: string, merged: Record<string, unknown>): Promise<TextResultBody> {
    assertParsableAbsoluteUrl(href);
    await assertSafeUrl(href, this.cfg);
    const q = textQuerySchema.parse(merged);
    const nav = parseNavParams(href, q, this.cfg);
    await this.engine.warm();

    const { snapshot } = await resolveRender(this.cache, this.engine, nav, null);

    const markdown = q.markdown !== 'false';
    const separateMarkdown = q.separateMarkdown === 'true';
    const includeRaw = q.includeRawHtml === 'true';
    const maxRaw = q.maxRawHtmlChars ?? 200_000;

    const { article, defuddleMs } = await runDefuddle(this.cfg, snapshot.finalUrl, snapshot.html, {
      markdown,
      separateMarkdown,
      language: q.locale,
      contentSelector: q.content_selector,
      debug: q.debug === 'true',
    });

    return {
      status: 'success',
      finalUrl: snapshot.finalUrl,
      article,
      visibleText: snapshot.visibleText,
      rawHtml:
        includeRaw && snapshot.html.length <= maxRaw
          ? snapshot.html
          : includeRaw
            ? snapshot.html.slice(0, maxRaw)
            : undefined,
      timingsMs: {
        navigation: snapshot.navigationMs,
        defuddle: defuddleMs,
      },
      requestId: newRequestId(),
    };
  }

  async runImage(
    href: string,
    merged: Record<string, unknown>,
  ): Promise<{ buffer: Buffer; mimeType: string; finalUrl: string; title: string; navigationMs: number }> {
    assertParsableAbsoluteUrl(href);
    await assertSafeUrl(href, this.cfg);
    const q = imageQuerySchema.parse(merged);
    const nav = parseNavParams(href, q, this.cfg);
    const spec: ScreenshotSpec = {
      format: q.format === 'webp' ? 'webp' : 'png',
      fullPage: q.fullPage !== 'false',
      maxHeightPx: q.maxHeightPx,
      quality: q.quality,
      scrollFullPage: q.scroll_full_page !== 'false',
    };

    await this.engine.warm();
    const { snapshot, image } = await resolveRender(this.cache, this.engine, nav, spec);
    if (!image) {
      throw new ReboxHttpError('INTERNAL', 'Image payload missing', 500);
    }
    return {
      buffer: image.buffer,
      mimeType: image.mimeType,
      finalUrl: snapshot.finalUrl,
      title: snapshot.title,
      navigationMs: snapshot.navigationMs,
    };
  }

  async runAudio(href: string, merged: Record<string, unknown>): Promise<AudioResultBody> {
    assertParsableAbsoluteUrl(href);
    await assertSafeUrl(href, this.cfg);
    const q = audioQuerySchema.parse(merged);

    const videoId = extractYoutubeVideoId(href);
    if (!videoId) {
      throw new ReboxHttpError('TRANSCRIPT_UNAVAILABLE', 'Not a YouTube URL', 404);
    }

    const t0 = Date.now();
    const { segments, captionLanguage } = await loadYoutubeTranscript(href, q.lang);
    const fetchMs = Date.now() - t0;

    return {
      videoId,
      title: undefined,
      language: q.lang ?? captionLanguage,
      segments,
      timingsMs: { fetch: fetchMs },
      requestId: newRequestId(),
    };
  }
}
