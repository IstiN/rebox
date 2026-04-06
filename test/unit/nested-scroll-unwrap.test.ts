import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chromium, type Browser } from 'playwright';

import { expandNestedScrollRootsForFullPage } from '../../src/nested-scroll-unwrap.js';

function pngDimensions(buf: Buffer): { width: number; height: number } {
  if (buf.length < 24 || buf[0] !== 0x89) throw new Error('not a PNG');
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

describe('expandNestedScrollRootsForFullPage', () => {
  let browser: Browser;

  beforeAll(async () => {
    browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
  });

  afterAll(async () => {
    await browser.close();
  });

  it('makes fullPage capture include nested overflow content', async () => {
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"/></head>
<body style="margin:0;height:100vh;overflow:hidden">
<div id="outer" style="height:100vh;overflow:auto;width:100%">
<div style="height:4000px;background:#ccc">tall</div>
</div></body></html>`;

    const ctx = await browser.newContext({ viewport: { width: 800, height: 600 } });
    const page = await ctx.newPage();
    await page.setContent(html, { waitUntil: 'domcontentloaded' });

    const strip = await page.screenshot({ type: 'png', fullPage: true });
    expect(pngDimensions(strip).height).toBe(600);

    await expandNestedScrollRootsForFullPage(page);
    const tall = await page.screenshot({ type: 'png', fullPage: true });
    expect(pngDimensions(tall).height).toBeGreaterThanOrEqual(3900);

    await ctx.close();
  });

  it('does not shrink a normal document-height page', async () => {
    const html = `<!DOCTYPE html><html><body style="margin:0">
<div style="height:5000px;width:100%;background:#eee">long</div>
</body></html>`;

    const ctx = await browser.newContext({ viewport: { width: 800, height: 600 } });
    const page = await ctx.newPage();
    await page.setContent(html, { waitUntil: 'domcontentloaded' });

    const before = pngDimensions(await page.screenshot({ type: 'png', fullPage: true }));
    await expandNestedScrollRootsForFullPage(page);
    const after = pngDimensions(await page.screenshot({ type: 'png', fullPage: true }));

    expect(after.height).toBe(before.height);

    await ctx.close();
  });
});
