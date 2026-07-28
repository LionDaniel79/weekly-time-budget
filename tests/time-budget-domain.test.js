import test from 'node:test';
import assert from 'node:assert/strict';
import * as timeBudgetDomain from '../src/time-budget-domain.js';
import {
  DAY_KEYS,
  normalizeDayWeights,
  distributeWeeklyMinutes,
  parseOptionalHours,
  buildWeeklyBudgetSnapshot,
  resolveDailyBudget,
  resolveCountdownBudgetBaseline,
  recordedDateKeys,
  previousRecordedDate,
  nextRecordedDateOrToday,
  calendarMonthCells,
  summarizeDailyCategories,
} from '../src/time-budget-domain.js';

test('상대 비율을 100%로 환산하고 총분을 보정한다', () => {
  const weights = normalizeDayWeights({ mon: 2, tue: 2, wed: 1, thu: 1, fri: 1, sat: 2, sun: 1 });
  assert.deepEqual(DAY_KEYS.map((key) => Math.round(weights[key] * 100)), [20, 20, 10, 10, 10, 20, 10]);
  const days = distributeWeeklyMinutes(421, weights);
  assert.deepEqual(DAY_KEYS.map((key) => days[key]), [84, 84, 42, 42, 42, 84, 43]);
  assert.equal(Object.values(days).reduce((sum, value) => sum + value, 0), 421);
  const tiny = distributeWeeklyMinutes(1, normalizeDayWeights({ mon: 1, tue: 1, wed: 1, thu: 1, fri: 1, sat: 1, sun: 1 }));
  assert.equal(Object.values(tiny).reduce((sum, value) => sum + value, 0), 1);
});

test('요일 값이 없거나 모두 0이면 균등 배분한다', () => {
  const weights = normalizeDayWeights({});
  assert.equal(Math.round(Object.values(weights).reduce((a, b) => a + b, 0) * 1e6), 1e6);
});

test('빈칸과 0을 구분하고 0.5시간 단위를 검사한다', () => {
  assert.deepEqual(parseOptionalHours(''), { explicit: false, minutes: null });
  assert.deepEqual(parseOptionalHours('0'), { explicit: true, minutes: 0 });
  assert.deepEqual(parseOptionalHours('1.5'), { explicit: true, minutes: 90 });
  assert.throws(() => parseOptionalHours('1.25'), /0.5시간 단위/);
  assert.throws(() => parseOptionalHours('-0.5'), /0 이상/);
});

test('주간 스냅숏은 기본값과 명시적 0을 함께 보존한다', () => {
  const snapshot = buildWeeklyBudgetSnapshot({
    weekStart: '2026-07-20',
    categories: [
      { id: 'reading', defaultBudgetMinutes: 420 },
      { id: 'thesis', defaultBudgetMinutes: 900 },
    ],
    budgetInputs: { reading: '', thesis: '0' },
    dayWeightInputs: { mon: 2, tue: 2, wed: 1, thu: 1, fri: 1, sat: 2, sun: 1 },
  });
  assert.deepEqual(snapshot.budgets, { reading: 420, thesis: 0 });
  assert.deepEqual(snapshot.explicitBudgetIds, ['thesis']);
});

test('오늘 직접 예산은 자동 예산보다 우선하며 0도 유효하다', () => {
  const category = { id: 'reading', defaultBudgetMinutes: 700 };
  const weekDocument = { budgets: { reading: 700 }, dayWeights: normalizeDayWeights({ mon: 2, tue: 2, wed: 1, thu: 1, fri: 1, sat: 2, sun: 1 }) };
  assert.deepEqual(resolveDailyBudget({ category, date: '2026-07-20', weekDocument, dailyDocument: null }), { minutes: 140, source: 'day-weight' });
  assert.deepEqual(resolveDailyBudget({ category, date: '2026-07-20', weekDocument, dailyDocument: { overrides: { reading: 0 } } }), { minutes: 0, source: 'direct' });
});

test('카운트다운 기준값은 직접 일간 예산과 오늘 기록만 사용한다', () => {
  const result = resolveCountdownBudgetBaseline({
    category: { id: 'reading', defaultBudgetMinutes: 300 },
    date: '2026-07-28',
    entries: [
      { categoryId: 'reading', date: '2026-07-28', durationMinutes: 30 },
      { categoryId: 'reading', date: '2026-07-28', durationMinutes: 15 },
      { categoryId: 'reading', date: '2026-07-27', durationMinutes: 90 },
      { categoryId: 'other', date: '2026-07-28', durationMinutes: 60 },
    ],
    weekDocument: { budgets: { reading: 210 } },
    dailyDocument: { overrides: { reading: 120 } },
  });
  assert.equal(result.initialBudgetMinutes, 120);
  assert.equal(result.priorRecordedMinutes, 45);
  assert.equal(result.initialRemainingMs, 75 * 60_000);
  assert.equal(result.budgetSource, 'direct');
});

test('카운트다운 기준값은 주간 배분과 동기화 대기 기록을 반영한다', () => {
  const result = resolveCountdownBudgetBaseline({
    category: { id: 'reading', defaultBudgetMinutes: 70 },
    date: '2026-07-27',
    entries: [{ categoryId: 'reading', date: '2026-07-27', durationMinutes: 25, syncStatus: 'pending' }],
    weekDocument: { budgets: { reading: 140 }, dayWeights: { mon: 1, tue: 0, wed: 0, thu: 0, fri: 0, sat: 0, sun: 0 } },
    dailyDocument: null,
  });
  assert.equal(result.initialBudgetMinutes, 140);
  assert.equal(result.priorRecordedMinutes, 25);
  assert.equal(result.initialRemainingMs, 115 * 60_000);
  assert.equal(result.budgetSource, 'day-weight');
});

