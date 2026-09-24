import { chromium } from '@playwright/test';
import { fileURLToPath } from 'node:url';

const browser = await chromium.launch({ args: ['--no-sandbox'] });
try {
    const page = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 });
    await page.goto(new URL('social-preview.html', import.meta.url).href);
    await page.evaluate(async () => {
        // eslint-disable-next-line no-undef -- This callback runs inside the browser.
        await document.fonts.ready;
        // eslint-disable-next-line no-undef -- This callback runs inside the browser.
        await Promise.all([...document.images].map(image => image.decode()));
    });
    await page.screenshot({
        path: fileURLToPath(new URL('../public/graphics/social-preview-v1.png', import.meta.url)),
        type: 'png',
    });
} finally {
    await browser.close();
}
