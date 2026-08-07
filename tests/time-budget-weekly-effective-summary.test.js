import test from 'node:test';
import assert from 'node:assert/strict';
import * as timeBudgetDomain from '../src/time-budget-domain.js';

test('주간 대시보드는 이번 주 예산을 그대로 사용하고 오늘 직접 예산은 주간 합계를 바꾸지 않는다', () => {
  assert.equal(typeof timeBudgetDomain.summarizeWeeklyEffectiveCategories, 'function');

  const summary = timeBudgetDomain.summarizeWeeklyEffectiveCategories({
    categories: [{ id: 'reading', name: '독서', goalType: 'growth' }],
    entries: [{ id: 'entry-1', categoryId: 'reading', date: '2026-08-07', durationMinutes: 60 }],
    weekStart: '2026-08-03',
    weekDocument: { weekStart: '2026-08-03', budgets: { reading: 420 } },
    dailyDocuments: [{ date: '2026-08-07', overrides: { reading: 120 } }],
  });

  assert.equal(summary.totalBudgetMinutes, 420);
  assert.equal(summary.totalActualMinutes, 60);
  assert.equal(summary.categorySummaries[0].budgetMinutes, 420);
  assert.equal(summary.categorySummaries[0].percentage, 14);
});

test('오늘 직접 예산이 0이어도 주간 대시보드의 이번 주 예산은 유지된다', () => {
  const summarize = timeBudgetDomain.summarizeWeeklyEffectiveCategories;
  assert.equal(typeof summarize, 'function');

  const summary = summarize({
    categories: [{ id: 'reading', name: '독서' }],
    entries: [],
    weekStart: '2026-08-03',
    weekDocument: { weekStart: '2026-08-03', budgets: { reading: 420 } },
    dailyDocuments: [{ date: '2026-08-07', overrides: { reading: 0 } }],
  });

  assert.equal(summary.totalBudgetMinutes, 420);
  assert.equal(summary.categorySummaries[0].budgetMinutes, 420);
});
