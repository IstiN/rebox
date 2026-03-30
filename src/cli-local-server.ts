import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import pc from 'picocolors';

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function packageRootFromModuleUrl(moduleUrl: string): string {
  let dir = dirname(fileURLToPath(moduleUrl));
  for (;;) {
    if (existsSync(join(dir, 'package.json'))) return dir;
    const parent = dirname(dir);
    if (parent === dir) throw new Error('package.json not found (rebox install broken?)');
    dir = parent;
  }
}

function resolveServerLaunch():
  | { cmd: string; args: string[]; cwd: string }
  | { error: string } {
  const root = packageRootFromModuleUrl(import.meta.url);
  const distJs = join(root, 'dist', 'server.js');
  if (existsSync(distJs)) {
    return { cmd: process.execPath, args: [distJs], cwd: root };
  }
  const tsEntry = join(root, 'src', 'server.ts');
  const tsxBin = join(root, 'node_modules', '.bin', 'tsx');
  if (existsSync(tsEntry) && existsSync(tsxBin)) {
    return { cmd: tsxBin, args: [tsEntry], cwd: root };
  }
  return {
    error:
      'Local rebox server is not running and could not be started (no dist/server.js). Run: npm run build',
  };
}

export function parseHttpBase(base: string): { hostname: string; port: number } {
  const raw = base.trim();
  const u = new URL(raw.includes('://') ? raw : `http://${raw}`);
  const port = u.port ? Number(u.port) : u.protocol === 'https:' ? 443 : 80;
  return { hostname: u.hostname, port };
}

export function isLocalBaseUrl(base: string): boolean {
  const { hostname } = parseHttpBase(base);
  const h = hostname.toLowerCase();
  return h === 'localhost' || h === '127.0.0.1' || h === '::1' || h === '[::1]';
}

function isConnectionFailure(err: unknown): boolean {
  const code =
    err && typeof err === 'object' && 'cause' in err && err.cause && typeof err.cause === 'object'
      ? (err.cause as NodeJS.ErrnoException).code
      : (err as NodeJS.ErrnoException)?.code;
  return (
    code === 'ECONNREFUSED' ||
    code === 'ENOTFOUND' ||
    code === 'EAI_AGAIN' ||
    code === 'ENETUNREACH'
  );
}

async function fetchJson(url: string, ms: number): Promise<{ ok: boolean; json: unknown } | 'fail'> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(ms) });
    const text = await res.text();
    let json: unknown;
    try {
      json = JSON.parse(text) as unknown;
    } catch {
      json = null;
    }
    return { ok: res.ok, json };
  } catch (e) {
    if (isConnectionFailure(e)) return 'fail';
    throw e;
  }
}

async function reboxHealthState(base: string): Promise<'ok' | 'wrong' | 'down'> {
  const r = await fetchJson(`${base}/health`, 2500);
  if (r === 'fail') return 'down';
  const status =
    r.json && typeof r.json === 'object' && r.json !== null && 'status' in r.json
      ? (r.json as { status?: string }).status
      : undefined;
  if (r.ok && status === 'ok') return 'ok';
  return 'wrong';
}

/**
 * True if this base URL is a rebox instance: plain `/rebox/text` returns 400/401,
 * or that route is 404 but `/ready` is up (legacy rebox without plain routes).
 */
async function localBaseLooksLikeRebox(base: string): Promise<boolean> {
  try {
    const textRes = await fetch(`${base}/rebox/text`, { signal: AbortSignal.timeout(4000) });
    if (textRes.status === 400 || textRes.status === 401) return true;
    if (textRes.status === 404 && (await reboxReadyOk(base))) return true;
    return false;
  } catch {
    return false;
  }
}

async function reboxReadyOk(base: string): Promise<boolean> {
  const r = await fetchJson(`${base}/ready`, 4000);
  if (r === 'fail') return false;
  const status =
    r.json && typeof r.json === 'object' && r.json !== null && 'status' in r.json
      ? (r.json as { status?: string }).status
      : undefined;
  return Boolean(r.ok && status === 'ready');
}

async function waitUntilReady(base: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await reboxReadyOk(base)) return;
    await sleep(400);
  }
  throw new Error(`rebox server at ${base} did not become ready within ${timeoutMs}ms`);
}

let managedChild: ChildProcess | undefined;

function registerChildCleanup(child: ChildProcess): void {
  const stop = (): void => {
    try {
      child.kill('SIGTERM');
    } catch {
      /* ignore */
    }
  };
  process.once('exit', stop);
  process.once('SIGINT', () => {
    stop();
    process.exit(130);
  });
  process.once('SIGTERM', () => {
    stop();
    process.exit(143);
  });
}

export interface EnsureLocalOptions {
  /** When false, never spawn (default true unless REBOX_AUTO_SERVER=0). */
  autoServer: boolean;
}

/**
 * If base is localhost and no rebox responds, spawn dist/server.js (or tsx src/server.ts in dev).
 */
export async function ensureLocalReboxServer(base: string, opts: EnsureLocalOptions): Promise<string> {
  if (!opts.autoServer || !isLocalBaseUrl(base)) return base;

  const health = await reboxHealthState(base);
  if (health === 'wrong') {
    const { port } = parseHttpBase(base);
    console.error(
      pc.red(
        `Something on port ${port} is not rebox (unexpected /health). Free the port or set REBOX_BASE_URL / -b to your server.`,
      ),
    );
    process.exit(1);
  }

  if (health === 'ok') {
    if (isLocalBaseUrl(base) && !(await localBaseLooksLikeRebox(base))) {
      const { port } = parseHttpBase(base);
      console.error(
        pc.red(
          `Port ${port} answers /health but does not look like rebox (plain /rebox/text missing and /ready not OK). Another app may be using this port — stop it, or set REBOX_BASE_URL to your rebox server.`,
        ),
      );
      process.exit(1);
    }
    await waitUntilReady(base, 120_000);
    return base;
  }

  const launch = resolveServerLaunch();
  if ('error' in launch) {
    console.error(pc.red(launch.error));
    process.exit(1);
  }

  const { port, hostname } = parseHttpBase(base);
  const host =
    hostname === '::1' || hostname === '[::1]'
      ? '127.0.0.1'
      : hostname === 'localhost'
        ? '127.0.0.1'
        : hostname;

  console.error(pc.dim(`Starting local rebox on ${host}:${port}…`));

  const child = spawn(launch.cmd, launch.args, {
    cwd: launch.cwd,
    env: { ...process.env, PORT: String(port), HOST: host },
    stdio: ['ignore', 'inherit', 'inherit'],
    detached: false,
  });
  managedChild = child;
  registerChildCleanup(child);

  child.on('error', (err) => {
    console.error(pc.red('Failed to start rebox server:'), err.message);
    process.exit(1);
  });

  try {
    await waitUntilReady(base, 120_000);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(pc.red(msg));
    try {
      child.kill('SIGTERM');
    } catch {
      /* ignore */
    }
    const exitWait = new Promise<number>((resolve) => {
      child.once('exit', (c) => resolve(c ?? 0));
    });
    await Promise.race([exitWait, sleep(2000)]);
    process.exit(1);
  }

  return base;
}

export function isManagedLocalServer(): boolean {
  return managedChild !== undefined;
}
