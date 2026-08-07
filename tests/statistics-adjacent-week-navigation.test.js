import test from 'node:test';
import assert from 'node:assert/strict';
import { buildStatisticsViewModel } from '../src/statistics-view.js';

function stateFor(weekStart, entries) {
  return {
    mode: 'weekly',
    weekStart,
    year: 2026,
    month: 8,
    source: 'server',
    warning: '',
    data: {
      entries,
      activeCategories: [],
      archivedCategories: [],
      weeklyBudgets: [],
    },
  };
}

test('바로 이전 주에 기록이 없으면 더 오래된 기록 주로 건너뛰지 않고 이전 주를 비활성화한다', () => {
  const model = buildStatisticsViewModel(stateFor('2026-08-03', [
    { id: 'older', date: '2026-07-20', durationMinutes: 30, categoryId: 'c1' },
    { id: 'current', date: '2026-08-03', durationMinutes: 20, categoryId: 'c1' },
  ]), { now: new Date('2026-08-07T12:00:00') });

  assert.equal(model.previousWeekStart, null);
});

test('바로 이전 주에 실제 기록이 있으면 이전 주를 활성화한다', () => {
  const model = buildStatisticsViewModel(stateFor('2026-08-03', [
    { id: 'previous', date: '2026-07-27', durationMinutes: 30, categoryId: 'c1' },
    { id: 'current', date: '2026-08-03', durationMinutes: 20, categoryId: 'c1' },
  ]), { now: new Date('2026-08-07T12:00:00') });

  assert.equal(model.previousWeekStart, '2026-07-27');
});
