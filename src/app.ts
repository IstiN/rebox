import Fastify, { type FastifyInstance } from 'fastify';
import { z } from 'zod';

import type { Config } from './config.js';
import { runDefuddle } from './defuddle-service.js';
import { errorBody, newRequestId, ReboxHttpError, type ErrorCode } from './errors.js';
import { ifNoneMatchMatches, weakEtag } from './etag.js';
import { asciiHeaderValue } from './headers-util.js';
import { resolveRender } from './render-coordinator.js';
import type { NavParams, RenderSnapshotCache, ScreenshotSpec } from './render-cache.js';
import { RenderSnapshotCache as CacheCtor } from './render-cache.js';
import { RenderEngine } from './render-engine.js';
import { assertSafeUrl, SsrfError } from './ssrf.js';
import { extractYoutubeVideoId } from './youtube.js';
import { loadYoutubeTranscript } from './youtube-transcript-service.js';

const navQueryBase = z.object({
  url: z.string().min(1, 'url query parameter is required'),
  wait_until: z.enum(['load', 'domcontentloaded', 'networkidle']).optional(),
  timeout_ms: z.coerce.number().min(1000).max(120_000).optional(),
  viewport_w: z.coerce.number().int().positive().max(4096).optional(),
  viewport_h: z.coerce.number().int().positive().max(4096).optional(),
  settle_ms: z.coerce.number().int().min(0).max(30_000).optional(),
  locale: z.string().max(64).optional(),
  user_agent: z.string().max(1024).optional(),
});

const textQuerySchema = navQueryBase.extend({
  markdown: z.enum(['true', 'false']).optional(),
  separateMarkdown: z.enum(['true', 'false']).optional(),
  includeRawHtml: z.enum(['true', 'false']).optional(),
  maxRawHtmlChars: z.coerce.number().int().positive().optional(),
  content_selector: z.string().max(500).optional(),
  debug: z.enum(['true', 'false']).optional(),
});

const imageQuerySchema = navQueryBase.extend({
  fullPage: z.enum(['true', 'false']).optional(),
  format: z.enum(['png', 'webp']).optional(),
  maxHeightPx: z.coerce.number().int().positive().optional(),
  quality: z.coerce.number().int().min(1).max(100).optional(),
});

const audioQuerySchema = navQueryBase.pick({ url: true }).extend({
  lang: z.string().max(32).optional(),
});

function flattenQuery(q: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(q)) {
    out[k] = Array.isArray(v) ? v[0] : v;
  }
  return out;
}

function parseNavParams(
  href: string,
  o: z.infer<typeof navQueryBase>,
  cfg: Config,
): NavParams {
  return {
    url: href,
    waitUntil: o.wait_until ?? 'domcontentloaded',
    timeoutMs: o.timeout_ms ?? 60_000,
    viewportW: o.viewport_w ?? 1280,
    viewportH: o.viewport_h ?? 720,
    settleMs: o.settle_ms ?? cfg.defaultSettleMs,
    locale: o.locale,
    userAgent: o.user_agent,
  };
}

function assertParsableAbsoluteUrl(href: string): void {
  try {
    const u = new URL(href);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') {
      throw new ReboxHttpError('INVALID_URL', 'URL must be http(s)', 400);
    }
    if (!u.host) {
      throw new ReboxHttpError('INVALID_URL', 'URL must include a host', 400);
    }
  } catch (e) {
    if (e instanceof ReboxHttpError) throw e;
    throw new ReboxHttpError('INVALID_URL', 'Malformed URL', 400);
  }
}

export interface AppBundle {
  app: FastifyInstance;
  engine: RenderEngine;
  cache: RenderSnapshotCache;
  cfg: Config;
}

