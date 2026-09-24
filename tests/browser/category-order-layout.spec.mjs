import { test, expect } from '@playwright/test';

async function openCategoryFixture(page, width) {
  await page.setViewportSize({ width, height: 900 });
  await page.goto('/tests/browser/fixtures/category-order-layout.html');
  await page.evaluate(() => globalThis.__categoryHarness?.ready);
}

async function expectRowsInsideCard(page) {
  const card = page.locator('#categories-view .card').filter({ hasText: '등록된 대분류' });
  const cardBox = await card.boundingBox();
  expect(cardBox).not.toBeNull();

  const rows = page.locator('.category-edit-row');
  await expect(rows).toHaveCount(11);

  for (let index = 0; index < 11; index += 1) {
    const row = rows.nth(index);
    const rowBox = await row.boundingBox();
    const inputBox = await row.locator('input[name="name"]').boundingBox();
    const actionsBox = await row.locator('.category-row-actions').boundingBox();
    expect(rowBox).not.toBeNull();
    expect(inputBox).not.toBeNull();
    expect(actionsBox).not.toBeNull();

    expect(actionsBox.x + actionsBox.width).toBeLessThanOrEqual(cardBox.x + cardBox.width - 1);
    expect(inputBox.x + inputBox.width).toBeLessThanOrEqual(actionsBox.x);
  }
}

test('대분류 관리 버튼은 iPad 가로 폭에서도 카드 밖으로 넘치지 않는다', async ({ page }) => {
  await openCategoryFixture(page, 1366);
  await expectRowsInsideCard(page);

  await expect(page.locator('.category-up').first()).toBeDisabled();
  await expect(page.locator('.category-down').last()).toBeDisabled();
  await expect(page.locator('.category-up')).toHaveCount(11);
  await expect(page.locator('.category-down')).toHaveCount(11);

  await page.locator('.category-up').nth(1).click();
  expect(await page.evaluate(() => globalThis.__categoryHarness.moves)).toEqual([
    { id: 'bible', direction: -1 },
  ]);
});

test('사이드바가 남아 있는 좁은 데스크톱 폭에서도 행 동작 버튼이 카드 안에 배치된다', async ({ page }) => {
  await openCategoryFixture(page, 900);
  await expectRowsInsideCard(page);
});
