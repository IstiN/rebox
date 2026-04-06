const INNERTUBE_URL = 'https://www.youtube.com/youtubei/v1/player?prettyPrint=false';
const ANDROID_CLIENT_VERSION = '20.10.38';
const ANDROID_CONTEXT = {
  client: { clientName: 'ANDROID', clientVersion: ANDROID_CLIENT_VERSION },
} as const;
const ANDROID_UA = `com.google.android.youtube/${ANDROID_CLIENT_VERSION} (Linux; U; Android 14)`;
const WEB_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_4) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/85.0.4183.83 Safari/537.36,gzip(gfe)';

export type YoutubeCaptionTrack = {
  languageCode: string;
  baseUrl: string;
  kind?: string;
};

type TranscriptRow = { text: string; duration: number; offset: number; lang?: string };

function parseInlineJson(html: string, globalName: string): unknown | null {
  const prefix = `var ${globalName} = `;
  const start = html.indexOf(prefix);
  if (start === -1) return null;
  let depth = 0;
  const from = start + prefix.length;
  for (let i = from; i < html.length; i++) {
    if (html[i] === '{') depth++;
    else if (html[i] === '}') {
      depth--;
      if (depth === 0) {
        try {
          return JSON.parse(html.slice(from, i + 1));
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

export function sortCaptionTracksManualFirst(tracks: YoutubeCaptionTrack[]): YoutubeCaptionTrack[] {
  return [...tracks].sort((a, b) => {
    const rank = (t: YoutubeCaptionTrack) => (t.kind === 'asr' ? 1 : 0);
    return rank(a) - rank(b);
  });
}

export async function listCaptionTracks(
  videoId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<YoutubeCaptionTrack[] | undefined> {
  try {
    const res = await fetchImpl(INNERTUBE_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': ANDROID_UA,
      },
      body: JSON.stringify({ context: ANDROID_CONTEXT, videoId }),
    });
    if (!res.ok) return undefined;
    const json = (await res.json()) as {
      captions?: { playerCaptionsTracklistRenderer?: { captionTracks?: YoutubeCaptionTrack[] } };
    };
    const tracks = json?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
    if (Array.isArray(tracks) && tracks.length > 0) return tracks;
  } catch {
    return undefined;
  }
  return undefined;
}

export async function listCaptionTracksFromWatchPage(
  videoId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<YoutubeCaptionTrack[]> {
  const html = await (
    await fetchImpl(`https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`, {
      headers: { 'User-Agent': WEB_UA },
    })
  ).text();

  if (html.includes('class="g-recaptcha"')) {
    throw new Error(
      'YouTube is receiving too many requests from this IP and now requires solving a captcha to continue',
    );
  }
  if (!html.includes('"playabilityStatus":')) {
    throw new Error(`The video is no longer available (${videoId})`);
  }

  const player = parseInlineJson(html, 'ytInitialPlayerResponse') as {
    captions?: { playerCaptionsTracklistRenderer?: { captionTracks?: YoutubeCaptionTrack[] } };
  } | null;
  const tracks = player?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
  if (!Array.isArray(tracks) || tracks.length === 0) {
    throw new Error(`Transcript is disabled on this video (${videoId})`);
  }
  return tracks;
}

export async function fetchTranscriptForTrack(
  YoutubeTranscript: {
    parseTranscriptXml: (xml: string, lang: string) => TranscriptRow[];
  },
  track: YoutubeCaptionTrack,
  fetchImpl: typeof fetch = fetch,
): Promise<TranscriptRow[] | null> {
  try {
    let baseUrl: string;
    try {
      baseUrl = track.baseUrl;
      if (!new URL(baseUrl).hostname.endsWith('.youtube.com')) return null;
    } catch {
      return null;
    }

    const res = await fetchImpl(baseUrl, {
      headers: { 'User-Agent': WEB_UA },
    });
    if (!res.ok) return null;
    const xml = await res.text();
    const rows = YoutubeTranscript.parseTranscriptXml(xml, track.languageCode);
    return rows.length > 0 ? rows : null;
  } catch {
    return null;
  }
}
