import { afterEach, describe, expect, it, vi } from 'vitest';

import { buildAuthHeaders, normalizeBaseUrl, postRebox } from '../../src/cli-client.js';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('cli-client', () => {
  it('normalizeBaseUrl strips trailing slashes', () => {
    expect(normalizeBaseUrl('https://x/')).toBe('https://x');
    expect(normalizeBaseUrl('  https://x  ')).toBe('https://x');
  });

  it('normalizeBaseUrl rejects empty', () => {
    expect(() => normalizeBaseUrl('')).toThrow('empty');
    expect(() => normalizeBaseUrl('  ')).toThrow('empty');
  });

  it('buildAuthHeaders', () => {
    expect(buildAuthHeaders(undefined, 'bearer')).toEqual({});
    expect(buildAuthHeaders('  ', 'bearer')).toEqual({});
    expect(buildAuthHeaders('k', 'bearer')).toEqual({ Authorization: 'Bearer k' });
    expect(buildAuthHeaders('k', 'x-api-key')).toEqual({ 'X-API-Key': 'k' });
  });

  it('postRebox uses legacy URL when plain route returns 404', async () => {
    const calls: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const u = String(input);
        calls.push(u);
        if (u.endsWith('/rebox/image')) {
          return new Response('not found', { status: 404 });
        }
        if (u.includes(encodeURIComponent('https://a.test/'))) {
          return new Response(new Uint8Array([1, 2, 3]), { status: 200 });
        }
        return new Response('err', { status: 500 });
      }) as typeof fetch,
    );

    const res = await postRebox(
      'http://127.0.0.1:3000',
      'image',
      'https://a.test/',
      { format: 'png' },
      {},
    );
    expect(res.status).toBe(200);
    expect(calls).toHaveLength(2);
    expect(calls[1]).toContain(encodeURIComponent('https://a.test/'));
    expect(calls[1]).not.toContain('/rebox/image');
    expect(calls[1]).toMatch(/\/rebox\/https%3A%2F%2Fa\.test%2F\/image$/);
  });

  it('postRebox does not retry when plain route succeeds', async () => {
    const calls: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        calls.push(String(input));
        return new Response('ok', { status: 200 });
      }) as typeof fetch,
    );

    const res = await postRebox('http://x', 'text', 'https://b/', {}, {});
    expect(res.status).toBe(200);
    expect(calls).toHaveLength(1);
  });
});
