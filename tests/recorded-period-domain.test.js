import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildRecordedPeriodIndex,
  previousRecordedPeriod,
  nextRecordedPeriodOrCurrent,
  coerceRecordedPeriodSelection,
  monthOptionStates,
  recordedYearOptions,
  defaultMonthForYear,
  coerceMonthlySelection,
} from '../src/recorded-period-domain.js';

test('양수 유효 기록만 날짜·주·월·연도 인덱스에 포함한다', () => {
  const result = buildRecordedPeriodIndex([
    { date: '2026-07-06', durationMinutes: 30 },
    { date: '2026-07-20', durationMinutes: 60, syncStatus: 'pending' },
    { date: '2026-07-21', durationMinutes: 0 },
    { date: '2026-07-22', durationMinutes: -10 },
    { date: '2026-07-23', durationMinutes: 15, deleted: true },
    { date: '2026-02-30', durationMinutes: 20 },
    { date: 'bad-date', durationMinutes: 20 },
    { date: '2026-08-01', durationMinutes: 20 },
  ], '2026-07-27');

  assert.deepEqual(result, {
    dates: ['2026-07-06', '2026-07-20'],
    weekStarts: ['2026-07-06', '2026-07-20'],
    months: ['2026-07'],
    years: [2026],
  });
});

test('이전 이동은 가장 가까운 이전 기록 주를 선택한다', () => {
  const weeks = ['2026-07-06', '2026-07-27'];
  assert.equal(previousRecordedPeriod(weeks, '2026-07-27'), '2026-07-06');
});

test('주간 이동은 기록 없는 중간 주를 건너뛰고 마지막에는 이번 주로 간다', () => {
  const weeks = ['2026-07-06', '2026-07-20'];
  assert.equal(previousRecordedPeriod(weeks, '2026-07-27'), '2026-07-20');
  assert.equal(nextRecordedPeriodOrCurrent(weeks, '2026-07-06', '2026-07-27'), '2026-07-20');
  assert.equal(nextRecordedPeriodOrCurrent(weeks, '2026-07-20', '2026-07-27'), '2026-07-27');
  assert.equal(nextRecordedPeriodOrCurrent(weeks, '2026-07-27', '2026-07-27'), null);
});

test('무효한 과거 선택은 이전, 이후, 현재 순으로 보정한다', () => {
  assert.equal(coerceRecordedPeriodSelection({
    selected: '2026-07-13',
    current: '2026-07-27',
    recordedPeriods: ['2026-07-06', '2026-07-20'],
  }), '2026-07-06');

  assert.equal(coerceRecordedPeriodSelection({
    selected: '2026-07-01',
    current: '2026-07-27',
    recordedPeriods: ['2026-07-06'],
  }), '2026-07-06');

  assert.equal(coerceRecordedPeriodSelection({
    selected: '2026-08-03',
    current: '2026-07-27',
    recordedPeriods: ['2026-07-06'],
  }), '2026-07-27');
});

test('월 옵션은 기록 월과 이번 달만 활성화한다', () => {
  const options = monthOptionStates({
    recordedMonths: ['2026-03', '2026-05'],
    year: 2026,
    currentYear: 2026,
    currentMonth: 7,
  });

  assert.equal(options.find((item) => item.month === 3).enabled, true);
  assert.equal(options.find((item) => item.month === 4).enabled, false);
  assert.deepEqual(options.find((item) => item.month === 7), { month: 7, enabled: true, current: true });
  assert.equal(options.find((item) => item.month === 8).enabled, false);
});

test('연도와 월 기본값은 현재 기간과 기록 기간만 사용한다', () => {
  assert.deepEqual(recordedYearOptions([2024, 2026], 2026), [2026, 2024]);
  assert.equal(defaultMonthForYear({
    year: 2026,
    currentYear: 2026,
    currentMonth: 7,
    recordedMonths: ['2026-03'],
  }), 7);
  assert.equal(defaultMonthForYear({
    year: 2024,
    currentYear: 2026,
    currentMonth: 7,
    recordedMonths: ['2024-03', '2024-11'],
  }), 11);
  assert.equal(defaultMonthForYear({
    year: 2025,
    currentYear: 2026,
    currentMonth: 7,
    recordedMonths: ['2024-03'],
  }), null);
});

test('무효한 과거 월은 이전, 이후, 현재 월 순으로 보정한다', () => {
  assert.deepEqual(coerceMonthlySelection({
    year: 2026,
    month: 4,
    currentYear: 2026,
    currentMonth: 7,
    recordedMonths: ['2026-03', '2026-05'],
  }), { year: 2026, month: 3 });

  assert.deepEqual(coerceMonthlySelection({
    year: 2024,
    month: 1,
    currentYear: 2026,
    currentMonth: 7,
    recordedMonths: ['2024-03'],
  }), { year: 2024, month: 3 });

  assert.deepEqual(coerceMonthlySelection({
    year: 2025,
    month: 6,
    currentYear: 2026,
    currentMonth: 7,
    recordedMonths: ['2024-03'],
  }), { year: 2026, month: 7 });
});
