import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createTimeBudgetUiState,
  createDashboardUiState,
  renderTimeBudgetHtml,
  renderDashboardHtml,
} from '../src/time-budget-ui.js';

const model = {
  mode: 'today',
  today: '2026-07-26',
  categories: [{ id: 'reading', name: '독서', defaultBudgetMinutes: 420 }],
  weekDocument: { budgets: { reading: 420 }, explicitBudgetIds: [], dayWeights: { mon: .2, tue: .2, wed: .1, thu: .1, fri: .1, sat: .2, sun: .1 } },
  dailyDocument: { overrides: { reading: 0 } },
};

test('시간 예산은 오늘/이번 주 탭과 저장 문구를 제공한다', () => {
  assert.deepEqual(createTimeBudgetUiState('2026-07-26'), { mode: 'today', today: '2026-07-26' });
  const html = renderTimeBudgetHtml(model);
  assert.match(html, /data-budget-mode="today"/);
  assert.match(html, /data-budget-mode="week"/);
  assert.match(html, /name="reading"[^>]*value="0"/);
  assert.match(html, />저장<\/button>/);
  assert.doesNotMatch(html, /이번 주 예산과 비율 저장/);
});

test('이번 주 화면은 7개 공통 비율과 환산값을 표시한다', () => {
  const html = renderTimeBudgetHtml({ ...model, mode: 'week' });
  for (const key of ['mon','tue','wed','thu','fri','sat','sun']) assert.match(html, new RegExp(`name="day-weight-${key}"`));
  assert.match(html, /요일별 공통 배분 비율/);
  assert.match(html, /환산:/);
});

test('대시보드 기본은 일간 오늘이다', () => {
  assert.deepEqual(createDashboardUiState('2026-07-26', '2026-07-20'), {
    mode: 'daily', selectedDate: '2026-07-26', selectedWeekStart: '2026-07-20', calendarYear: 2026, calendarMonth: 7,
  });
});

test('일간 달력은 기록 날짜만 활성화하고 미래를 막는다', () => {
  const html = renderDashboardHtml({
    mode: 'daily', selectedDate: '2026-07-24', today: '2026-07-26', previousDate: '2026-07-20',
    calendarYear: 2026, calendarMonth: 7, recordDates: ['2026-07-20','2026-07-24','2026-07-27'],
    dailySummary: { totalBudgetMinutes: 120, totalActualMinutes: 90, percentage: 75, categorySummaries: [] },
  });
  assert.match(html, />전날</);
  assert.match(html, />다음날</);
  assert.match(html, /data-dashboard-date="2026-07-20"/);
  assert.match(html, /data-dashboard-date="2026-07-27" disabled/);
  assert.match(html, /75%/);
});

test('예산 0시간에 실제 기록이 있으면 예산 미설정으로 표시한다', () => {
  const html = renderDashboardHtml({
    mode: 'daily', selectedDate: '2026-07-26', today: '2026-07-26', previousDate: null,
    calendarYear: 2026, calendarMonth: 7, recordDates: ['2026-07-26'],
    dailySummary: {
      totalBudgetMinutes: 0,
      totalActualMinutes: 60,
      percentage: null,
      categorySummaries: [{
        id: 'reading', name: '독서', budgetMinutes: 0, actualMinutes: 60,
        percentage: null, status: 'unbudgeted', budgetSource: 'direct',
      }],
    },
  });
  assert.match(html, /예산 미설정/);
});

test('이번 주에서는 다음 주 버튼이 비활성화된다', () => {
  const html = renderDashboardHtml({
    mode: 'weekly', selectedWeekStart: '2026-07-20', currentWeekStart: '2026-07-20', weekRangeLabel: '7월 20일–7월 26일',
    weeklySummary: { totalBudgetMinutes: 420, totalActualMinutes: 210, percentage: 50, categorySummaries: [] },
  });
  assert.match(html, /data-week-direction="next" disabled/);
});
