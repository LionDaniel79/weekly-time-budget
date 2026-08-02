import { test, expect } from '@playwright/test';
import { installFakeFirebaseRoutes } from './support/fake-firebase-routes.mjs';

const fixture = {
  'users/browser-user/entries': [
    { id: 'e1', date: '2026-07-02', categoryId: 'reading', durationMinutes: 45 },
    { id: 'e2', date: '2026-08-01', categoryId: 'reading', durationMinutes: 30 },
  ],
  'users/browser-user/categories': [
    { id: 'reading', name: '독서', order: 1, defaultBudgetMinutes: 420 },
  ],
  'users/browser-user/archivedCategories': [],
  'users/browser-user/weeklyBudgets': [],
};

test('현재 월간 통계 클릭은 2초 안에 완료되고 반복 전환 후에도 응답한다', async ({ page }) => {
  const errors = [];
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('pageerror', (error) => errors.push(error.message));

  await installFakeFirebaseRoutes(page, fixture);
  await page.goto('/tests/browser/fixtures/statistics-current.html');
  await page.getByRole('button', { name: '통계' }).click();
  await expect(page.getByRole('button', { name: '주별 통계' })).toBeVisible();

  const startedAt = Date.now();
  await page.getByRole('button', { name: '월간 통계' }).click();
  await expect(page.getByRole('button', { name: '월간 통계' })).toHaveClass(/active/);
  await expect(page.locator('#statistics-rescue-month')).toBeVisible();
  expect(Date.now() - startedAt).toBeLessThan(2_000);

  for (let index = 0; index < 20; index += 1) {
    await page.getByRole('button', { name: '주별 통계' }).click();
    await page.getByRole('button', { name: '월간 통계' }).click();
  }

  await expect(page.locator('#statistics-rescue-month')).toBeVisible();
  expect(errors).toEqual([]);
});