export async function buildApp(
  cfg: Config,
  opts?: { logger?: boolean },
): Promise<AppBundle> {
  const engine = new RenderEngine(cfg);
  const cache = new CacheCtor(cfg);
  await engine.warm();

  const app = Fastify({
    logger: opts?.logger ?? true,
    requestIdHeader: 'x-request-id',
    genReqId: () => newRequestId(),
  });

  if (cfg.apiKeys.length > 0) {
    app.addHook('onRequest', async (req, reply) => {
      const p = req.url.split('?')[0] ?? req.url;
      if (p === '/health' || p === '/ready') return;
      const key = req.headers['x-api-key'];
      if (typeof key !== 'string' || !cfg.apiKeys.includes(key)) {
        const requestId = req.id;
        reply.status(401).send(
          errorBody('UNAUTHORIZED', 'Invalid or missing X-API-Key', requestId),
        );
      }
    });
  }

  app.addHook('onRequest', async (req, reply) => {
    reply.header('x-rebox-request-id', req.id);
  });

  app.setErrorHandler((err, req, reply) => {
    const requestId = req.id;
    if (reply.sent) return;
    if (err instanceof z.ZodError) {
      reply
        .status(400)
        .send(
          errorBody('INVALID_URL', err.issues.map((e) => e.message).join('; '), requestId, {
            issues: err.issues,
          }),
        );
      return;
    }
    if (err instanceof ReboxHttpError) {
      reply.status(err.status).send(errorBody(err.code, err.message, requestId, err.details));
      return;
    }
    if (err instanceof SsrfError) {
      reply.status(400).send(errorBody(err.code as ErrorCode, err.message, requestId));
      return;
    }
    req.log.error(err);
    reply.status(500).send(errorBody('INTERNAL', 'Unexpected error', requestId));
  });

  app.get('/', async () => ({
    service: 'rebox',
    version: '0.3.0',
    routes: {
      health: 'GET /health',
      ready: 'GET /ready',
      text: 'GET /rebox/text?url=' + encodeURIComponent('https://example.com/'),
      image: 'GET /rebox/image?url=' + encodeURIComponent('https://example.com/'),
      audio: 'GET /rebox/audio?url=' + encodeURIComponent('https://www.youtube.com/watch?v=VIDEO_ID'),
    },
    note: 'Pass target page as query param url (encodeURIComponent). If /rebox/text returns 404, rebuild and restart: npm run build && node dist/server.js',
  }));

  app.get('/health', async () => ({ status: 'ok' }));

  app.get('/ready', async (_, reply) => {
    try {
      await engine.ensureBrowser();
      return { status: 'ready', browser: 'chromium' };
    } catch {
      return reply.status(503).send({ status: 'not_ready' });
    }
  });

  app.get('/rebox/text', async (req, reply) => {
    const requestId = req.id;
    const q = textQuerySchema.parse(flattenQuery(req.query as Record<string, unknown>));
    const href = q.url.trim();
    assertParsableAbsoluteUrl(href);
    await assertSafeUrl(href, cfg);
    const nav = parseNavParams(href, q, cfg);

    const { snapshot } = await resolveRender(cache, engine, nav, null);

    const markdown = q.markdown !== 'false';
    const separateMarkdown = q.separateMarkdown === 'true';
    const includeRaw = q.includeRawHtml === 'true';
    const maxRaw = q.maxRawHtmlChars ?? 200_000;

    const { article, defuddleMs } = await runDefuddle(cfg, snapshot.finalUrl, snapshot.html, {
      markdown,
      separateMarkdown,
      language: q.locale,
      contentSelector: q.content_selector,
      debug: q.debug === 'true',
    });

    const bodyObj = {
      status: 'success' as const,
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
      requestId,
    };

    const json = JSON.stringify(bodyObj);
    const etag = weakEtag(json);
    if (ifNoneMatchMatches(req.headers['if-none-match'], etag)) {
      reply.status(304).header('etag', etag).header('cache-control', 'private, max-age=60');
      reply.header('x-rebox-final-url', snapshot.finalUrl);
      return reply.send();
    }

    reply
      .header('etag', etag)
      .header('cache-control', 'private, max-age=60')
      .header('x-rebox-final-url', snapshot.finalUrl);
    return reply.send(bodyObj);
  });

  app.get('/rebox/image', async (req, reply) => {
    const q = imageQuerySchema.parse(flattenQuery(req.query as Record<string, unknown>));
    const href = q.url.trim();
    assertParsableAbsoluteUrl(href);
    await assertSafeUrl(href, cfg);
    const nav = parseNavParams(href, q, cfg);
    const spec: ScreenshotSpec = {
      format: q.format === 'webp' ? 'webp' : 'png',
      fullPage: q.fullPage === 'true',
      maxHeightPx: q.maxHeightPx,
      quality: q.quality,
    };

    const { snapshot, image } = await resolveRender(cache, engine, nav, spec);
    if (!image) {
      throw new ReboxHttpError('INTERNAL', 'Image payload missing', 500);
    }

    const etag = weakEtag(image.buffer);
    if (ifNoneMatchMatches(req.headers['if-none-match'], etag)) {
      reply
        .status(304)
        .header('etag', etag)
        .header('cache-control', 'private, max-age=60')
        .header('x-rebox-final-url', snapshot.finalUrl)
        .header('x-rebox-title', asciiHeaderValue(snapshot.title));
      return reply.send();
    }

    reply
      .header('etag', etag)
      .header('cache-control', 'private, max-age=60')
      .header('x-rebox-final-url', snapshot.finalUrl)
      .header('x-rebox-title', asciiHeaderValue(snapshot.title))
      .header('x-rebox-timing-navigation-ms', String(snapshot.navigationMs))
      .header('content-disposition', 'inline; filename="rebox.png"')
      .type(image.mimeType)
      .send(image.buffer);
  });

  app.get('/rebox/audio', async (req, reply) => {
    const requestId = req.id;
    const q = audioQuerySchema.parse(flattenQuery(req.query as Record<string, unknown>));
    const href = q.url.trim();
    assertParsableAbsoluteUrl(href);
    await assertSafeUrl(href, cfg);

    const videoId = extractYoutubeVideoId(href);
    if (!videoId) {
      throw new ReboxHttpError('TRANSCRIPT_UNAVAILABLE', 'Not a YouTube URL', 404);
    }

    const t0 = Date.now();
    const { segments } = await loadYoutubeTranscript(href, q.lang);
    const fetchMs = Date.now() - t0;

    const bodyObj = {
      videoId,
      title: undefined as string | undefined,
      language: q.lang,
      segments,
      timingsMs: { fetch: fetchMs },
      requestId,
    };

    const json = JSON.stringify(bodyObj);
    const etag = weakEtag(json);
    if (ifNoneMatchMatches(req.headers['if-none-match'], etag)) {
      reply.status(304).header('etag', etag).header('cache-control', 'private, max-age=300');
      return reply.send();
    }

    reply.header('etag', etag).header('cache-control', 'private, max-age=300');
    return reply.send(bodyObj);
  });

  app.addHook('onClose', async () => {
    await engine.close();
  });

  return { app, engine, cache, cfg };
}
