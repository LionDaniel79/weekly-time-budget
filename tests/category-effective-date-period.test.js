import test from 'node:test';
import assert from 'node:assert/strict';
import {
  summarizeBudgetPeriod,
  summarizeWeeklyBudgetPeriod,
} from '../src/domain.js';

test('목요일 생성 대분류의 동일 배분 주간 예산은 4일분만 반영한다', () => {
  const summary = summarizeWeeklyBudgetPeriod(
    [],
    [{ id: 'phone', name: '스마트폰', createdDate: '2026-07-30', defaultBudgetMinutes: 420 }],
    [{
      id: '2026-07-27', weekStart: '2026-07-27', budgets: { phone: 420 },
      dayWeights: { mon: 1, tue: 1, wed: 1, thu: 1, fri: 1, sat: 1, sun: 1 },
    }],
    '2026-07-27',
  );
  assert.equal(summary.totalBudgetMinutes, 240);
});

test('주중 생성 시 생성 이후 요일의 기존 배분만 반영한다', () => {
  const summary = summarizeWeeklyBudgetPeriod(
    [],
    [{ id: 'phone', name: '스마트폰', createdDate: '2026-07-30', defaultBudgetMinutes: 700 }],
    [{
      id: '2026-07-27', weekStart: '2026-07-27', budgets: { phone: 700 },
      dayWeights: { mon: 4, tue: 1, wed: 1, thu: 1, fri: 0, sat: 0, sun: 0 },
    }],
    '2026-07-27',
  );
  assert.equal(summary.totalBudgetMinutes, 100);
});

test('생성 전 기간에는 행이 없고 생성 월은 활성 날짜 예산만 반영한다', () => {
  const category = { id: 'phone', name: '스마트폰', createdDate: '2026-07-29', defaultBudgetMinutes: 420 };
  const before = summarizeBudgetPeriod([], [category], [], '2026-07-01', '2026-07-28');
  const month = summarizeBudgetPeriod([], [category], [], '2026-07-01', '2026-07-31');
  assert.deepEqual(before.categorySummaries, []);
  assert.equal(month.totalBudgetMinutes, 180);
});

test('생성일 이전 비정상 기록은 기간 실제 합계에서 제외한다', () => {
  const summary = summarizeBudgetPeriod(
    [
      { categoryId: 'phone', date: '2026-07-28', durationMinutes: 300 },
      { categoryId: 'phone', date: '2026-07-29', durationMinutes: 60 },
    ],
    [{ id: 'phone', name: '스마트폰', createdDate: '2026-07-29', defaultBudgetMinutes: 420 }],
    [], '2026-07-01', '2026-07-31',
  );
  assert.equal(summary.totalActualMinutes, 60);
});
