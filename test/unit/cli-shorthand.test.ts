import { describe, expect, it } from 'vitest';

import { applyUrlShorthand, sanitizePastedUrl } from '../../src/cli-shorthand.js';

describe('applyUrlShorthand', () => {
  it('inserts text before a lone https URL', () => {
    expect(applyUrlShorthand(['https://example.com/'])).toEqual([
      'text',
      'https://example.com/',
    ]);
  });

  it('inserts audio before a YouTube watch URL', () => {
    expect(
      applyUrlShorthand(['https://www.youtube.com/watch?v=cg731l0EAFs']),
    ).toEqual(['audio', 'https://www.youtube.com/watch?v=cg731l0EAFs']);
  });

  it('strips terminal junk after the URL before routing', () => {
    const dirty = 'https://www.youtube.com/watch?v=cg731l0EAFs\x15\x1b[D';
    expect(applyUrlShorthand([dirty])).toEqual([
      'audio',
      'https://www.youtube.com/watch?v=cg731l0EAFs',
    ]);
  });

  it('inserts after global -b / -k', () => {
    expect(applyUrlShorthand(['-b', 'http://localhost:3000', 'https://x/'])).toEqual([
      '-b',
      'http://localhost:3000',
      'text',
      'https://x/',
    ]);
  });

  it('preserves --no-auto-server before shorthand URL', () => {
    expect(applyUrlShorthand(['--no-auto-server', 'https://youtu.be/cg731l0EAFs'])).toEqual([
      '--no-auto-server',
      'audio',
      'https://youtu.be/cg731l0EAFs',
    ]);
  });

  it('allows text options after URL', () => {
    expect(applyUrlShorthand(['https://x/', '--timeout-ms', '5000', '--visible-only'])).toEqual([
      'text',
      'https://x/',
      '--timeout-ms',
      '5000',
      '--visible-only',
    ]);
  });

  it('does not change explicit subcommands', () => {
    expect(applyUrlShorthand(['health'])).toEqual(['health']);
    expect(applyUrlShorthand(['text', 'https://x/'])).toEqual(['text', 'https://x/']);
  });

  it('does not treat http URL + bare word as shorthand', () => {
    expect(applyUrlShorthand(['https://x/', 'nope'])).toEqual(['https://x/', 'nope']);
  });

  it('leaves unknown leading flags alone', () => {
    expect(applyUrlShorthand(['--weird', 'https://x/'])).toEqual(['--weird', 'https://x/']);
  });
});

describe('sanitizePastedUrl', () => {
  it('removes trailing control characters', () => {
    expect(sanitizePastedUrl('https://example.com/\x15foo')).toBe('https://example.com/');
  });

  it('strips ANSI CSI sequences', () => {
    expect(sanitizePastedUrl('https://x.test/\x1b[2D')).toBe('https://x.test/');
  });
});
