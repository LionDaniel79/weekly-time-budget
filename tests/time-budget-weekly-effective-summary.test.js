import test from 'node:test';
import assert from 'node:assert/strict';
import * as timeBudgetDomain from '../src/time-budget-domain.js';

test('주간 대시보드는 일간 직접 예산으로 바뀐 값을 주간 합계에 반영한다', () => {
  assert.equal(typeof timeBudgetDomain.summarizeWeeklyEffectiveCategories, 'function');

  const summary = timeBudgetDomain.summarizeWeeklyEffectiveCategories({
    categories: [{ id: 'reading', name: '독서', goalType: 'growth' }],
    entries: [{ id: 'entry-1', categoryId: 'reading', date: '2026-08-07', durationMinutes: 60 }],
    weekStart: '2026-08-03',
    weekDocument: { weekStart: '2026-08-03', budgets: { reading: 420 } },
    dailyDocuments: [{ date: '2026-08-07', overrides: { reading: 120 } }],
  });

  // 기본 주간 420분은 하루 60분씩 배분된다. 금요일만 120분으로 직접 수정했으므로
  // 실제 적용 주간 예산은 420 - 60 + 120 = 480분이어야 한다.
  assert.equal(summary.totalBudgetMinutes, 480);
  assert.equal(summary.totalActualMinutes, 60);
  assert.equal(summary.categorySummaries[0].budgetMinutes, 480);
  assert.equal(summary.categorySummaries[0].percentage, 13);
});

test('주간 대시보드는 일간 직접 예산 0도 유효한 변경으로 합산한다', () => {
  const summarize = timeBudgetDomain.summarizeWeeklyEffectiveCategories;
  assert.equal(typeof summarize, 'function');

  const summary = summarize({
    categories: [{ id: 'reading', name: '독서' }],
    entries: [],
    weekStart: '2026-08-03',
    weekDocument: { weekStart: '2026-08-03', budgets: { reading: 420 } },
    dailyDocuments: [{ date: '2026-08-07', overrides: { reading: 0 } }],
  });

  assert.equal(summary.totalBudgetMinutes, 360);
  assert.equal(summary.categorySummaries[0].budgetMinutes, 360);
});
