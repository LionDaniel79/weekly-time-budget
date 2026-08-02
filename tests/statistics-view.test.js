import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildStatisticsViewModel,
  renderStatisticsFailure,
  renderStatisticsHtml,
} from '../src/statistics-view.js';

const monthlyState = {
  mode: 'monthly', weekStart: '2026-07-27', year: 2026, month: 8,
  dataVersion: 'cache:1', source: 'cache', warning: '',
  data: {
    entries: [{ date: '2026-06-10', categoryId: 'reading', durationMinutes: 30 }],
    activeCategories: [{ id: 'reading', name: '독서', defaultBudgetMinutes: 420 }],
    archivedCategories: [], weeklyBudgets: [],
  },
};

test('기록 월과 이번 달만 활성화한다', () => {
  const model = buildStatisticsViewModel(monthlyState, { now: new Date('2026-08-01T12:00:00') });
  assert.equal(model.monthOptions.find((item) => item.month === 6).disabled, false);
  assert.equal(model.monthOptions.find((item) => item.month === 7).disabled, true);
  assert.equal(model.monthOptions.find((item) => item.month === 8).disabled, false);
  assert.equal(model.monthOptions.find((item) => item.month === 9).disabled, true);
});

test('0분 예산과 0분 기록은 처음부터 목표 준수 —로 렌더한다', () => {
  const state = {
    ...monthlyState,
    data: { entries: [], activeCategories: [], archivedCategories: [], weeklyBudgets: [] },
  };
  const html = renderStatisticsHtml(buildStatisticsViewModel(state, { now: new Date('2026-08-01T12:00:00') }));
  assert.match(html, /<p class="muted">목표 준수<\/p><div class="metric">—<\/div>/);
});

test('오류 HTML은 실패 단계와 다시 시도를 포함한다', () => {
  const html = renderStatisticsFailure({ mode: 'monthly', stage: '월간 집계', message: 'invalid date' });
  assert.match(html, /월간 통계를 표시하지 못했습니다/);
  assert.match(html, /월간 집계/);
  assert.match(html, /data-statistics-retry/);
});
