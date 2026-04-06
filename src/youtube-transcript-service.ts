import {
  fetchTranscript,
  YoutubeTranscript,
} from 'youtube-transcript/dist/youtube-transcript.esm.js';

import { ReboxHttpError } from './errors.js';
import { extractYoutubeVideoId } from './youtube.js';
import {
  fetchTranscriptForTrack,
  listCaptionTracks,
  listCaptionTracksFromWatchPage,
  sortCaptionTracksManualFirst,
} from './youtube-transcript-resolve.js';

function mapRows(rows: Array<{ text: string; duration: number; offset: number }>) {
  return rows.map((r) => ({
    startSec: r.offset,
    durationSec: r.duration,
    text: r.text,
  }));
}

async function tryFetchTranscriptRows(
  videoIdOrUrl: string,
  lang?: string,
): Promise<{ rows: Array<{ text: string; duration: number; offset: number; lang?: string }>; captionLanguage: string }> {
  const rows = await fetchTranscript(videoIdOrUrl, lang ? { lang } : undefined);
  if (rows.length === 0) {
    throw new Error('Empty transcript');
  }
  const captionLanguage = lang ?? rows.find((r) => r.lang)?.lang ?? rows[0]!.lang ?? '';
  return { rows, captionLanguage };
}

async function resolveTranscriptAutoLanguage(
  videoId: string,
  videoIdOrUrl: string,
): Promise<{ rows: Array<{ text: string; duration: number; offset: number }>; captionLanguage: string }> {
  let firstError: unknown;
  try {
    return await tryFetchTranscriptRows(videoIdOrUrl, undefined);
  } catch (e) {
    firstError = e;
  }

  let tracks = await listCaptionTracks(videoId);
  if (!tracks || tracks.length === 0) {
    try {
      tracks = await listCaptionTracksFromWatchPage(videoId);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      throw new ReboxHttpError('TRANSCRIPT_UNAVAILABLE', msg, 404);
    }
  }

  const ordered = sortCaptionTracksManualFirst(tracks);
  const ytx = YoutubeTranscript as unknown as {
    parseTranscriptXml: (xml: string, lang: string) => Array<{ text: string; duration: number; offset: number; lang?: string }>;
  };

  for (const track of ordered) {
    const rows = await fetchTranscriptForTrack(ytx, track);
    if (rows && rows.length > 0) {
      return { rows, captionLanguage: track.languageCode };
    }
  }

  const msg = firstError instanceof Error ? firstError.message : String(firstError);
  throw new ReboxHttpError('TRANSCRIPT_UNAVAILABLE', msg, 404);
}

function listingVideoId(videoIdOrUrl: string): string {
  return extractYoutubeVideoId(videoIdOrUrl) ?? videoIdOrUrl;
}

export async function loadYoutubeTranscript(
  videoIdOrUrl: string,
  lang?: string,
): Promise<{
  segments: Array<{ startSec: number; durationSec: number; text: string }>;
  captionLanguage?: string;
}> {
  try {
    if (lang) {
      const { rows, captionLanguage } = await tryFetchTranscriptRows(videoIdOrUrl, lang);
      return { segments: mapRows(rows), captionLanguage };
    }

    const videoId = listingVideoId(videoIdOrUrl);
    const { rows, captionLanguage } = await resolveTranscriptAutoLanguage(videoId, videoIdOrUrl);
    return { segments: mapRows(rows), captionLanguage };
  } catch (e) {
    if (e instanceof ReboxHttpError) throw e;
    const msg = e instanceof Error ? e.message : String(e);
    throw new ReboxHttpError('TRANSCRIPT_UNAVAILABLE', msg, 404);
  }
}
