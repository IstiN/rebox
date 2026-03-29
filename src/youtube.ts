export function extractYoutubeVideoId(rawUrl: string): string | null {
  try {
    const u = new URL(rawUrl);
    const host = u.hostname.toLowerCase();
    if (host === 'youtu.be') {
      const id = u.pathname.split('/').filter(Boolean)[0];
      return id && /^[A-Za-z0-9_-]{11}$/.test(id) ? id : null;
    }
    if (host === 'www.youtube.com' || host === 'youtube.com' || host === 'm.youtube.com') {
      if (u.pathname === '/watch' || u.pathname.startsWith('/watch')) {
        const v = u.searchParams.get('v');
        return v && /^[A-Za-z0-9_-]{11}$/.test(v) ? v : null;
      }
      const embed = u.pathname.match(/^\/embed\/([\w-]{11})/);
      if (embed) return embed[1] ?? null;
      const shorts = u.pathname.match(/^\/shorts\/([\w-]{11})/);
      if (shorts) return shorts[1] ?? null;
    }
    return null;
  } catch {
    return null;
  }
}
