import { describe, expect, it } from 'vitest';

import { isLocalBaseUrl, parseHttpBase } from '../../src/cli-local-server.js';

describe('cli-local-server', () => {
  it('parseHttpBase reads hostname and port', () => {
    expect(parseHttpBase('http://127.0.0.1:3000')).toEqual({ hostname: '127.0.0.1', port: 3000 });
    expect(parseHttpBase('http://localhost/')).toEqual({ hostname: 'localhost', port: 80 });
    expect(parseHttpBase('https://example.com')).toEqual({ hostname: 'example.com', port: 443 });
  });

  it('isLocalBaseUrl is true for loopback hosts', () => {
    expect(isLocalBaseUrl('http://127.0.0.1:3000')).toBe(true);
    expect(isLocalBaseUrl('http://localhost:8080')).toBe(true);
    expect(isLocalBaseUrl('http://[::1]:3000')).toBe(true);
    expect(isLocalBaseUrl('https://example.com')).toBe(false);
  });
});
