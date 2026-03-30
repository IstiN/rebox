import { describe, expect, it } from 'vitest';

import { applyUrlShorthand } from '../../src/cli-shorthand.js';

describe('applyUrlShorthand', () => {
  it('inserts text before a lone https URL', () => {
    expect(applyUrlShorthand(['https://example.com/'])).toEqual([
      'text',
      'https://example.com/',
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
