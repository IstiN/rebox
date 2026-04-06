declare module 'youtube-transcript/dist/youtube-transcript.esm.js' {
  export interface TranscriptRow {
    text: string;
    duration: number;
    offset: number;
    lang?: string;
  }
  export class YoutubeTranscript {
    static parseTranscriptXml(xml: string, lang: string): TranscriptRow[];
  }
  export function fetchTranscript(
    videoId: string,
    config?: { lang?: string; fetch?: typeof fetch },
  ): Promise<TranscriptRow[]>;
}
