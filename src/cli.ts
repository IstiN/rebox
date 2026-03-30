import { readFileSync, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';

import { Command } from 'commander';
import pc from 'picocolors';

import {
  buildAuthHeaders,
  normalizeBaseUrl,
  postRebox,
  readErrorBody,
  type HeaderStyle,
} from './cli-client.js';
import { ensureLocalReboxServer } from './cli-local-server.js';
import { applyUrlShorthand, sanitizePastedUrl } from './cli-shorthand.js';

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

function resolveBaseUrl(program: Command): string {
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
  const base = resolveBaseUrl(program);
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
        ' — CLI for the rebox HTTP render API\n' +
        pc.dim('Shorthand: ') +
        pc.cyan('rebox https://example.com/') +
        pc.dim(' → same as ') +
        pc.cyan('rebox text https://example.com/') +
        pc.dim('; YouTube → transcript') +
        '\n' +
        pc.dim('Localhost API: if nothing is listening, rebox starts ') +
        pc.dim('dist/server.js') +
        pc.dim(' automatically (disable: ') +
        pc.cyan('--no-auto-server') +
        pc.dim(' or ') +
        pc.cyan('REBOX_AUTO_SERVER=0') +
        pc.dim(').'),
    )
    .helpCommand(false)
    .version(version, '-V, --version', 'print version')
    .helpOption('-h, --help', 'print help')
    .option(
      '-b, --base-url <url>',
      'API base URL (env REBOX_BASE_URL, default http://127.0.0.1:3000)',
    )
    .option('-k, --api-key <key>', 'API key (env REBOX_API_KEY)')
    .option(
      '--header-style <mode>',
      'bearer | x-api-key (or env REBOX_HEADER_STYLE)',
    )
    .option(
      '--no-auto-server',
      'do not start a local rebox server when the API URL is localhost (env REBOX_AUTO_SERVER=0)',
    )
    .configureHelp({
      sortSubcommands: true,
      subcommandTerm: (cmd) => pc.cyan(cmd.name()),
    })
    .showHelpAfterError('(add -h for usage)');

  program
    .command('health')
    .description('GET /health — liveness')
    .action(async () => {
      const base = await apiBase(program);
      const res = await fetch(`${base}/health`);
      if (!res.ok) await failResponse(res, 'health');
      const j = await res.json();
      console.log(pc.green('ok'), JSON.stringify(j, null, 2));
    });

  program
    .command('ready')
    .description('GET /ready — browser readiness')
    .action(async () => {
      const base = await apiBase(program);
      const res = await fetch(`${base}/ready`);
      if (!res.ok) await failResponse(res, 'ready');
      const j = await res.json();
      console.log(pc.green('ok'), JSON.stringify(j, null, 2));
    });

  program
    .command('info')
    .description('GET / — service route map (requires API key if configured on server)')
    .action(async () => {
      const base = await apiBase(program);
      const res = await fetch(`${base}/`, { headers: mergeHeaders(program) });
      if (!res.ok) await failResponse(res, 'info');
      const j = await res.json();
      console.log(JSON.stringify(j, null, 2));
    });

  program
    .command('docs')
    .description('print Swagger UI URL; use --open to launch browser')
    .option('--open', 'open in default browser')
    .action(async (opts: { open?: boolean }) => {
      const base = await apiBase(program);
      const url = `${base}/docs/`;
      console.log(url);
      if (opts.open) openUrl(url);
    });

  program
    .command('openapi')
    .description('fetch OpenAPI JSON from /docs/json')
    .option('-o, --output <file>', 'write to file instead of stdout')
    .action(async (opts: { output?: string }) => {
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
        const base = await apiBase(program);
        const body: Record<string, unknown> = {
          timeout_ms: opts.timeoutMs,
          markdown: opts.noMarkdown ? 'false' : 'true',
        };
        if (opts.settleMs !== undefined && !Number.isNaN(opts.settleMs)) body.settle_ms = opts.settleMs;

        const res = await postRebox(base, 'text', url, body, mergeHeaders(program));
        if (!res.ok) await failResponse(res, 'text');
        const j = (await res.json()) as TextBody;
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
        const base = await apiBase(program);
        const body: Record<string, unknown> = {
          timeout_ms: opts.timeoutMs,
          format: opts.format === 'webp' ? 'webp' : 'png',
          fullPage: opts.viewportOnly ? 'false' : 'true',
        };
        if (opts.scroll === false) body.scroll_full_page = 'false';
        if (opts.settleMs !== undefined && !Number.isNaN(opts.settleMs)) body.settle_ms = opts.settleMs;

        const res = await postRebox(base, 'image', url, body, mergeHeaders(program));
        if (!res.ok) await failResponse(res, 'image');
        const buf = Buffer.from(await res.arrayBuffer());
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
      const base = await apiBase(program);
      const body: Record<string, unknown> = {};
      if (opts.lang) body.lang = opts.lang;

      const res = await postRebox(base, 'audio', url, body, mergeHeaders(program));
      if (!res.ok) await failResponse(res, 'audio');
      const j = (await res.json()) as AudioBody;
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

main().catch((e) => {
  console.error(pc.red(e instanceof Error ? e.message : String(e)));
  process.exit(1);
});
