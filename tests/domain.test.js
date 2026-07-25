import test from 'node:test';
import assert from 'node:assert/strict';
import {
  calculateAchievement,
  getBudgetWeekKey,
  getMonthRange,
  getWeekRange,
  getYearRange,
  isManagedDay,
  minutesBetween,
  monthlyComparison,
  reorderItems,
  summarizeCategories,
  summarizePeriod,
  yearlyComparison,
} from '../src/domain.js';

test('관리 대상 요일은 월요일부터 주일까지다', () => {
  assert.equal(isManagedDay(new Date('2026-07-20T12:00:00+09:00')), true);
  assert.equal(isManagedDay(new Date('2026-07-25T12:00:00+09:00')), true);
  assert.equal(isManagedDay(new Date('2026-07-26T12:00:00+09:00')), true);
});

test('주간 범위는 월요일부터 주일까지 반환한다', () => {
  const range = getWeekRange(new Date('2026-07-23T12:00:00+09:00'));
  assert.equal(range.start, '2026-07-20');
  assert.equal(range.end, '2026-07-26');
  assert.equal(getBudgetWeekKey(new Date('2026-07-26T12:00:00+09:00')), '2026-07-20');
});

test('월간과 연간 범위는 달력 경계를 정확히 반환한다', () => {
  assert.deepEqual(getMonthRange(2026, 2), { start: '2026-02-01', end: '2026-02-28' });
  assert.deepEqual(getMonthRange(2024, 2), { start: '2024-02-01', end: '2024-02-29' });
  assert.deepEqual(getYearRange(2026), { start: '2026-01-01', end: '2026-12-31' });
});

test('달성률과 남은 또는 초과 시간을 계산한다', () => {
  assert.deepEqual(calculateAchievement(900, 720), {
    percentage: 80,
    differenceMinutes: -180,
    status: 'remaining',
  });
  assert.deepEqual(calculateAchievement(480, 510), {
    percentage: 106,
    differenceMinutes: 30,
    status: 'exceeded',
  });
});

test('종료 시각이 자정을 넘으면 다음 날로 계산한다', () => {
  assert.equal(minutesBetween('23:30', '00:30'), 60);
  assert.equal(minutesBetween('09:00', '11:30'), 150);
});

test('대분류별 실제 시간과 달성률에 주일 기록을 포함한다', () => {
  const categories = [
    { id: 'thesis', name: '논문', budgetMinutes: 900 },
    { id: 'sermon', name: '설교', budgetMinutes: 480 },
  ];
  const entries = [
    { categoryId: 'thesis', durationMinutes: 120, date: '2026-07-20' },
    { categoryId: 'thesis', durationMinutes: 180, date: '2026-07-21' },
    { categoryId: 'sermon', durationMinutes: 500, date: '2026-07-25' },
    { categoryId: 'thesis', durationMinutes: 60, date: '2026-07-26' },
  ];

  assert.deepEqual(summarizeCategories(categories, entries, '2026-07-20', '2026-07-26'), [
    {
      id: 'thesis', name: '논문', budgetMinutes: 900, actualMinutes: 360,
      percentage: 40, differenceMinutes: -540, status: 'remaining',
    },
    {
      id: 'sermon', name: '설교', budgetMinutes: 480, actualMinutes: 500,
      percentage: 104, differenceMinutes: 20, status: 'exceeded',
    },
  ]);
});

test('기간 통계는 총시간, 기록일수, 일평균, 대분류 합계를 계산한다', () => {
  const entries = [
    { categoryId: 'thesis', durationMinutes: 120, date: '2026-07-05' },
    { categoryId: 'thesis', durationMinutes: 60, date: '2026-07-05' },
    { categoryId: 'sermon', durationMinutes: 90, date: '2026-07-06' },
    { categoryId: 'sermon', durationMinutes: 30, date: '2026-08-01' },
  ];
  const result = summarizePeriod(entries, new Map([['thesis', '논문'], ['sermon', '설교']]), '2026-07-01', '2026-07-31');
  assert.deepEqual(result, {
    totalMinutes: 270,
    recordDays: 2,
    dailyAverageMinutes: 135,
    categoryTotals: { 논문: 180, 설교: 90 },
  });
});

test('독서 1시간 기록은 해당 월 통계에 반영된다', () => {
  const entries = [
    { categoryId: 'reading', durationMinutes: 60, date: '2026-07-26' },
  ];
  const result = summarizePeriod(entries, new Map([['reading', '독서']]), '2026-07-01', '2026-07-31');
  assert.deepEqual(result, {
    totalMinutes: 60,
    recordDays: 1,
    dailyAverageMinutes: 60,
    categoryTotals: { 독서: 60 },
  });
});

test('대분류 순서는 저장 전에 화면에서만 위아래로 바꿀 수 있다', () => {
  const categories = [
    { id: 'thesis', name: '논문' },
    { id: 'reading', name: '독서' },
    { id: 'exercise', name: '운동' },
  ];
  assert.deepEqual(reorderItems(categories, 'reading', -1).map((item) => item.id), ['reading', 'thesis', 'exercise']);
  assert.deepEqual(reorderItems(categories, 'reading', 1).map((item) => item.id), ['thesis', 'exercise', 'reading']);
  assert.deepEqual(categories.map((item) => item.id), ['thesis', 'reading', 'exercise']);
});

test('월별과 연도별 비교를 집계한다', () => {
  const entries = [
    { durationMinutes: 60, date: '2025-12-31' },
    { durationMinutes: 120, date: '2026-01-01' },
    { durationMinutes: 30, date: '2026-01-31' },
    { durationMinutes: 90, date: '2026-02-01' },
  ];
  const months = monthlyComparison(entries, 2026);
  assert.equal(months[0].totalMinutes, 150);
  assert.equal(months[1].totalMinutes, 90);
  assert.equal(months[11].totalMinutes, 0);
  assert.deepEqual(yearlyComparison(entries), [
    { year: 2025, totalMinutes: 60 },
    { year: 2026, totalMinutes: 240 },
  ]);
});
