import { describe, expect, it } from 'vitest';

import { loadConfig } from '../../src/config.js';
import { assertSafeUrl, SsrfError } from '../../src/ssrf.js';

const cfg = loadConfig({});

describe('assertSafeUrl', () => {
  it('blocks literal loopback IPv4', async () => {
    await expect(assertSafeUrl('https://127.0.0.1/', cfg)).rejects.toThrow(SsrfError);
  });

  it('blocks file scheme', async () => {
    await expect(assertSafeUrl('file:///etc/passwd', cfg)).rejects.toThrow(SsrfError);
  });

  it('blocks credentials in URL', async () => {
    await expect(assertSafeUrl('https://user:pass@example.com/', cfg)).rejects.toThrow(SsrfError);
  });

  it('allows https for a public host when DNS resolves', async () => {
    await expect(assertSafeUrl('https://example.com/', cfg)).resolves.toMatchObject({
      hostname: 'example.com',
    });
  });
});
