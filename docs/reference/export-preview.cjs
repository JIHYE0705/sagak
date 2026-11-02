// Design reference exporter only; not the application runtime.
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1100, height: 800 }, deviceScaleFactor: 2 });
    await page.goto(pathToFileURL(path.resolve('docs/reference/notebook-preview.html')).href);
    const frame = page.frameLocator('iframe');
    const root = frame.locator('#paper-daily');
    await root.waitFor();
    const fontStatus = await root.evaluate(async root => {
      await document.fonts.load('18px PencilDaheng');
      await document.fonts.ready;
      return document.fonts.check('18px PencilDaheng');
    });
    if (!fontStatus) throw new Error('Daheng font did not load');
    const book = frame.locator('.book');
    const box = await book.boundingBox();
    if (!box || Math.abs(box.width / box.height - 2) > 0.01) throw new Error('Notebook must be 2:1');
    fs.mkdirSync('docs/images', { recursive: true });
    await book.screenshot({ path: 'docs/images/notebook-daheng.png' });
    await root.screenshot({ path: 'docs/images/notebook-settings.png' });
    console.log('Saved both reference images with Daheng loaded and 2:1 notebook.');
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
