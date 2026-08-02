import { test, expect } from '@playwright/test';

async function harness(page, fixture = 'restraint') {
  const errors = [];
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(`/tests/browser/fixtures/statistics-feature.html?fixture=${fixture}`);
  await page.evaluate(() => globalThis.__statisticsHarness.ready);
  return errors;
}

async function snapshot(page) {
  return page.evaluate(() => ({
    counts: { ...globalThis.__statisticsHarness.counts },
    diagnostics: { ...globalThis.__statisticsHarness.diagnostics },
  }));
}

test('월간 탭은 네트워크 재조회 없이 한 번 렌더한다', async ({ page }) => {
  await harness(page);
  await page.locator('button[data-statistics-mode="weekly"]').click();
  const before = await snapshot(page);
  await page.locator('button[data-statistics-mode="monthly"]').click();
  await expect(page.locator('#statistics-month')).toBeVisible();
  const after = await snapshot(page);
  expect(after.counts.cacheReads).toBe(before.counts.cacheReads);
  expect(after.counts.serverReads).toBe(before.counts.serverReads);
  expect(after.diagnostics.renderRuns).toBe(before.diagnostics.renderRuns + 1);
});

test('같은 월간 탭을 다시 클릭하면 렌더와 저장을 생략한다', async ({ page }) => {
  await harness(page);
  const before = await snapshot(page);
  await page.locator('button[data-statistics-mode="monthly"]').click();
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

test('빈 계정의 월간 통계는 2초 안에 —를 표시한다', async ({ page }) => {
  const started = Date.now();
  await harness(page, 'empty');
  await expect(page.locator('.statistics-summary .metric').nth(2)).toHaveText('—');
  expect(Date.now() - started).toBeLessThan(2_000);
});

test('createdDate가 없는 기존 대분류는 과거 월간 통계에 나타난다', async ({ page }) => {
  await harness(page, 'legacy');
  await expect(page.getByText('기존 대분류', { exact: true })).toBeVisible();
  await expect(page.locator('#statistics-year')).toHaveValue('2025');
  await expect(page.locator('#statistics-month')).toHaveValue('6');
});

test('새 대분류는 생성일 이전 월간 통계에서 제외된다', async ({ page }) => {
  await harness(page, 'effective');
  await expect(page.locator('#statistics-month')).toHaveValue('7');
  await expect(page.getByText('기존 대분류', { exact: true })).toBeVisible();
  await expect(page.getByText('새 대분류', { exact: true })).toHaveCount(0);
});

test('절제 음수 달성률과 보관 대분류를 함께 표시한다', async ({ page }) => {
  await harness(page, 'restraint');
  await expect(page.getByText('스마트폰 (절제)', { exact: true })).toBeVisible();
  await expect(page.getByText('-33%', { exact: true })).toBeVisible();
  await expect(page.getByText('보관 운동', { exact: true })).toBeVisible();
});

test('유효하지 않은 저장 월은 이전 기록 월로 보정하고 미래·무기록 월을 비활성화한다', async ({ page }) => {
  await harness(page, 'invalid');
  await expect(page.locator('#statistics-month')).toHaveValue('6');
  await expect(page.locator('#statistics-month option[value="7"]')).toHaveAttribute('disabled', '');
  await expect(page.locator('#statistics-month option[value="9"]')).toHaveAttribute('disabled', '');
});

test('주간과 월간을 20회 전환해도 모든 통계 모드와 화면이 응답한다', async ({ page }) => {
  const errors = await harness(page, 'restraint');
  for (let index = 0; index < 20; index += 1) {
    await page.locator('button[data-statistics-mode="weekly"]').click();
    await page.locator('button[data-statistics-mode="monthly"]').click();
  }
  for (const label of ['주별 통계', '월간 통계', '연간 통계', '월간 비교', '연도별 비교']) {
    await expect(page.getByRole('button', { name: label })).toBeVisible();
  }
  expect(errors).toEqual([]);
});

test('3만 건 이상 자료의 월간 통계는 2초 안에 표시하고 집계는 1초 안에 끝난다', async ({ page }) => {
  const started = Date.now();
  await harness(page, 'large');
  await expect(page.locator('#statistics-month')).toBeVisible();
  expect(Date.now() - started).toBeLessThan(2_000);
  const value = await snapshot(page);
  expect(value.diagnostics.maxAggregateMs).toBeLessThan(1_000);
});
