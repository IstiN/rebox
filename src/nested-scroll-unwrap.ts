import type { Page } from 'playwright';

/**
 * Playwright full-page screenshots use the document scroll range. Some sites keep
 * `html`/`body` fixed to the viewport and scroll inside a nested `overflow: auto`
 * container; then `fullPage` only captures one viewport tall (wide "strip").
 *
 * When the scrolling element is not taller than the viewport, try to flatten the
 * dominant nested scroll container so layout height matches visible content.
 */
export async function expandNestedScrollRootsForFullPage(page: Page): Promise<void> {
  const shouldTry = await page.evaluate(() => {
    const se = document.scrollingElement ?? document.documentElement;
    return se.scrollHeight <= window.innerHeight + 80;
  });
  if (!shouldTry) return;

  await page.evaluate(() => {
    const innerH = window.innerHeight;

    function findDominantScrollRoot(): HTMLElement | null {
      let best: HTMLElement | null = null;
      let bestSh = 0;
      const visit = (el: Element) => {
        if (!(el instanceof HTMLElement)) return;
        const st = getComputedStyle(el);
        const oy = st.overflowY;
        const scrollable = oy === 'auto' || oy === 'scroll' || oy === 'overlay';
        const sh = el.scrollHeight;
        const ch = el.clientHeight;
        if (scrollable && sh > ch + 50 && sh > innerH && sh > bestSh) {
          best = el;
          bestSh = sh;
        }
        for (const c of Array.from(el.children)) visit(c);
      };
      if (document.body) visit(document.body);
      return best;
    }

    const target = findDominantScrollRoot();
    if (!target) return;

    let n: HTMLElement | null = target;
    while (n) {
      n.style.overflow = 'visible';
      n.style.maxHeight = 'none';
      if (n === document.body || n === document.documentElement) {
        n.style.height = 'auto';
      }
      n = n.parentElement;
    }
    target.style.height = `${target.scrollHeight}px`;
    target.style.overflow = 'visible';
  });
}
