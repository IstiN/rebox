import { readFileSync, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';

import { Command } from 'commander';
import pc from 'picocolors';
import { z } from 'zod';

import {
  buildAuthHeaders,
  normalizeBaseUrl,
  postRebox,
  readErrorBody,
  type HeaderStyle,
} from './cli-client.js';
import { ensureLocalReboxServer } from './cli-local-server.js';
import { applyUrlShorthand, sanitizePastedUrl } from './cli-shorthand.js';
import { getCliDirectRunner, shutdownCliDirectRunner } from './cli-direct-runner.js';
import { ReboxHttpError } from './errors.js';
import { resolveOpenApiSpecPath } from './openapi-path.js';
import { SsrfError } from './ssrf.js';

function readPkgVersion(): string {
  try {
    const path = new URL('../package.json', import.meta.url);
    const pkg = JSON.parse(readFileSync(path, 'utf8')) as { version?: string };
    return pkg.version ?? '0.0.0';
  } catch {
    return '0.0.0';
  }
}

type RootOpts = {
  baseUrl?: string;
  apiKey?: string;
  headerStyle: HeaderStyle;
};

function resolveRootOpts(program: Command): RootOpts {
  const o = program.opts() as { baseUrl?: string; apiKey?: string; headerStyle?: string };
  const hs = (o.headerStyle ?? process.env.REBOX_HEADER_STYLE ?? '').toLowerCase();
  const headerStyle: HeaderStyle = hs === 'x-api-key' || hs === 'xapikey' ? 'x-api-key' : 'bearer';
  return {
    baseUrl: o.baseUrl ?? process.env.REBOX_BASE_URL,
    apiKey: o.apiKey ?? process.env.REBOX_API_KEY,
    headerStyle,
  };
}

/** Use HTTP to a rebox server (Cloud Run or local `npm start`). Otherwise run Chromium in-process. */
function useRemoteHttp(program: Command): boolean {
  if (process.env.REBOX_USE_HTTP === '1') return true;
  const r = resolveRootOpts(program);
  return Boolean(r.baseUrl?.trim());
}

function resolveRemoteBaseUrl(program: Command): string {
  const r = resolveRootOpts(program);
  const raw = r.baseUrl?.trim() || 'http://127.0.0.1:3000';
  return normalizeBaseUrl(raw);
}

function mergeHeaders(
  program: Command,
  extra?: Record<string, string>,
): Record<string, string> {
  const r = resolveRootOpts(program);
  return { ...buildAuthHeaders(r.apiKey, r.headerStyle), ...extra };
}

function autoServerEnabled(program: Command): boolean {
  const o = program.opts() as { autoServer?: boolean };
  if (o.autoServer === false) return false;
  if (process.env.REBOX_AUTO_SERVER === '0') return false;
  return true;
}

async function apiBase(program: Command): Promise<string> {
  const base = resolveRemoteBaseUrl(program);
  return ensureLocalReboxServer(base, { autoServer: autoServerEnabled(program) });
}

async function failResponse(res: Response, label: string): Promise<never> {
  const detail = await readErrorBody(res);
  console.error(pc.red(`${label}: ${res.status} ${res.statusText}`), detail ? `\n${detail}` : '');
  process.exit(1);
}

type TextBody = {
  visibleText?: string;
  article?: { contentMarkdown?: string; contentHtml?: string };
};

function formatTextPlain(j: TextBody): string {
  const md = j.article?.contentMarkdown?.trim();
  if (md) return md;
  const vt = j.visibleText?.trim();
  if (vt) return vt;
  return '';
}

type AudioBody = { segments?: Array<{ text?: string }> };

function formatAudioPlain(j: AudioBody): string {
  if (!Array.isArray(j.segments)) return '';
  return j.segments
    .map((s) => (typeof s.text === 'string' ? s.text.trim() : ''))
    .filter(Boolean)
    .join('\n');
}

function openUrl(url: string): void {
  const plat = process.platform;
  const cmd = plat === 'darwin' ? 'open' : plat === 'win32' ? 'start' : 'xdg-open';
  const child = spawn(cmd, plat === 'win32' ? [url] : [url], {
    shell: plat === 'win32',
    stdio: 'ignore',
    detached: true,
  });
  child.unref();
}

async function main(): Promise<void> {
  const version = readPkgVersion();
  const program = new Command();

  program
    .name('rebox')
    .description(
      pc.bold('rebox') +
        ' — render URLs locally (Chromium in-process) or via HTTP API\n' +
        pc.dim('Default: ') +
        pc.cyan('in-process') +
        pc.dim(' (no server). Use ') +
        pc.cyan('-b') +
        pc.dim(' / ') +
        pc.cyan('REBOX_BASE_URL') +
        pc.dim(' or ') +
        pc.cyan('REBOX_USE_HTTP=1') +
        pc.dim(' for remote HTTP.') +
        '\n' +
        pc.dim('Shorthand: ') +
        pc.cyan('rebox https://example.com/') +
        pc.dim(' → text; YouTube URL → transcript.') +
        '\n' +
        pc.dim('Remote + localhost: auto-starts ') +
        pc.dim('dist/server.js') +
        pc.dim(' when needed (') +
        pc.cyan('--no-auto-server') +
        pc.dim(' to disable).'),
    )
    .helpCommand(false)
    .version(version, '-V, --version', 'print version')
    .helpOption('-h, --help', 'print help')
    .option(
      '-b, --base-url <url>',
      'HTTP API base URL (env REBOX_BASE_URL); omit for in-process rendering',
    )
    .option('-k, --api-key <key>', 'API key (env REBOX_API_KEY)')
    .option(
      '--header-style <mode>',
      'bearer | x-api-key (or env REBOX_HEADER_STYLE)',
    )
    .option(
      '--no-auto-server',
      'with HTTP on localhost: do not spawn a server (env REBOX_AUTO_SERVER=0)',
    )
    .configureHelp({
      sortSubcommands: true,
      subcommandTerm: (cmd) => pc.cyan(cmd.name()),
    })
    .showHelpAfterError('(add -h for usage)');

  program
    .command('health')
    .description('liveness (HTTP GET /health or in-process stub)')
    .action(async () => {
      if (useRemoteHttp(program)) {
        const base = await apiBase(program);
        const res = await fetch(`${base}/health`);
        if (!res.ok) await failResponse(res, 'health');
        const j = await res.json();
        console.log(pc.green('ok'), JSON.stringify(j, null, 2));
        return;
      }
      console.log(pc.green('ok'), JSON.stringify({ status: 'ok', mode: 'direct' }, null, 2));
    });

  program
    .command('ready')
    .description('browser readiness (HTTP GET /ready or warm local Chromium)')
    .action(async () => {
      if (useRemoteHttp(program)) {
        const base = await apiBase(program);
        const res = await fetch(`${base}/ready`);
        if (!res.ok) await failResponse(res, 'ready');
        const j = await res.json();
        console.log(pc.green('ok'), JSON.stringify(j, null, 2));
        return;
      }
      await getCliDirectRunner().warmBrowser();
      console.log(
        pc.green('ok'),
        JSON.stringify({ status: 'ready', browser: 'chromium', mode: 'direct' }, null, 2),
      );
    });

  program
    .command('info')
    .description('route map over HTTP, or CLI hint in direct mode')
    .action(async () => {
      if (useRemoteHttp(program)) {
        const base = await apiBase(program);
        const res = await fetch(`${base}/`, { headers: mergeHeaders(program) });
        if (!res.ok) await failResponse(res, 'info');
        const j = await res.json();
        console.log(JSON.stringify(j, null, 2));
        return;
      }
      console.log(
        JSON.stringify(
          {
            mode: 'direct',
            service: 'rebox-cli',
            version: readPkgVersion(),
            note: 'Rendering runs in this process. Use -b or REBOX_BASE_URL for HTTP API + route map.',
          },
          null,
          2,
        ),
      );
    });

  program
    .command('docs')
    .description('Swagger UI URL (HTTP) or hint (direct)')
    .option('--open', 'open in default browser')
    .action(async (opts: { open?: boolean }) => {
      if (useRemoteHttp(program)) {
        const base = await apiBase(program);
        const url = `${base}/docs/`;
        console.log(url);
        if (opts.open) openUrl(url);
        return;
      }
      console.error(
        pc.dim('Swagger UI is served by the HTTP app. Run: npm start, then open http://127.0.0.1:3000/docs/'),
      );
      process.exit(1);
    });

  program
    .command('openapi')
    .description('OpenAPI from server /docs/json, or bundled openapi.yaml (direct)')
    .option('-o, --output <file>', 'write to file instead of stdout')
    .action(async (opts: { output?: string }) => {
      if (useRemoteHttp(program)) {
        const base = await apiBase(program);
        const res = await fetch(`${base}/docs/json`, { headers: mergeHeaders(program) });
        if (!res.ok) await failResponse(res, 'openapi');
        const text = await res.text();
        if (opts.output) {
          writeFileSync(opts.output, text, 'utf8');
          console.error(pc.dim(`wrote ${opts.output}`));
        } else {
          console.log(text);
        }
        return;
      }
      const text = readFileSync(resolveOpenApiSpecPath(), 'utf8');
      if (opts.output) {
        writeFileSync(opts.output, text, 'utf8');
        console.error(pc.dim(`wrote ${opts.output}`));
      } else {
        console.log(text);
      }
    });

  program
    .command('text')
    .description('POST /rebox/text — article text to stdout (use --json for full response)')
    .argument('<url>', 'target page URL')
    .option('--timeout-ms <n>', 'navigation timeout', (v) => Number(v), 60_000)
    .option('--settle-ms <n>', 'post-navigation wait', (v) => Number(v))
    .option('--no-markdown', 'ask server for HTML-oriented defuddle output')
    .option('--visible-only', 'print visibleText only')
    .option('--json', 'print full JSON response')
    .action(
      async (
        url: string,
        opts: {
          timeoutMs: number;
          settleMs?: number;
          noMarkdown?: boolean;
          visibleOnly?: boolean;
          json?: boolean;
        },
      ) => {
        url = sanitizePastedUrl(url);
        const body: Record<string, unknown> = {
          timeout_ms: opts.timeoutMs,
          markdown: opts.noMarkdown ? 'false' : 'true',
        };
        if (opts.settleMs !== undefined && !Number.isNaN(opts.settleMs)) body.settle_ms = opts.settleMs;

        let j: TextBody;
        if (useRemoteHttp(program)) {
          const base = await apiBase(program);
          const res = await postRebox(base, 'text', url, body, mergeHeaders(program));
          if (!res.ok) await failResponse(res, 'text');
          j = (await res.json()) as TextBody;
        } else {
          j = await getCliDirectRunner().runText(url, body);
        }
        if (opts.visibleOnly) {
          console.log(j.visibleText ?? '');
          return;
        }
        if (opts.json) {
          console.log(JSON.stringify(j, null, 2));
          return;
        }
        const plain = formatTextPlain(j);
        console.log(plain || JSON.stringify(j, null, 2));
      },
    );

  program
    .command('image')
    .description('POST /rebox/image — save screenshot')
    .argument('<url>', 'target page URL')
    .requiredOption('-o, --output <file>', 'output file path (.png / .webp)')
    .option('--timeout-ms <n>', 'navigation timeout', (v) => Number(v), 90_000)
    .option('--settle-ms <n>', 'post-navigation wait', (v) => Number(v))
    .option('--format <fmt>', 'png | webp', 'png')
    .option('--viewport-only', 'capture viewport instead of full page')
    .option('--no-scroll', 'skip scrolling to load lazy content before a full-page capture')
    .action(
      async (
        url: string,
        opts: {
          output: string;
          timeoutMs: number;
          settleMs?: number;
          format: string;
          viewportOnly?: boolean;
          scroll?: boolean;
        },
      ) => {
        url = sanitizePastedUrl(url);
        const body: Record<string, unknown> = {
          timeout_ms: opts.timeoutMs,
          format: opts.format === 'webp' ? 'webp' : 'png',
          fullPage: opts.viewportOnly ? 'false' : 'true',
        };
        if (opts.scroll === false) body.scroll_full_page = 'false';
        if (opts.settleMs !== undefined && !Number.isNaN(opts.settleMs)) body.settle_ms = opts.settleMs;

        let buf: Buffer;
        if (useRemoteHttp(program)) {
          const base = await apiBase(program);
          const res = await postRebox(base, 'image', url, body, mergeHeaders(program));
          if (!res.ok) await failResponse(res, 'image');
          buf = Buffer.from(await res.arrayBuffer());
        } else {
          const out = await getCliDirectRunner().runImage(url, body);
          buf = out.buffer;
        }
        writeFileSync(opts.output, buf);
        console.error(pc.dim(`wrote ${opts.output} (${buf.length} bytes)`));
      },
    );

  program
    .command('audio')
    .description('POST /rebox/audio — transcript text to stdout (use --json for full response)')
    .argument('<url>', 'YouTube watch URL')
    .option('--lang <code>', 'caption language')
    .option('--json', 'print full JSON response')
    .action(async (url: string, opts: { lang?: string; json?: boolean }) => {
      url = sanitizePastedUrl(url);
      const body: Record<string, unknown> = {};
      if (opts.lang) body.lang = opts.lang;

      let j: AudioBody;
      if (useRemoteHttp(program)) {
        const base = await apiBase(program);
        const res = await postRebox(base, 'audio', url, body, mergeHeaders(program));
        if (!res.ok) await failResponse(res, 'audio');
        j = (await res.json()) as AudioBody;
      } else {
        j = await getCliDirectRunner().runAudio(url, body);
      }
      if (opts.json) {
        console.log(JSON.stringify(j, null, 2));
        return;
      }
      const plain = formatAudioPlain(j);
      console.log(plain || JSON.stringify(j, null, 2));
    });

  const argv = applyUrlShorthand(process.argv.slice(2));
  await program.parseAsync([process.argv[0]!, process.argv[1]!, ...argv]);
}

async function runCli(): Promise<void> {
  try {
    await main();
  } finally {
    await shutdownCliDirectRunner();
  }
}

runCli().catch((e) => {
  if (e instanceof z.ZodError) {
    console.error(pc.red(e.issues.map((i) => i.message).join('; ')));
    process.exit(1);
  }
  if (e instanceof ReboxHttpError) {
    console.error(pc.red(`${e.code}: ${e.message}`));
    process.exit(1);
  }
  if (e instanceof SsrfError) {
    console.error(pc.red(`${e.code}: ${e.message}`));
    process.exit(1);
  }
  console.error(pc.red(e instanceof Error ? e.message : String(e)));
  process.exit(1);
});
