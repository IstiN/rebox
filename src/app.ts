import Fastify, { type FastifyInstance } from 'fastify';
import { z } from 'zod';

import type { Config } from './config.js';
import { runDefuddle } from './defuddle-service.js';
import { DecodeError, decodeUrlToken } from './encode.js';
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
  wait_until: z.enum(['load', 'domcontentloaded', 'networkidle']).optional(),
  timeout_ms: z.coerce.number().min(1000).max(120_000).optional(),
  viewport_w: z.coerce.number().int().positive().max(4096).optional(),
  viewport_h: z.coerce.number().int().positive().max(4096).optional(),
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

function flattenQuery(q: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(q)) {
    out[k] = Array.isArray(v) ? v[0] : v;
  }
  return out;
}

function parseNav(urlString: string, raw: Record<string, unknown>): NavParams {
  const o = navQueryBase.parse(raw);
  return {
    url: urlString,
    waitUntil: o.wait_until ?? 'networkidle',
    timeoutMs: o.timeout_ms ?? 30_000,
    viewportW: o.viewport_w ?? 1280,
    viewportH: o.viewport_h ?? 720,
    locale: o.locale,
    userAgent: o.user_agent,
  };
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
    if (err instanceof DecodeError) {
      reply.status(400).send(errorBody('INVALID_ENCODING', err.message, requestId));
      return;
    }
    if (err instanceof SsrfError) {
      const status = err.code === 'DNS_REBINDING' ? 400 : 400;
      reply.status(status).send(errorBody(err.code as ErrorCode, err.message, requestId));
      return;
    }
    req.log.error(err);
    reply.status(500).send(errorBody('INTERNAL', 'Unexpected error', requestId));
  });

  app.get('/health', async () => ({ status: 'ok' }));

  app.get('/ready', async (_, reply) => {
    try {
      await engine.ensureBrowser();
      return { status: 'ready', browser: 'chromium' };
    } catch {
      return reply.status(503).send({ status: 'not_ready' });
    }
  });

  app.get<{ Params: { encodedUrl: string } }>(
    '/rebox/:encodedUrl/text',
    async (req, reply) => {
      const requestId = req.id;
      const href = decodeUrlToken(req.params.encodedUrl);
      await assertSafeUrl(href, cfg);

      const q = textQuerySchema.parse(flattenQuery(req.query as Record<string, unknown>));
      const nav = parseNav(href, q);

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
    },
  );

  app.get<{ Params: { encodedUrl: string } }>(
    '/rebox/:encodedUrl/image',
    async (req, reply) => {
      const href = decodeUrlToken(req.params.encodedUrl);
      await assertSafeUrl(href, cfg);

      const q = imageQuerySchema.parse(flattenQuery(req.query as Record<string, unknown>));
      const nav = parseNav(href, q);
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
    },
  );

  app.get<{ Params: { encodedUrl: string } }>(
    '/rebox/:encodedUrl/audio',
    async (req, reply) => {
      const requestId = req.id;
      const href = decodeUrlToken(req.params.encodedUrl);
      await assertSafeUrl(href, cfg);

      const flat = flattenQuery(req.query as Record<string, unknown>);
      const lang = typeof flat.lang === 'string' ? flat.lang : undefined;

      const videoId = extractYoutubeVideoId(href);
      if (!videoId) {
        throw new ReboxHttpError('TRANSCRIPT_UNAVAILABLE', 'Not a YouTube URL', 404);
      }

      const t0 = Date.now();
      const { segments } = await loadYoutubeTranscript(href, lang);
      const fetchMs = Date.now() - t0;

      const bodyObj = {
        videoId,
        title: undefined as string | undefined,
        language: lang,
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
    },
  );

  app.addHook('onClose', async () => {
    await engine.close();
  });

  return { app, engine, cache, cfg };
}
