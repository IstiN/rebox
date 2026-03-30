import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import { dirname } from 'node:path';
import { z } from 'zod';

import { extractClientApiKey } from './auth-util.js';
import type { Config } from './config.js';
import { runDefuddle } from './defuddle-service.js';
import { errorBody, newRequestId, ReboxHttpError, type ErrorCode } from './errors.js';
import { ifNoneMatchMatches, weakEtag } from './etag.js';
import { contentDispositionInlineFilename, resolveScreenshotBasename } from './download-name.js';
import { asciiHeaderValue } from './headers-util.js';
import { resolveRender } from './render-coordinator.js';
import type { RenderSnapshotCache, ScreenshotSpec } from './render-cache.js';
import { RenderSnapshotCache as CacheCtor } from './render-cache.js';
import { RenderEngine } from './render-engine.js';
import { DecodeError, decodeUrlPathSegment } from './encode.js';
import { assertSafeUrl, SsrfError } from './ssrf.js';
import { extractYoutubeVideoId } from './youtube.js';
import { resolveOpenApiSpecPath } from './openapi-path.js';
import { loadYoutubeTranscript } from './youtube-transcript-service.js';
import {
  assertParsableAbsoluteUrl,
  audioQuerySchema,
  imageQuerySchema,
  parseNavParams,
  textQuerySchema,
} from './rebox-query.js';

function flattenQuery(q: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(q)) {
    out[k] = Array.isArray(v) ? v[0] : v;
  }
  return out;
}

/** GET: query only. POST: JSON body fields override query for the same keys. */
function mergeReboxQuery(
  method: string,
  query: Record<string, unknown>,
  body: unknown,
): Record<string, unknown> {
  const out = flattenQuery(query);
  if (method !== 'POST') return out;
  if (body && typeof body === 'object' && !Array.isArray(body)) {
    Object.assign(out, flattenQuery(body as Record<string, unknown>));
  }
  return out;
}

/** Plain URL: GET `?url=`, or POST JSON `{ "url": "https://..." }` (body wins over query for the target). */
function extractPlainTargetUrl(req: FastifyRequest): string {
  if (req.method === 'POST' && req.body && typeof req.body === 'object' && !Array.isArray(req.body)) {
    const u = (req.body as Record<string, unknown>).url;
    if (typeof u === 'string' && u.trim()) return u.trim();
  }
  const q = flattenQuery(req.query as Record<string, unknown>);
  const qu = q.url;
  if (typeof qu === 'string' && qu.trim()) return qu.trim();
  throw new ReboxHttpError(
    'INVALID_URL',
    'Provide full URL as query ?url=... or POST JSON { "url": "https://..." }',
    400,
  );
}

