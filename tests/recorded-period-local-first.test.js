import test from 'node:test';
import assert from 'node:assert/strict';
import { buildRecordedPeriodIndex } from '../src/recorded-period-domain.js';

test('pending과 failed 양수 기록은 기록 기간 인덱스에 포함한다', () => {
  const result = buildRecordedPeriodIndex([
    { date: '2026-07-06', durationMinutes: 30, syncStatus: 'pending' },
    { date: '2026-07-20', durationMinutes: 45, syncStatus: 'failed' },
  ], '2026-07-27');

  assert.deepEqual(result.weekStarts, ['2026-07-06', '2026-07-20']);
});
