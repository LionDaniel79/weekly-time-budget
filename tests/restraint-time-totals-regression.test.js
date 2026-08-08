import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  summarizeDailyCategories,
  summarizeWeeklyEffectiveCategories,
} from '../src/time-budget-domain.js';
import {
  detailedRecordedMonthlyBudgetComparison,
  detailedRecordedYearlyBudgetComparison,
  summarizeRecordedMonthlyBudgetPeriod,
  summarizeRecordedYearlyBudgetPeriod,
  summarizeWeeklyBudgetPeriod,
} from '../src/domain.js';
import { buildStatisticsViewModel } from '../src/statistics-view.js';

const categories = [
  { id: 'growth', name: '사역', goalType: 'growth' },
  { id: 'restraint', name: '영상', goalType: 'restraint' },
];

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('일간 대시보드 시간 합계는 절제 항목을 제외하지만 목표 준수와 개별 항목에는 유지한다', () => {
  const summary = summarizeDailyCategories({
    categories,
    entries: [
      { categoryId: 'growth', date: '2026-08-08', durationMinutes: 120 },
      { categoryId: 'restraint', date: '2026-08-08', durationMinutes: 180 },
    ],
    date: '2026-08-08',
    weekDocument: { budgets: { growth: 420, restraint: 210 } },
    dailyDocument: { overrides: { growth: 120, restraint: 60 } },
  });

  assert.equal(summary.totalBudgetMinutes, 120);
  assert.equal(summary.totalActualMinutes, 120);
  assert.equal(summary.categorySummaries.length, 2);
  assert.equal(summary.categorySummaries.find((item) => item.id === 'restraint')?.actualMinutes, 180);
  assert.equal(summary.goalComplianceScore, 67);
});

test('주간 대시보드 시간 합계와 하루 평균은 절제 항목 시간을 제외한다', () => {
  const summary = summarizeWeeklyEffectiveCategories({
    categories,
    entries: [
      { categoryId: 'growth', date: '2026-08-03', durationMinutes: 120 },
      { categoryId: 'growth', date: '2026-08-04', durationMinutes: 180 },
      { categoryId: 'restraint', date: '2026-08-03', durationMinutes: 240 },
    ],
    weekStart: '2026-08-03',
    weekDocument: { budgets: { growth: 420, restraint: 210 } },
  });

  assert.equal(summary.totalBudgetMinutes, 420);
  assert.equal(summary.totalActualMinutes, 300);
  assert.equal(summary.recordDays, 2);
  assert.equal(summary.dailyAverageMinutes, 150);
  assert.equal(summary.categorySummaries.find((item) => item.id === 'restraint')?.budgetMinutes, 210);
  assert.notEqual(summary.goalComplianceStatus, 'excluded');
});

test('주별·월간·연간 통계의 총합과 평균은 절제 항목 시간을 제외한다', () => {
  const entries = [
    { categoryId: 'growth', date: '2026-08-03', durationMinutes: 120 },
    { categoryId: 'growth', date: '2026-08-04', durationMinutes: 180 },
    { categoryId: 'restraint', date: '2026-08-03', durationMinutes: 240 },
  ];
  const weeklyBudgets = [{ weekStart: '2026-08-03', budgets: { growth: 420, restraint: 210 } }];

  const weekly = summarizeWeeklyBudgetPeriod(entries, categories, weeklyBudgets, '2026-08-03');
  const monthly = summarizeRecordedMonthlyBudgetPeriod(entries, categories, weeklyBudgets, 2026, 8);
  const yearly = summarizeRecordedYearlyBudgetPeriod(entries, categories, weeklyBudgets, 2026);

  for (const summary of [weekly, monthly, yearly]) {
    assert.equal(summary.totalBudgetMinutes, 420);
    assert.equal(summary.totalActualMinutes, 300);
    assert.equal(summary.recordDays, 2);
    assert.equal(summary.dailyAverageMinutes, 150);
    assert.equal(summary.categorySummaries.find((item) => item.id === 'restraint')?.actualMinutes, 240);
    assert.notEqual(summary.goalComplianceStatus, 'excluded');
  }
  assert.equal(yearly.recordMonthCount, 1);
});

test('월간·연간 비교의 실제 기록과 증감은 절제 항목을 제외한 시간으로 계산한다', () => {
  const monthlyEntries = [
    { categoryId: 'growth', date: '2026-07-06', durationMinutes: 100 },
    { categoryId: 'restraint', date: '2026-07-06', durationMinutes: 400 },
    { categoryId: 'growth', date: '2026-08-03', durationMinutes: 150 },
    { categoryId: 'restraint', date: '2026-08-03', durationMinutes: 50 },
  ];
  const monthRows = detailedRecordedMonthlyBudgetComparison(monthlyEntries, categories, [], 2026);
  assert.deepEqual(monthRows.map((row) => row.totalActualMinutes), [100, 150]);
  assert.equal(monthRows[1].changeMinutes, 50);
  assert.equal(monthRows[1].changePercentage, 50);

  const yearlyEntries = [
    { categoryId: 'growth', date: '2025-08-04', durationMinutes: 100 },
    { categoryId: 'restraint', date: '2025-08-04', durationMinutes: 900 },
    { categoryId: 'growth', date: '2026-08-03', durationMinutes: 200 },
    { categoryId: 'restraint', date: '2026-08-03', durationMinutes: 100 },
  ];
  const yearRows = detailedRecordedYearlyBudgetComparison(yearlyEntries, categories, []);
  assert.deepEqual(yearRows.map((row) => row.totalActualMinutes), [100, 200]);
  assert.equal(yearRows[1].changeMinutes, 100);
  assert.equal(yearRows[1].changePercentage, 100);
});

test('절제 항목만 있는 기간에도 목표 준수 점수는 표시한다', () => {
  const model = buildStatisticsViewModel({
    mode: 'weekly',
    weekStart: '2026-08-03',
    year: 2026,
    month: 8,
    source: 'server',
    warning: '',
    data: {
      entries: [{ categoryId: 'restraint', date: '2026-08-03', durationMinutes: 30 }],
      activeCategories: [{ id: 'restraint', name: '영상', goalType: 'restraint' }],
      archivedCategories: [],
      weeklyBudgets: [{ weekStart: '2026-08-03', budgets: { restraint: 60 } }],
    },
  }, { now: new Date('2026-08-08T12:00:00') });

  assert.equal(model.summary.totalBudgetMinutes, 0);
  assert.equal(model.summary.totalActualMinutes, 0);
  assert.equal(model.summary.goalComplianceScore, 100);
  assert.equal(model.summary.achievementText, '100점');
});

test('기존 지표 이름은 유지하고 절제 제외 안내를 대시보드와 통계에 표시한다', async () => {
  const [dashboardUi, statisticsView] = await Promise.all([
    read('src/time-budget-ui.js'),
    read('src/statistics-view.js'),
  ]);
  const note = '시간 합계와 평균은 절제 목표를 제외하여 계산합니다.';

  assert.match(dashboardUi, /적용 예산/);
  assert.match(dashboardUi, /주간 예산/);
  assert.match(dashboardUi, /실제 기록/);
  assert.match(statisticsView, /기간 예산/);
  assert.match(statisticsView, /실제 기록/);
  assert.match(statisticsView, /기록한 날 기준 하루 평균/);
  assert.match(dashboardUi, new RegExp(note));
  assert.match(statisticsView, new RegExp(note));
});
