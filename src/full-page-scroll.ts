import type { Page } from 'playwright';

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function readScrollHeight(p: Page): Promise<number> {
  return p.evaluate(() =>
    Math.max(
      document.documentElement.scrollHeight,
      document.body?.scrollHeight ?? 0,
    ),
  );
}

async function readMetrics(p: Page): Promise<{ scrollY: number; innerHeight: number; scrollHeight: number }> {
  return p.evaluate(() => ({
    scrollY: window.scrollY,
    innerHeight: window.innerHeight,
    scrollHeight: Math.max(
      document.documentElement.scrollHeight,
      document.body?.scrollHeight ?? 0,
    ),
  }));
}

/**
 * Scrolls down in steps so lazy-hydrated regions (images, comment threads) expand,
 * then scrolls back to the top before a full-page screenshot.
 */
export async function scrollPageForLazyContent(p: Page, maxDurationMs: number): Promise<void> {
  if (maxDurationMs <= 0) return;
  const deadline = Date.now() + maxDurationMs;

  while (Date.now() < deadline) {
    const { scrollY, innerHeight, scrollHeight } = await readMetrics(p);
    const nearBottom = scrollY + innerHeight >= scrollHeight - 6;

    if (!nearBottom) {
      const step = Math.max(240, Math.floor(innerHeight * 0.88));
      await p.evaluate((dy) => window.scrollBy(0, dy), step);
      await sleep(95);
      continue;
    }

    await sleep(320);
    const afterWait = await readScrollHeight(p);
    if (afterWait <= scrollHeight + 4) break;
    await p.evaluate((dy) => window.scrollBy(0, dy), Math.max(200, Math.floor(innerHeight * 0.45)));
  }

  await p.evaluate(() => window.scrollTo(0, 0));
  await sleep(220);
}
