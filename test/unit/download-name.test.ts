import { describe, expect, it } from 'vitest';

import {
  contentDispositionInlineFilename,
  hostnameBasename,
  resolveScreenshotBasename,
  titleBasename,
} from '../../src/download-name.js';

describe('hostnameBasename', () => {
  it('uses hostname', () => {
    expect(hostnameBasename('https://learn.ai-native.pro/path')).toBe('learn.ai-native.pro');
  });
});

describe('titleBasename', () => {
  it('slugifies title', () => {
    expect(titleBasename('Hello — World!')).toMatch(/Hello.*World/);
  });
});

describe('resolveScreenshotBasename', () => {
  it('prefers save_as', () => {
    expect(
      resolveScreenshotBasename('https://a.com/', 'T', {
        saveAs: 'my-lesson',
        filenameSource: 'host',
      }),
    ).toBe('my-lesson');
  });

  it('uses title when requested', () => {
    const b = resolveScreenshotBasename('https://a.com/', 'My Cool Page', {
      filenameSource: 'title',
    });
    expect(b.toLowerCase()).toContain('my');
    expect(b.toLowerCase()).toContain('cool');
  });

  it('falls back to host when title empty', () => {
    expect(
      resolveScreenshotBasename('https://z.example/', '…', { filenameSource: 'title' }),
    ).toBe('z.example');
  });
});

describe('contentDispositionInlineFilename', () => {
  it('quotes ASCII name', () => {
    expect(contentDispositionInlineFilename('learn.ai-native.pro', 'png')).toBe(
      'inline; filename="learn.ai-native.pro.png"',
    );
  });

  it('adds filename star for unicode', () => {
    const h = contentDispositionInlineFilename('скрин', 'png');
    expect(h).toContain("filename=\"");
    expect(h).toContain("filename*=UTF-8''");
  });
});
