import { randomUUID } from 'node:crypto';

export type ErrorCode =
  | 'INVALID_URL'
  | 'INVALID_ENCODING'
  | 'SSRF_BLOCKED'
  | 'DNS_REBINDING'
  | 'TIMEOUT'
  | 'NAVIGATION_FAILED'
  | 'BODY_TOO_LARGE'
  | 'SCREENSHOT_TOO_LARGE'
  | 'BROWSER_CRASH'
  | 'EXTRACTION_FAILED'
  | 'TRANSCRIPT_UNAVAILABLE'
  | 'TRANSCRIPTION_FAILED'
  | 'RATE_LIMITED'
  | 'UNAUTHORIZED'
  | 'INTERNAL';

export class ReboxHttpError extends Error {
  constructor(
    public readonly code: ErrorCode,
    message: string,
    public readonly status: number,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'ReboxHttpError';
  }
}

export function newRequestId(): string {
  return randomUUID();
}

export function errorBody(
  code: ErrorCode,
  message: string,
  requestId: string,
  details?: Record<string, unknown>,
) {
  return { code, message, requestId, details };
}
