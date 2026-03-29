import dns from 'node:dns/promises';
import net from 'node:net';
import { URL } from 'node:url';

import type { Config } from './config.js';

function buildBlockList(): net.BlockList {
  const b = new net.BlockList();
  b.addSubnet('127.0.0.0', 8, 'ipv4');
  b.addSubnet('10.0.0.0', 8, 'ipv4');
  b.addSubnet('172.16.0.0', 12, 'ipv4');
  b.addSubnet('192.168.0.0', 16, 'ipv4');
  b.addSubnet('169.254.0.0', 16, 'ipv4');
  b.addSubnet('0.0.0.0', 8, 'ipv4');
  b.addSubnet('100.64.0.0', 10, 'ipv4');
  b.addSubnet('192.0.0.0', 24, 'ipv4');
  b.addSubnet('192.0.2.0', 24, 'ipv4');
  b.addSubnet('198.18.0.0', 15, 'ipv4');
  b.addSubnet('198.51.100.0', 24, 'ipv4');
  b.addSubnet('203.0.113.0', 24, 'ipv4');
  b.addSubnet('224.0.0.0', 4, 'ipv4');
  b.addSubnet('240.0.0.0', 4, 'ipv4');

  b.addSubnet('::1', 128, 'ipv6');
  b.addSubnet('fc00::', 7, 'ipv6');
  b.addSubnet('fe80::', 10, 'ipv6');
  return b;
}

const blockList = buildBlockList();

export class SsrfError extends Error {
  constructor(
    message: string,
    public readonly code: 'SSRF_BLOCKED' | 'INVALID_URL' | 'DNS_REBINDING',
  ) {
    super(message);
    this.name = 'SsrfError';
  }
}

function isBlockedIp(ip: string, family: 4 | 6): boolean {
  const kind = family === 4 ? 'ipv4' : 'ipv6';
  return blockList.check(ip, kind);
}

/** Map IPv4-mapped IPv6 (::ffff:a.b.c.d) to dotted IPv4 for blocklist checks. */
function normalizeIpLiteral(ip: string): { ip: string; family: 4 | 6 } | null {
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(ip);
  if (mapped) return { ip: mapped[1], family: 4 };
  const v = net.isIP(ip);
  if (v === 4) return { ip, family: 4 };
  if (v === 6) return { ip, family: 6 };
  return null;
}

function assertLiteralHost(hostname: string): void {
  const norm = normalizeIpLiteral(hostname);
  if (norm) {
    if (isBlockedIp(norm.ip, norm.family)) {
      throw new SsrfError('Target IP is not allowed', 'SSRF_BLOCKED');
    }
    return;
  }
  if (hostname.toLowerCase() === 'localhost') {
    throw new SsrfError('localhost is not allowed', 'SSRF_BLOCKED');
  }
}

async function assertResolvedHost(hostname: string): Promise<void> {
  if (net.isIP(hostname)) return;

  const seen = new Set<string>();
  const checkResolved = (raw: string) => {
    const norm = normalizeIpLiteral(raw);
    if (!norm) return;
    const { ip, family } = norm;
    if (seen.has(ip)) return;
    seen.add(ip);
    if (isBlockedIp(ip, family)) {
      throw new SsrfError(`Resolved address blocked: ${raw}`, 'DNS_REBINDING');
    }
  };

  try {
    const r4 = await dns.resolve4(hostname).catch(() => [] as string[]);
    for (const ip of r4) checkResolved(ip);
    const r6 = await dns.resolve6(hostname).catch(() => [] as string[]);
    for (const ip of r6) checkResolved(ip);
    if (seen.size === 0) {
      throw new SsrfError('Could not resolve hostname', 'DNS_REBINDING');
    }
  } catch (e) {
    if (e instanceof SsrfError) throw e;
    throw new SsrfError('DNS resolution failed', 'DNS_REBINDING');
  }
}

export async function assertSafeUrl(rawUrl: string, cfg: Config): Promise<URL> {
  let u: URL;
  try {
    u = new URL(rawUrl);
  } catch {
    throw new SsrfError('Malformed URL', 'INVALID_URL');
  }

  if (u.protocol !== 'https:' && !(cfg.allowHttp && u.protocol === 'http:')) {
    throw new SsrfError('Only https URLs are allowed', 'INVALID_URL');
  }

  if (u.username || u.password) {
    throw new SsrfError('Credentials in URL are not allowed', 'INVALID_URL');
  }

  const host = u.hostname;
  if (!host) {
    throw new SsrfError('Missing host', 'INVALID_URL');
  }

  assertLiteralHost(host);
  await assertResolvedHost(host);

  return u;
}
