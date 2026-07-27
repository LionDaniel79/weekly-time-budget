import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createDefaultUiState,
  mergeUiState,
  normalizeUiState,
} from '../src/ui-session-state.js';

const context = {
  today: '2026-07-27',
  currentWeekStart: '2026-07-27',
  validViews: ['dashboard', 'record', 'budget', 'history', 'statistics', 'categories'],
};

test('마지막 메뉴와 내부 탭을 유지하고 미래 기간을 현재로 보정한다', () => {
  const value = normalizeUiState({
    activeView: 'statistics',
    dashboard: {
      mode: 'weekly',
      selectedDate: '2026-08-10',
      selectedWeekStart: '2026-08-10',
      calendarYear: 2026,
      calendarMonth: 8,
    },
    record: { tab: 'manual', manualMode: 'duration' },
    budget: { mode: 'week' },
    statistics: {
      mode: 'monthly-comparison',
      weekStart: '2026-08-10',
      year: 2028,
      month: 12,
    },
  }, context);

  assert.equal(value.activeView, 'statistics');
  assert.equal(value.dashboard.mode, 'weekly');
  assert.equal(value.dashboard.selectedDate, '2026-07-27');
  assert.equal(value.dashboard.selectedWeekStart, '2026-07-27');
  assert.equal(value.dashboard.calendarYear, 2026);
  assert.equal(value.dashboard.calendarMonth, 7);
  assert.deepEqual(value.record, { tab: 'manual', manualMode: 'duration' });
  assert.deepEqual(value.budget, { mode: 'week' });
  assert.equal(value.statistics.mode, 'monthly-comparison');
  assert.equal(value.statistics.weekStart, '2026-07-27');
  assert.equal(value.statistics.year, 2026);
  assert.equal(value.statistics.month, 7);
});

test('지원하지 않는 값은 안전한 기본값으로 돌아간다', () => {
  const defaults = createDefaultUiState(context);
  const value = normalizeUiState({
    activeView: 'missing',
    dashboard: { mode: 'other' },
    record: { tab: 'other', manualMode: 'other' },
    budget: { mode: 'other' },
    statistics: { mode: 'other' },
  }, context);

  assert.equal(value.activeView, 'dashboard');
  assert.deepEqual(value.dashboard, defaults.dashboard);
  assert.deepEqual(value.record, defaults.record);
  assert.deepEqual(value.budget, defaults.budget);
  assert.deepEqual(value.statistics, defaults.statistics);
});

test('부분 화면 상태를 기존 상태에 안전하게 병합한다', () => {
  const current = createDefaultUiState(context);
  const value = mergeUiState(current, {
    activeView: 'record',
    record: { tab: 'manual', manualMode: 'duration' },
  }, context);

  assert.equal(value.activeView, 'record');
  assert.deepEqual(value.record, { tab: 'manual', manualMode: 'duration' });
  assert.deepEqual(value.dashboard, current.dashboard);
});
