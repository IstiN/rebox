declare module 'youtube-transcript/dist/youtube-transcript.esm.js' {
  export interface TranscriptRow {
    text: string;
    duration: number;
    offset: number;
    lang?: string;
  }
  export function fetchTranscript(
    videoId: string,
    config?: { lang?: string; fetch?: typeof fetch },
  ): Promise<TranscriptRow[]>;
}
