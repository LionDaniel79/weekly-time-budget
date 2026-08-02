import { test, expect } from '@playwright/test';

test('구형 runtime 캐시가 최신 통계 셸 파일보다 먼저 반환되지 않는다', async ({ page }) => {
  await page.goto('/tests/browser/fixtures/pwa-current.html');
  await page.evaluate(async () => {
    const registrations = await navigator.serviceWorker.getRegistrations();
    await Promise.all(registrations.map((registration) => registration.unregister()));
    const names = await caches.keys();
    await Promise.all(names.map((name) => caches.delete(name)));
    const runtime = await caches.open('weekly-time-budget-runtime-v1');
    await runtime.put('/src/statistics-offline-rescue.js', new Response('/* stale-statistics-v13 */', {
      headers: { 'Content-Type': 'text/javascript' },
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
    fetch('/src/statistics-offline-rescue.js').then((response) => response.text())
  ));
  expect(source).not.toContain('stale-statistics-v13');
});
