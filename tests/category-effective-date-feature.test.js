import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { renderTimeBudgetHtml } from '../src/time-budget-ui.js';

const feature = await readFile(new URL('../src/time-budget-feature.js', import.meta.url), 'utf8');

test('시간 예산 기능은 날짜별 활성 함수를 사용한다', () => {
  assert.match(feature, /filterCategoriesActiveOnDate/);
  assert.match(feature, /isCategoryActiveInRange/);
});

test('주간·일간 대시보드는 날짜별 기간 요약을 사용한다', () => {
  assert.match(feature, /summarizeWeeklyEffectiveCategories/);
  assert.match(feature, /summarizeDailyCategories/);
});

test('현재 주간 스냅숏은 오늘 활성인 대분류만 보충한다', () => {
  const block = feature.match(/async function ensureCurrentWeekSnapshot\([\s\S]*?\n}/)?.[0] || '';
  assert.match(block, /activeCategories\(today\(\)\)/);
});

test('시간 예산 UI는 모델에 전달된 대분류만 렌더링한다', () => {
  const html = renderTimeBudgetHtml({
    mode: 'today', today: '2026-07-29',
    categories: [{ id: 'today', name: '오늘 추가', defaultBudgetMinutes: 60 }],
    weekDocument: null, dailyDocument: null, emptyHtml: '',
  });
  assert.match(html, /오늘 추가/);
  assert.doesNotMatch(html, /생성 전 대분류/);
});
