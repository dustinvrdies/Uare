import { test, expect } from '@playwright/test';

const baseUrl = process.env.APP_BASE_URL || 'http://localhost:8787';

test('UARE lab shell loads key SaaS surfaces', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (err) => errors.push(err.message));
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });

  await page.goto(`${baseUrl}/lab`, { waitUntil: 'domcontentloaded' });
  await expect(page.locator('body')).toBeVisible();

  const body = await page.locator('body').innerText();
  expect(body).toMatch(/UARE|Mission|Studio|Explorer|Billing|Export|Subscription/i);

  const fatal = errors.filter((e) => !/favicon|ResizeObserver/i.test(e));
  expect(fatal).toEqual([]);
});
