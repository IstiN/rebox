import { readFileSync, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';

import { Command } from 'commander';
import pc from 'picocolors';

import { buildAuthHeaders, normalizeBaseUrl, readErrorBody, type HeaderStyle } from './cli-client.js';
import { applyUrlShorthand } from './cli-shorthand.js';

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

async function failResponse(res: Response, label: string): Promise<never> {
  const detail = await readErrorBody(res);
  console.error(pc.red(`${label}: ${res.status} ${res.statusText}`), detail ? `\n${detail}` : '');
  process.exit(1);
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
        pc.cyan('rebox text https://example.com/'),
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
    .configureHelp({
      sortSubcommands: true,
      subcommandTerm: (cmd) => pc.cyan(cmd.name()),
    })
    .showHelpAfterError('(add -h for usage)');

  program
    .command('health')
    .description('GET /health — liveness')
    .action(async () => {
      const base = resolveBaseUrl(program);
      const res = await fetch(`${base}/health`);
      if (!res.ok) await failResponse(res, 'health');
      const j = await res.json();
      console.log(pc.green('ok'), JSON.stringify(j, null, 2));
    });

  program
    .command('ready')
    .description('GET /ready — browser readiness')
    .action(async () => {
      const base = resolveBaseUrl(program);
      const res = await fetch(`${base}/ready`);
      if (!res.ok) await failResponse(res, 'ready');
      const j = await res.json();
      console.log(pc.green('ok'), JSON.stringify(j, null, 2));
    });

  program
    .command('info')
    .description('GET / — service route map (requires API key if configured on server)')
    .action(async () => {
      const base = resolveBaseUrl(program);
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
      const base = resolveBaseUrl(program);
      const url = `${base}/docs/`;
      console.log(url);
      if (opts.open) openUrl(url);
    });

  program
    .command('openapi')
    .description('fetch OpenAPI JSON from /docs/json')
    .option('-o, --output <file>', 'write to file instead of stdout')
    .action(async (opts: { output?: string }) => {
      const base = resolveBaseUrl(program);
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
    .description('POST /rebox/text — article + visibleText JSON')
    .argument('<url>', 'target page URL')
    .option('--timeout-ms <n>', 'navigation timeout', (v) => Number(v), 60_000)
    .option('--settle-ms <n>', 'post-navigation wait', (v) => Number(v))
    .option('--no-markdown', 'ask server for HTML-oriented defuddle output')
    .option('--visible-only', 'print visibleText only')
    .action(
      async (
        url: string,
        opts: { timeoutMs: number; settleMs?: number; noMarkdown?: boolean; visibleOnly?: boolean },
      ) => {
        const base = resolveBaseUrl(program);
        const body: Record<string, unknown> = {
          url,
          timeout_ms: opts.timeoutMs,
          markdown: opts.noMarkdown ? 'false' : 'true',
        };
        if (opts.settleMs !== undefined && !Number.isNaN(opts.settleMs)) body.settle_ms = opts.settleMs;

        const res = await fetch(`${base}/rebox/text`, {
          method: 'POST',
          headers: mergeHeaders(program, { 'Content-Type': 'application/json' }),
          body: JSON.stringify(body),
        });
        if (!res.ok) await failResponse(res, 'text');
        const j = (await res.json()) as { visibleText?: string; article?: { contentMarkdown?: string } };
        if (opts.visibleOnly) {
          console.log(j.visibleText ?? '');
          return;
        }
        console.log(JSON.stringify(j, null, 2));
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
    .action(
      async (
        url: string,
        opts: {
          output: string;
          timeoutMs: number;
          settleMs?: number;
          format: string;
          viewportOnly?: boolean;
        },
      ) => {
        const base = resolveBaseUrl(program);
        const body: Record<string, unknown> = {
          url,
          timeout_ms: opts.timeoutMs,
          format: opts.format === 'webp' ? 'webp' : 'png',
          fullPage: opts.viewportOnly ? 'false' : 'true',
        };
        if (opts.settleMs !== undefined && !Number.isNaN(opts.settleMs)) body.settle_ms = opts.settleMs;

        const res = await fetch(`${base}/rebox/image`, {
          method: 'POST',
          headers: mergeHeaders(program, { 'Content-Type': 'application/json' }),
          body: JSON.stringify(body),
        });
        if (!res.ok) await failResponse(res, 'image');
        const buf = Buffer.from(await res.arrayBuffer());
        writeFileSync(opts.output, buf);
        console.error(pc.dim(`wrote ${opts.output} (${buf.length} bytes)`));
      },
    );

  program
    .command('audio')
    .description('POST /rebox/audio — YouTube transcript JSON')
    .argument('<url>', 'YouTube watch URL')
    .option('--lang <code>', 'caption language')
    .action(async (url: string, opts: { lang?: string }) => {
      const base = resolveBaseUrl(program);
      const body: Record<string, unknown> = { url };
      if (opts.lang) body.lang = opts.lang;

      const res = await fetch(`${base}/rebox/audio`, {
        method: 'POST',
        headers: mergeHeaders(program, { 'Content-Type': 'application/json' }),
        body: JSON.stringify(body),
      });
      if (!res.ok) await failResponse(res, 'audio');
      const j = await res.json();
      console.log(JSON.stringify(j, null, 2));
    });

  const argv = applyUrlShorthand(process.argv.slice(2));
  await program.parseAsync([process.argv[0]!, process.argv[1]!, ...argv]);
}

main().catch((e) => {
  console.error(pc.red(e instanceof Error ? e.message : String(e)));
  process.exit(1);
});
