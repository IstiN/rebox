import { platform } from 'node:process';

/**
 * Extra Chromium flags that reduce trivial automation fingerprinting. Many sites
 * (e.g. Cloudflare in front of Medium) block the default HeadlessChrome user agent;
 * we still set a Chrome-like UA from the real bundled version in RenderEngine.
 */
export const CHROMIUM_STEALTH_LAUNCH_ARGS = ['--disable-blink-features=AutomationControlled'] as const;

/**
 * Build a desktop Chrome user agent string whose major version matches the running
 * Chromium (avoids obvious UA vs browser mismatches).
 */
export function buildChromeLikeUserAgent(chromeVersion: string): string {
  const v = chromeVersion.trim();
  if (platform === 'darwin') {
    return `Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${v} Safari/537.36`;
  }
  if (platform === 'win32') {
    return `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${v} Safari/537.36`;
  }
  return `Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${v} Safari/537.36`;
}

/** Runs in the page before any document script — helps soft bot checks only. */
export function patchNavigatorWebdriver(): void {
  Object.defineProperty(navigator, 'webdriver', {
    get: () => undefined,
    configurable: true,
  });
}
