/** Resolve API key from `X-API-Key`, `Authorization: Bearer`, or `Authorization: ApiKey`. */
export function extractClientApiKey(headers: {
  'x-api-key'?: string | undefined;
  authorization?: string | undefined;
}): string | undefined {
  const raw = headers['x-api-key'];
  if (typeof raw === 'string') {
    const t = raw.trim();
    if (t) return t;
  }
  const auth = headers.authorization;
  if (typeof auth !== 'string') return undefined;
  const s = auth.trim();
  const bearer = /^Bearer\s+(\S+)/i.exec(s);
  if (bearer?.[1]) return bearer[1];
  const apiKey = /^ApiKey\s+(\S+)/i.exec(s);
  if (apiKey?.[1]) return apiKey[1];
  return undefined;
}
