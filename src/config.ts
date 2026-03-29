import { z } from 'zod';

const envSchema = z.object({
  PORT: z.coerce.number().default(3000),
  HOST: z.string().default('0.0.0.0'),
  REBOX_API_KEYS: z
    .string()
    .optional()
    .transform((s) =>
      s
        ? s
            .split(',')
            .map((k) => k.trim())
            .filter(Boolean)
        : [],
    ),
  MAX_HTML_CHARS: z.coerce.number().default(5_000_000),
  MAX_SCREENSHOT_BYTES: z.coerce.number().default(25_000_000),
  CACHE_TTL_MS: z.coerce.number().default(120_000),
  MAX_CONCURRENT_RENDERS: z.coerce.number().default(2),
  REBOX_DEFAULT_SETTLE_MS: z.coerce.number().min(0).max(30_000).default(2000),
  ALLOW_HTTP: z
    .string()
    .optional()
    .transform((v) => v === '1' || v === 'true'),
});

export interface Config {
  port: number;
  host: string;
  apiKeys: string[];
  maxHtmlChars: number;
  maxScreenshotBytes: number;
  cacheTtlMs: number;
  maxConcurrentRenders: number;
  /** Extra wait after navigation so SPAs can hydrate before HTML/screenshot. */
  defaultSettleMs: number;
  allowHttp: boolean;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const e = envSchema.parse(env);
  return {
    port: e.PORT,
    host: e.HOST,
    apiKeys: e.REBOX_API_KEYS,
    maxHtmlChars: e.MAX_HTML_CHARS,
    maxScreenshotBytes: e.MAX_SCREENSHOT_BYTES,
    cacheTtlMs: e.CACHE_TTL_MS,
    maxConcurrentRenders: e.MAX_CONCURRENT_RENDERS,
    defaultSettleMs: e.REBOX_DEFAULT_SETTLE_MS,
    allowHttp: Boolean(e.ALLOW_HTTP),
  };
}
