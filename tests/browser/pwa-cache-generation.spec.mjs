import { test, expect } from '@playwright/test';

test('구형 runtime과 셸 캐시는 최신 앱 파일보다 먼저 반환되지 않는다', async ({ page }) => {
  await page.goto('/tests/browser/fixtures/pwa-current.html');
  await page.evaluate(async () => {
    const registrations = await navigator.serviceWorker.getRegistrations();
    await Promise.all(registrations.map((registration) => registration.unregister()));
    const names = await caches.keys();
    await Promise.all(names.map((name) => caches.delete(name)));

    const runtime = await caches.open('weekly-time-budget-runtime-v1');
    await runtime.put('/src/statistics-bootstrap.js', new Response('/* stale-statistics-v13 */', {
      headers: { 'Content-Type': 'text/javascript' },
    }));
    const oldShell = await caches.open('weekly-time-budget-shell-v16');
    await oldShell.put('/index.html', new Response('<!doctype html><html><body><p id="cached-generation">v16</p></body></html>', {
      headers: { 'Content-Type': 'text/html' },
    }));
  });

  await page.evaluate(async () => {
    const registration = await navigator.serviceWorker.register('/service-worker.js', {
      type: 'module',
      scope: '/',
    });
    await navigator.serviceWorker.ready;
    if (!navigator.serviceWorker.controller) {
      await new Promise((resolve) => {
        navigator.serviceWorker.addEventListener('controllerchange', resolve, { once: true });
      });
    }
    await registration.update();
  });

  const source = await page.evaluate(() => (
    fetch('/src/statistics-bootstrap.js').then((response) => response.text())
  ));
  expect(source).not.toContain('stale-statistics-v13');

  await page.goto('/index.html');
  await expect(page.locator('#cached-generation')).toHaveCount(0);
  await expect(page.locator('h1').first()).toHaveText('주간 시간 예산');
  await expect(page.locator('html')).toHaveAttribute('data-app-build', '2026.08.06-equal-budget-v20');
});
