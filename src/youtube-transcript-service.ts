import { fetchTranscript } from 'youtube-transcript/dist/youtube-transcript.esm.js';

import { ReboxHttpError } from './errors.js';

export async function loadYoutubeTranscript(
  videoIdOrUrl: string,
  lang?: string,
): Promise<{
  segments: Array<{ startSec: number; durationSec: number; text: string }>;
}> {
  try {
    const rows = await fetchTranscript(videoIdOrUrl, lang ? { lang } : undefined);
    const segments = rows.map((r) => ({
      startSec: r.offset,
      durationSec: r.duration,
      text: r.text,
    }));
    return { segments };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new ReboxHttpError('TRANSCRIPT_UNAVAILABLE', msg, 404);
  }
}
