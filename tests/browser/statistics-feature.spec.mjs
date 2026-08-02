import { test, expect } from '@playwright/test';

async function harness(page) {
  await page.goto('/tests/browser/fixtures/statistics-feature.html');
  await page.evaluate(() => globalThis.__statisticsHarness.ready);
}

async function snapshot(page) {
  return page.evaluate(() => ({
    counts: { ...globalThis.__statisticsHarness.counts },
    diagnostics: { ...globalThis.__statisticsHarness.diagnostics },
  }));
}

test('월간 탭은 네트워크 재조회 없이 한 번 렌더한다', async ({ page }) => {
  await harness(page);
  const before = await snapshot(page);
  await page.locator('[data-statistics-mode="monthly"]').click();
  await expect(page.locator('#statistics-month')).toBeVisible();
  const after = await snapshot(page);
  expect(after.counts.cacheReads).toBe(before.counts.cacheReads);
  expect(after.counts.serverReads).toBe(before.counts.serverReads);
  expect(after.diagnostics.renderRuns).toBe(before.diagnostics.renderRuns + 1);
});

test('같은 월간 탭을 다시 클릭하면 렌더와 저장을 생략한다', async ({ page }) => {
  await harness(page);
  await page.locator('[data-statistics-mode="monthly"]').click();
  const before = await snapshot(page);
  await page.locator('[data-statistics-mode="monthly"]').click();
  const after = await snapshot(page);
  expect(after.diagnostics.renderRuns).toBe(before.diagnostics.renderRuns);
  expect(after.counts.saves).toBe(before.counts.saves);
});

test('cache와 server의 다른 dataVersion은 초기 렌더를 두 번만 만든다', async ({ page }) => {
  await harness(page);
  const value = await snapshot(page);
  expect(value.diagnostics.renderRuns).toBe(2);
  expect(value.counts.cacheReads).toBe(1);
  expect(value.counts.serverReads).toBe(1);
});
