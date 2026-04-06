import { describe, expect, it } from 'vitest';

import { sortCaptionTracksManualFirst } from '../../src/youtube-transcript-resolve.js';

describe('sortCaptionTracksManualFirst', () => {
  it('orders manual captions before asr', () => {
    const sorted = sortCaptionTracksManualFirst([
      { languageCode: 'en', baseUrl: 'https://www.youtube.com/api/timedtext?v=1&kind=asr', kind: 'asr' },
      { languageCode: 'ru', baseUrl: 'https://www.youtube.com/api/timedtext?v=2' },
    ]);
    expect(sorted.map((t) => t.languageCode)).toEqual(['ru', 'en']);
  });

  it('preserves relative order within the same kind group', () => {
    const sorted = sortCaptionTracksManualFirst([
      { languageCode: 'de', baseUrl: 'https://www.youtube.com/api/timedtext?v=a' },
      { languageCode: 'fr', baseUrl: 'https://www.youtube.com/api/timedtext?v=b' },
    ]);
    expect(sorted.map((t) => t.languageCode)).toEqual(['de', 'fr']);
  });
});