test('카운트다운 기준값은 예산 초과를 음수로 보존한다', () => {
  const result = resolveCountdownBudgetBaseline({
    category: { id: 'reading', defaultBudgetMinutes: 120 },
    date: '2026-07-28',
    entries: [{ categoryId: 'reading', date: '2026-07-28', durationMinutes: 145 }],
    weekDocument: null,
    dailyDocument: { overrides: { reading: 120 } },
  });
  assert.equal(result.initialBudgetMinutes, 120);
  assert.equal(result.priorRecordedMinutes, 145);
  assert.equal(result.initialRemainingMs, -25 * 60_000);
});

test('전날과 다음날은 양수 기록 날짜와 오늘 사이에서 이동한다', () => {
  const dates = recordedDateKeys([
    { date: '2026-07-20', durationMinutes: 30 },
    { date: '2026-07-20', durationMinutes: 15 },
    { date: '2026-07-24', durationMinutes: 0 },
    { date: '2026-07-26', durationMinutes: 45 },
    { date: '2026-07-27', durationMinutes: 20 },
  ], '2026-07-26');
  assert.deepEqual(dates, ['2026-07-20', '2026-07-26']);
  assert.equal(previousRecordedDate(dates, '2026-07-26'), '2026-07-20');
  assert.equal(nextRecordedDateOrToday(dates, '2026-07-20', '2026-07-26'), '2026-07-26');
  assert.equal(nextRecordedDateOrToday(dates, '2026-07-26', '2026-07-26'), null);
});

test('달력은 기록이 있는 과거와 오늘 날짜만 활성화한다', () => {
  const cells = calendarMonthCells(2026, 7, ['2026-07-20', '2026-07-24'], '2026-07-26');
  assert.equal(cells.find((cell) => cell.date === '2026-07-20').active, true);
  assert.equal(cells.find((cell) => cell.date === '2026-07-21').disabled, true);
  assert.equal(cells.find((cell) => cell.date === '2026-07-26').disabled, false);
  assert.equal(cells.find((cell) => cell.date === '2026-07-27').disabled, true);
});

test('일간 요약은 직접·자동 예산과 실제 기록을 계산한다', () => {
  const result = summarizeDailyCategories({
    categories: [{ id: 'reading', name: '독서', defaultBudgetMinutes: 700 }],
    entries: [{ categoryId: 'reading', date: '2026-07-20', durationMinutes: 60 }],
    date: '2026-07-20',
    weekDocument: { budgets: { reading: 700 }, dayWeights: { mon: 1, tue: 0, wed: 0, thu: 0, fri: 0, sat: 0, sun: 0 } },
    dailyDocument: { overrides: { reading: 120 } },
  });
  assert.equal(result.totalBudgetMinutes, 120);
  assert.equal(result.totalActualMinutes, 60);
  assert.equal(result.percentage, 50);
  assert.equal(result.goalComplianceScore, 50);
  assert.equal(result.goalComplianceStatus, 'scored');
  assert.equal(result.categorySummaries[0].goalType, 'growth');
  assert.equal(result.categorySummaries[0].budgetSource, 'direct');
  assert.deepEqual(result.categorySummaries[0].progress, { mode: 'growth', fillPercentage: 50 });
});

test('활성·보관 대분류에 없는 고아 예산 참조를 제거한다', () => {
  assert.equal(typeof timeBudgetDomain.removeUnknownCategoryReferences, 'function');
  const cleaned = timeBudgetDomain.removeUnknownCategoryReferences(
    { reading: 420, thesis: 30, deletedVideo: 60 },
    new Set(['reading', 'thesis']),
  );
  assert.deepEqual(cleaned, { reading: 420, thesis: 30 });
});


test('일간 요약은 절제 목표와 전체 목표 준수를 계산한다', () => {
  const result = summarizeDailyCategories({
    categories: [
      { id: 'prayer', name: '기도', defaultBudgetMinutes: 1260 },
      { id: 'reading', name: '독서', defaultBudgetMinutes: 420 },
      { id: 'phone', name: '스마트폰', goalType: 'restraint', defaultBudgetMinutes: 1260 },
    ],
    entries: [
      { categoryId: 'prayer', date: '2026-07-27', durationMinutes: 180 },
      { categoryId: 'reading', date: '2026-07-27', durationMinutes: 60 },
      { categoryId: 'phone', date: '2026-07-27', durationMinutes: 240, goalType: 'restraint' },
    ],
    date: '2026-07-27',
    weekDocument: {
      budgets: { prayer: 1260, reading: 420, phone: 1260 },
      dayWeights: { mon: 1, tue: 0, wed: 0, thu: 0, fri: 0, sat: 0, sun: 0 },
    },
    dailyDocument: {
      overrides: { prayer: 180, reading: 60, phone: 180 },
    },
  });
  const phone = result.categorySummaries.find((item) => item.id === 'phone');
  assert.equal(phone.name, '스마트폰 (절제)');
  assert.equal(phone.percentage, -33);
  assert.equal(phone.contributionScore, 0);
  assert.deepEqual(phone.progress, { mode: 'overage', fillPercentage: 33 });
  assert.equal(result.goalComplianceScore, 57);
  assert.equal(result.totalBudgetMinutes, 420);
  assert.equal(result.totalActualMinutes, 480);
});
