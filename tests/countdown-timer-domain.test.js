import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildCountdownBaseline,
  timerDisplayMilliseconds,
  formatSignedTimerMilliseconds,
} from '../src/countdown-timer-domain.js';

test('예산 120분과 기록 45분은 75분을 남긴다', () => {
  assert.deepEqual(buildCountdownBaseline({ budgetMinutes: 120, recordedMinutes: 45 }), {
    initialBudgetMinutes: 120,
    priorRecordedMinutes: 45,
    initialRemainingMs: 75 * 60_000,
  });
});

test('예산보다 기록이 많으면 시작 전부터 음수다', () => {
  assert.equal(
    buildCountdownBaseline({ budgetMinutes: 120, recordedMinutes: 145 }).initialRemainingMs,
    -25 * 60_000,
  );
});

test('0을 지나 음수로 계속 표시한다', () => {
  const timer = { mode: 'countdown', initialRemainingMs: 2_000 };
  assert.equal(formatSignedTimerMilliseconds(timerDisplayMilliseconds(timer, 1_000), { countdown: true }), '00:00:01');
  assert.equal(formatSignedTimerMilliseconds(timerDisplayMilliseconds(timer, 2_000), { countdown: true }), '00:00:00');
  assert.equal(formatSignedTimerMilliseconds(timerDisplayMilliseconds(timer, 3_000), { countdown: true }), '-00:00:01');
});

test('카운트다운은 0 전후의 일부 초도 한 초로 표시한다', () => {
  assert.equal(formatSignedTimerMilliseconds(999, { countdown: true }), '00:00:01');
  assert.equal(formatSignedTimerMilliseconds(-1, { countdown: true }), '-00:00:01');
  assert.equal(formatSignedTimerMilliseconds(999), '00:00:00');
});

test('countup은 경과 시간을 그대로 표시한다', () => {
  const timer = { mode: 'countup' };
  assert.equal(timerDisplayMilliseconds(timer, 3_000), 3_000);
  assert.equal(formatSignedTimerMilliseconds(3_000), '00:00:03');
});

test('0분 예산과 100시간 이상을 처리한다', () => {
  assert.equal(buildCountdownBaseline({ budgetMinutes: 0, recordedMinutes: 0 }).initialRemainingMs, 0);
  assert.equal(buildCountdownBaseline({ budgetMinutes: 0, recordedMinutes: 25 }).initialRemainingMs, -25 * 60_000);
  assert.equal(formatSignedTimerMilliseconds(101 * 3_600_000), '101:00:00');
  assert.equal(formatSignedTimerMilliseconds(-101 * 3_600_000), '-101:00:00');
});