/** Options for plain routes: same merge as path-encoded routes, but `url` is never passed to zod. */
function mergePlainOptions(req: FastifyRequest): Record<string, unknown> {
  const merged = mergeReboxQuery(req.method, req.query as Record<string, unknown>, req.body);
  const { url: _drop, ...rest } = merged;
  return rest;
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

  const openApiPath = resolveOpenApiSpecPath();
  await app.register(swagger, {
    mode: 'static',
    specification: {
      path: openApiPath,
      baseDir: dirname(openApiPath),
    },
  });
  await app.register(swaggerUi, {
    routePrefix: '/docs',
    uiConfig: {
      docExpansion: 'list',
      deepLinking: true,
    },
  });

  if (cfg.apiKeys.length > 0) {
    app.addHook('onRequest', async (req, reply) => {
      const p = req.url.split('?')[0] ?? req.url;
      if (p === '/health' || p === '/ready' || p.startsWith('/docs')) return;
      const key = extractClientApiKey(req.headers as { 'x-api-key'?: string; authorization?: string });
      if (!key || !cfg.apiKeys.includes(key)) {
        const requestId = req.id;
        reply.status(401).send(
          errorBody(
            'UNAUTHORIZED',
            'Invalid or missing credentials: send X-API-Key or Authorization: Bearer <key>',
            requestId,
          ),
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
    if (err instanceof DecodeError) {
      reply.status(400).send(errorBody('INVALID_ENCODING', err.message, requestId));
      return;
    }
    req.log.error(err);
    reply.status(500).send(errorBody('INTERNAL', 'Unexpected error', requestId));
  });

  app.get('/', async () => {
    const ex = encodeURIComponent('https://example.com/');
    const yt = encodeURIComponent('https://www.youtube.com/watch?v=VIDEO_ID');
    return {
      service: 'rebox',
      version: '0.5.1',
      routes: {
        health: 'GET /health',
        ready: 'GET /ready',
        docs: 'GET /docs',
        textPlain: 'GET|POST /rebox/text?url= or body { url }',
        imagePlain: 'GET|POST /rebox/image?url= or body { url }',
        audioPlain: 'GET|POST /rebox/audio?url= or body { url }',
        text: `GET|POST /rebox/${ex}/text`,
        image: `GET|POST /rebox/${ex}/image`,
        audio: `GET|POST /rebox/${yt}/audio`,
      },
      note: 'Use /rebox/text|image|audio with full URL as ?url= (encode once) or POST JSON { "url": "https://..." } for a literal URL. Legacy: /rebox/<encodeURIComponent(url)>/text. Options: query and/or POST JSON. Optional auth: REBOX_API_KEYS.',
    };
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

  const deliverText = async (
    href: string,
    merged: Record<string, unknown>,
    req: FastifyRequest,
    reply: FastifyReply,
  ) => {
    assertParsableAbsoluteUrl(href);
    await assertSafeUrl(href, cfg);
    const requestId = req.id;
    const q = textQuerySchema.parse(merged);
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
  };

  const deliverImage = async (
    href: string,
    merged: Record<string, unknown>,
    req: FastifyRequest,
    reply: FastifyReply,
  ) => {
    assertParsableAbsoluteUrl(href);
    await assertSafeUrl(href, cfg);
    const q = imageQuerySchema.parse(merged);
    const nav = parseNavParams(href, q, cfg);
    const spec: ScreenshotSpec = {
      format: q.format === 'webp' ? 'webp' : 'png',
      fullPage: q.fullPage !== 'false',
      maxHeightPx: q.maxHeightPx,
      quality: q.quality,
      scrollFullPage: q.scroll_full_page !== 'false',
    };

    const { snapshot, image } = await resolveRender(cache, engine, nav, spec);
    if (!image) {
      throw new ReboxHttpError('INTERNAL', 'Image payload missing', 500);
    }

    const ext: 'png' | 'webp' = image.mimeType.includes('webp') ? 'webp' : 'png';
    const stem = resolveScreenshotBasename(snapshot.finalUrl, snapshot.title, {
      saveAs: q.save_as,
      filenameSource: q.filename_source,
    });
    const contentDisposition = contentDispositionInlineFilename(stem, ext);

    const etag = weakEtag(image.buffer);
    if (ifNoneMatchMatches(req.headers['if-none-match'], etag)) {
      reply
        .status(304)
        .header('etag', etag)
        .header('cache-control', 'private, max-age=60')
        .header('x-rebox-final-url', snapshot.finalUrl)
        .header('x-rebox-title', asciiHeaderValue(snapshot.title))
        .header('content-disposition', contentDisposition);
      return reply.send();
    }

    reply
      .header('etag', etag)
      .header('cache-control', 'private, max-age=60')
      .header('x-rebox-final-url', snapshot.finalUrl)
      .header('x-rebox-title', asciiHeaderValue(snapshot.title))
      .header('x-rebox-timing-navigation-ms', String(snapshot.navigationMs))
      .header('content-disposition', contentDisposition)
      .type(image.mimeType)
      .send(image.buffer);
  };

  const deliverAudio = async (
    href: string,
    merged: Record<string, unknown>,
    req: FastifyRequest,
    reply: FastifyReply,
  ) => {
    assertParsableAbsoluteUrl(href);
    await assertSafeUrl(href, cfg);
    const requestId = req.id;
    const q = audioQuerySchema.parse(merged);

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
  };

  const plainTextHandler = async (req: FastifyRequest, reply: FastifyReply) => {
    const href = extractPlainTargetUrl(req);
    return deliverText(href, mergePlainOptions(req), req, reply);
  };
  const plainImageHandler = async (req: FastifyRequest, reply: FastifyReply) => {
    const href = extractPlainTargetUrl(req);
    return deliverImage(href, mergePlainOptions(req), req, reply);
  };
  const plainAudioHandler = async (req: FastifyRequest, reply: FastifyReply) => {
    const href = extractPlainTargetUrl(req);
    return deliverAudio(href, mergePlainOptions(req), req, reply);
  };

  app.route({ method: ['GET', 'POST'], url: '/rebox/text', handler: plainTextHandler });
  app.route({ method: ['GET', 'POST'], url: '/rebox/image', handler: plainImageHandler });
  app.route({ method: ['GET', 'POST'], url: '/rebox/audio', handler: plainAudioHandler });

  const textHandler = async (
    req: FastifyRequest<{ Params: { encodedUrl: string } }>,
    reply: FastifyReply,
  ) => {
    const href = decodeUrlPathSegment(req.params.encodedUrl);
    const merged = mergeReboxQuery(req.method, req.query as Record<string, unknown>, req.body);
    return deliverText(href, merged, req, reply);
  };

  app.route({
    method: ['GET', 'POST'],
    url: '/rebox/:encodedUrl/text',
    handler: textHandler,
  });

  const imageHandler = async (
    req: FastifyRequest<{ Params: { encodedUrl: string } }>,
    reply: FastifyReply,
  ) => {
    const href = decodeUrlPathSegment(req.params.encodedUrl);
    const merged = mergeReboxQuery(req.method, req.query as Record<string, unknown>, req.body);
    return deliverImage(href, merged, req, reply);
  };

  app.route({
    method: ['GET', 'POST'],
    url: '/rebox/:encodedUrl/image',
    handler: imageHandler,
  });

  const audioHandler = async (
    req: FastifyRequest<{ Params: { encodedUrl: string } }>,
    reply: FastifyReply,
  ) => {
    const href = decodeUrlPathSegment(req.params.encodedUrl);
    const merged = mergeReboxQuery(req.method, req.query as Record<string, unknown>, req.body);
    return deliverAudio(href, merged, req, reply);
  };

  app.route({
    method: ['GET', 'POST'],
    url: '/rebox/:encodedUrl/audio',
    handler: audioHandler,
  });

  app.addHook('onClose', async () => {
    await engine.close();
  });

  return { app, engine, cache, cfg };
}
