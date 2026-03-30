/** Small HTTP helpers for the rebox CLI (no server imports). */

export function normalizeBaseUrl(raw: string): string {
  const t = raw.trim().replace(/\/+$/, '');
  if (!t) throw new Error('Base URL is empty');
  return t;
}

export type HeaderStyle = 'bearer' | 'x-api-key';

export function buildAuthHeaders(
  apiKey: string | undefined,
  style: HeaderStyle,
): Record<string, string> {
  if (!apiKey?.trim()) return {};
  const k = apiKey.trim();
  if (style === 'x-api-key') return { 'X-API-Key': k };
  return { Authorization: `Bearer ${k}` };
}

export async function readErrorBody(res: Response): Promise<string> {
  const ct = res.headers.get('content-type') ?? '';
  try {
    if (ct.includes('application/json')) {
      const j = (await res.json()) as { message?: string; code?: string };
      return j.message ?? j.code ?? JSON.stringify(j);
    }
    return await res.text();
  } catch {
    return res.statusText;
  }
}
