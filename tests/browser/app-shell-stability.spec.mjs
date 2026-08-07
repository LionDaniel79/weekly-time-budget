import { test, expect } from '@playwright/test';

test('동일 화면 shell-state가 와도 사용자가 연 모바일 메뉴를 닫지 않는다', async ({ page }) => {
  await page.goto('/tests/browser/fixtures/app-shell-stability.html');
  await page.click('#mobile-menu');
  await expect(page.locator('.sidebar')).toHaveClass(/open/);
  await expect(page.locator('#mobile-menu')).toHaveAttribute('aria-expanded', 'true');

  await page.evaluate(() => {
    document.dispatchEvent(new CustomEvent('weekly-time-budget:shell-state', {
      detail: { activeView: 'dashboard' },
    }));
  });

  await expect(page.locator('.sidebar')).toHaveClass(/open/);
  await expect(page.locator('#mobile-menu')).toHaveAttribute('aria-expanded', 'true');
});
