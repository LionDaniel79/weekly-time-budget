import test from 'node:test';
import assert from 'node:assert/strict';
import { nextRecordedPeriodOrCurrent } from '../src/recorded-period-domain.js';

test('현재 주에서는 다음 이동을 제공하지 않는다', () => {
  assert.equal(nextRecordedPeriodOrCurrent(
    ['2026-07-06', '2026-07-20'],
    '2026-07-27',
    '2026-07-27',
  ), null);
});
