import test from 'node:test';
import assert from 'node:assert/strict';
import {
  resolveDailyBudget,
  resolveCountdownBudgetBaseline,
  summarizeDailyCategories,
} from '../src/time-budget-domain.js';

test('생성일 이전 일간 예산과 카운트다운 기준을 만들지 않는다', () => {
  const category = { id: 'phone', createdDate: '2026-07-29', defaultBudgetMinutes: 420 };
  assert.deepEqual(resolveDailyBudget({
    category, date: '2026-07-28', weekDocument: null, dailyDocument: null,
  }), { minutes: 0, source: 'inactive' });
  assert.equal(resolveCountdownBudgetBaseline({
    category, date: '2026-07-28', entries: [], weekDocument: null, dailyDocument: null,
  }), null);
});

test('일간 요약은 생성일 이전 대분류와 비정상 기록을 제외한다', () => {
  const summary = summarizeDailyCategories({
    categories: [
      { id: 'legacy', name: '기도', defaultBudgetMinutes: 420 },
      { id: 'phone', name: '스마트폰', createdDate: '2026-07-29', defaultBudgetMinutes: 420 },
    ],
    entries: [
      { categoryId: 'legacy', date: '2026-07-28', durationMinutes: 60 },
      { categoryId: 'phone', date: '2026-07-28', durationMinutes: 300 },
    ],
    date: '2026-07-28', weekDocument: null, dailyDocument: null,
  });
  assert.deepEqual(summary.categorySummaries.map((item) => item.id), ['legacy']);
  assert.equal(summary.totalActualMinutes, 60);
});
