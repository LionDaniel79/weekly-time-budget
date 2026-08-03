import test from 'node:test';
import assert from 'node:assert/strict';
import { buildRecordedPeriodIndex } from '../src/recorded-period-domain.js';

test('삭제 표시가 있는 기록은 기록 기간 인덱스에서 제외한다', () => {
  const result = buildRecordedPeriodIndex([
    { date: '2026-07-06', durationMinutes: 30, deleted: true },
    { date: '2026-07-13', durationMinutes: 30, isDeleted: true },
    { date: '2026-07-20', durationMinutes: 30, syncStatus: 'deleted' },
  ], '2026-07-27');

  assert.deepEqual(result, {
    dates: [],
    weekStarts: [],
    months: [],
    years: [],
  });
});
