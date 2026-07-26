import test from 'node:test';
import assert from 'node:assert/strict';
import {
  calculateRecordedMonthAverage,
  detailedRecordedMonthlyBudgetComparison,
  detailedRecordedYearlyBudgetComparison,
  moveWeekStart,
  recordedMonthsForYear,
  recordedWeekKeysForMonth,
  summarizeRecordedMonthlyBudgetPeriod,
  summarizeRecordedYearlyBudgetPeriod,
  summarizeWeeklyBudgetPeriod,
} from '../src/domain.js';

const categories = [{ id: 'reading', name: '독서', defaultBudgetMinutes: 420, order: 1 }];

test('선택 월의 실제 기록을 주 시작일 기준으로 묶는다', () => {
  const entries = [
    { date: '2026-07-01', durationMinutes: 30 },
    { date: '2026-07-05', durationMinutes: 60 },
    { date: '2026-07-06', durationMinutes: 90 },
    { date: '2026-08-01', durationMinutes: 20 },
    { date: '잘못된 날짜', durationMinutes: 20 },
  ];
  assert.deepEqual(recordedWeekKeysForMonth(entries, 2026, 7), [
    '2026-06-29',
    '2026-07-06',
  ]);
});

test('선택 연도의 실제 기록이 존재하는 달만 반환한다', () => {
  const entries = [
    { date: '2026-07-25', durationMinutes: 60 },
    { date: '2026-09-01', durationMinutes: 30 },
    { date: '2026-09-10', durationMinutes: 20 },
    { date: '2025-12-31', durationMinutes: 10 },
  ];
  assert.deepEqual(recordedMonthsForYear(entries, 2026), [7, 9]);
});

test('주 이동은 7일 단위이며 현재 주 이후로 넘어가지 않는다', () => {
  const referenceDate = new Date('2026-07-26T12:00:00+09:00');
  assert.equal(moveWeekStart('2026-07-20', -1, referenceDate), '2026-07-13');
  assert.equal(moveWeekStart('2026-07-13', 1, referenceDate), '2026-07-20');
  assert.equal(moveWeekStart('2026-07-20', 1, referenceDate), '2026-07-20');
});

test('주별 통계는 선택한 주의 전체 예산과 실제 기록을 비교한다', () => {
  const weeklyBudgets = [
    { weekStart: '2026-07-20', budgets: { reading: 600 } },
  ];
  const entries = [
    { categoryId: 'reading', date: '2026-07-25', durationMinutes: 120 },
  ];
  const result = summarizeWeeklyBudgetPeriod(entries, categories, weeklyBudgets, '2026-07-20');
  assert.equal(result.totalBudgetMinutes, 600);
  assert.equal(result.totalActualMinutes, 120);
  assert.equal(result.percentage, 20);
  assert.equal(result.recordDays, 1);
  assert.equal(result.categorySummaries[0].budgetMinutes, 600);
});

test('기록이 없는 주도 주간 전체 예산과 실제 0시간을 반환한다', () => {
  const result = summarizeWeeklyBudgetPeriod([], categories, [], '2026-07-20');
  assert.equal(result.totalBudgetMinutes, 420);
  assert.equal(result.totalActualMinutes, 0);
  assert.equal(result.recordDays, 0);
});

test('월간 예산은 기록이 있는 주의 변동 예산만 합산한다', () => {
  const weeklyBudgets = [
    { weekStart: '2026-07-06', budgets: { reading: 420 } },
    { weekStart: '2026-07-13', budgets: { reading: 700 } },
    { weekStart: '2026-07-27', budgets: { reading: 840 } },
  ];
  const entries = [
    { categoryId: 'reading', date: '2026-07-07', durationMinutes: 60 },
    { categoryId: 'reading', date: '2026-07-30', durationMinutes: 120 },
  ];
  const result = summarizeRecordedMonthlyBudgetPeriod(entries, categories, weeklyBudgets, 2026, 7);
  assert.equal(result.recordWeekCount, 2);
  assert.equal(result.totalBudgetMinutes, 1020);
  assert.equal(result.totalActualMinutes, 180);
  assert.equal(result.categorySummaries[0].budgetMinutes, 1020);
});

test('월 경계 주는 해당 월에 기록이 있을 때만 그 달 날짜 수만큼 배분한다', () => {
  const weeklyBudgets = [
    { weekStart: '2026-07-27', budgets: { reading: 700 } },
  ];
  const julyOnly = [
    { categoryId: 'reading', date: '2026-07-30', durationMinutes: 60 },
  ];
  const augustOnly = [
    { categoryId: 'reading', date: '2026-08-01', durationMinutes: 60 },
  ];
  assert.equal(
    summarizeRecordedMonthlyBudgetPeriod(julyOnly, categories, weeklyBudgets, 2026, 7).totalBudgetMinutes,
    500,
  );
  assert.equal(
    summarizeRecordedMonthlyBudgetPeriod(julyOnly, categories, weeklyBudgets, 2026, 8).totalBudgetMinutes,
    0,
  );
  assert.equal(
    summarizeRecordedMonthlyBudgetPeriod(augustOnly, categories, weeklyBudgets, 2026, 8).totalBudgetMinutes,
    200,
  );
});

test('연간 예산은 기록이 있는 달들의 월간 예산만 합산한다', () => {
  const weeklyBudgets = [
    { weekStart: '2026-07-20', budgets: { reading: 560 } },
    { weekStart: '2026-08-03', budgets: { reading: 700 } },
    { weekStart: '2026-09-07', budgets: { reading: 840 } },
  ];
  const entries = [
    { categoryId: 'reading', date: '2026-07-25', durationMinutes: 120 },
    { categoryId: 'reading', date: '2026-09-10', durationMinutes: 180 },
  ];
  const result = summarizeRecordedYearlyBudgetPeriod(entries, categories, weeklyBudgets, 2026);
  assert.equal(result.recordMonthCount, 2);
  assert.equal(result.totalBudgetMinutes, 1400);
  assert.equal(result.totalActualMinutes, 300);
  assert.equal(result.recordDays, 2);
  assert.equal(calculateRecordedMonthAverage(result.totalActualMinutes, result.recordMonthCount), 150);
});

test('월간 비교는 기록이 있는 달만 반환하고 이전 기록 달과 비교한다', () => {
  const entries = [
    { categoryId: 'reading', durationMinutes: 120, date: '2026-07-02' },
    { categoryId: 'reading', durationMinutes: 180, date: '2026-09-03' },
  ];
  const result = detailedRecordedMonthlyBudgetComparison(entries, categories, [], 2026);
  assert.deepEqual(result.map((item) => item.month), [7, 9]);
  assert.equal(result[0].changeMinutes, null);
  assert.equal(result[1].changeMinutes, 60);
  assert.equal(result[1].changePercentage, 50);
});

test('연도별 비교는 실제 기록이 있는 연도만 반환한다', () => {
  const entries = [
    { categoryId: 'reading', durationMinutes: 120, date: '2025-12-31' },
    { categoryId: 'reading', durationMinutes: 240, date: '2027-01-02' },
  ];
  const weeklyBudgets = [
    { weekStart: '2026-07-20', budgets: { reading: 1000 } },
  ];
  const result = detailedRecordedYearlyBudgetComparison(entries, categories, weeklyBudgets);
  assert.deepEqual(result.map((item) => item.year), [2025, 2027]);
  assert.equal(result[1].changeMinutes, 120);
  assert.equal(result[1].changePercentage, 100);
});
