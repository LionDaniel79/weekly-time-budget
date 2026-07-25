import test from 'node:test';
import assert from 'node:assert/strict';
import {
  calculateAchievement,
  getBudgetWeekKey,
  getWeekRange,
  isManagedDay,
  minutesBetween,
  summarizeCategories,
} from '../src/domain.js';

test('관리 대상 요일은 월요일부터 토요일까지다', () => {
  assert.equal(isManagedDay(new Date('2026-07-20T12:00:00+09:00')), true);
  assert.equal(isManagedDay(new Date('2026-07-25T12:00:00+09:00')), true);
  assert.equal(isManagedDay(new Date('2026-07-26T12:00:00+09:00')), false);
});

test('주간 범위는 월요일부터 토요일까지 반환한다', () => {
  const range = getWeekRange(new Date('2026-07-23T12:00:00+09:00'));
  assert.equal(range.start, '2026-07-20');
  assert.equal(range.end, '2026-07-25');
  assert.equal(getBudgetWeekKey(new Date('2026-07-23T12:00:00+09:00')), '2026-07-20');
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

test('대분류별 실제 시간과 달성률을 요약한다', () => {
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

  assert.deepEqual(summarizeCategories(categories, entries, '2026-07-20', '2026-07-25'), [
    {
      id: 'thesis', name: '논문', budgetMinutes: 900, actualMinutes: 300,
      percentage: 33, differenceMinutes: -600, status: 'remaining',
    },
    {
      id: 'sermon', name: '설교', budgetMinutes: 480, actualMinutes: 500,
      percentage: 104, differenceMinutes: 20, status: 'exceeded',
    },
  ]);
});
