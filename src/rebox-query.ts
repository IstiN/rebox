import { z } from 'zod';

import type { Config } from './config.js';
import { ReboxHttpError } from './errors.js';
import type { NavParams } from './render-cache.js';

export const navOptionsSchema = z.object({
  wait_until: z.enum(['load', 'domcontentloaded', 'networkidle']).optional(),
  timeout_ms: z.coerce.number().min(1000).max(120_000).optional(),
  viewport_w: z.coerce.number().int().positive().max(4096).optional(),
  viewport_h: z.coerce.number().int().positive().max(4096).optional(),
  settle_ms: z.coerce.number().int().min(0).max(30_000).optional(),
  locale: z.string().max(64).optional(),
  user_agent: z.string().max(1024).optional(),
});

export const textQuerySchema = navOptionsSchema.extend({
  markdown: z.enum(['true', 'false']).optional(),
  separateMarkdown: z.enum(['true', 'false']).optional(),
  includeRawHtml: z.enum(['true', 'false']).optional(),
  maxRawHtmlChars: z.coerce.number().int().positive().optional(),
  content_selector: z.string().max(500).optional(),
  debug: z.enum(['true', 'false']).optional(),
});

export const imageQuerySchema = navOptionsSchema.extend({
  fullPage: z.enum(['true', 'false']).optional(),
  scroll_full_page: z.enum(['true', 'false']).optional(),
  format: z.enum(['png', 'webp']).optional(),
  maxHeightPx: z.coerce.number().int().positive().optional(),
  quality: z.coerce.number().int().min(1).max(100).optional(),
  save_as: z.string().max(200).optional(),
  filename_source: z.enum(['host', 'title']).optional(),
});

export const audioQuerySchema = z.object({
  lang: z.string().max(32).optional(),
});

export function parseNavParams(
  href: string,
  o: z.infer<typeof navOptionsSchema>,
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

export function assertParsableAbsoluteUrl(href: string): void {
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
