import { describe, expect, it } from 'vitest';

import { extractYoutubeVideoId } from '../../src/youtube.js';

describe('extractYoutubeVideoId', () => {
  it('parses watch URL', () => {
    expect(extractYoutubeVideoId('https://www.youtube.com/watch?v=dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
  });

  it('parses short youtu.be', () => {
    expect(extractYoutubeVideoId('https://youtu.be/dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
  });

  it('parses embed', () => {
    expect(extractYoutubeVideoId('https://www.youtube.com/embed/dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
  });

  it('returns null for non-youtube', () => {
    expect(extractYoutubeVideoId('https://learn.ai-native.pro/')).toBeNull();
  });
});
