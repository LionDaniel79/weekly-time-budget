import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyStatisticsAction,
  createStatisticsState,
  statisticsRenderKey,
} from '../src/statistics-state.js';

const context = {
  currentWeekStart: '2026-07-27',
  currentYear: 2026,
  currentMonth: 8,
  recordedWeekStarts: ['2026-07-06', '2026-07-27'],
  recordedMonths: ['2026-06', '2026-08'],
  recordedYears: [2025, 2026],
};

test('같은 월간 모드를 다시 선택하면 변경이 아니다', () => {
  const state = createStatisticsState({
    now: new Date('2026-08-01T12:00:00'),
    restored: { mode: 'monthly', year: 2026, month: 8 },
  });
  const result = applyStatisticsAction(state, { type: 'select-mode', mode: 'monthly' }, context);
  assert.equal(result.changed, false);
  assert.equal(statisticsRenderKey(result.state), statisticsRenderKey(state));
});

test('기록 없는 7월은 같은 연도의 이전 기록 월인 6월로 보정한다', () => {
  const state = createStatisticsState({ now: new Date('2026-08-01T12:00:00') });
  const result = applyStatisticsAction(state, { type: 'select-month', year: 2026, month: 7 }, context);
  assert.deepEqual({ year: result.state.year, month: result.state.month }, { year: 2026, month: 6 });
});

test('dataVersion 변경은 같은 기간에도 새 렌더 키를 만든다', () => {
  const state = { ...createStatisticsState({ now: new Date('2026-08-01T12:00:00') }), dataVersion: 'cache:1' };
  assert.notEqual(statisticsRenderKey(state), statisticsRenderKey({ ...state, dataVersion: 'server:2' }));
});

test('연간 통계의 기록 연도를 직접 변경한다', () => {
  const state = createStatisticsState({
    now: new Date('2026-08-01T12:00:00'),
    restored: { mode: 'yearly', year: 2026 },
  });
  const result = applyStatisticsAction(state, { type: 'select-year', year: 2025 }, context);
  assert.equal(result.changed, true);
  assert.equal(result.state.year, 2025);
});

test('기록이 없는 과거 연도는 현재 연도로 보정한다', () => {
  const state = createStatisticsState({
    now: new Date('2026-08-01T12:00:00'),
    restored: { mode: 'yearly', year: 2025 },
  });
  const result = applyStatisticsAction(state, { type: 'select-year', year: 2024 }, context);
  assert.equal(result.changed, true);
  assert.equal(result.state.year, 2026);
});
