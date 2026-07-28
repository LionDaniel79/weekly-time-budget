import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('타이머 방식 탭은 카운트 다운, 카운트 업 순서다', async () => {
  const source = await read('src/persistent-timer-ui.js');
  const countdown = source.indexOf('data-timer-mode="countdown"');
  const countup = source.indexOf('data-timer-mode="countup"');
  assert.ok(countdown >= 0 && countup > countdown);
  assert.ok(source.includes('카운트 다운'));
  assert.ok(source.includes('카운트 업'));
});

test('새 화면 기본값은 countdown이고 시작할 때 mode를 명시한다', async () => {
  const source = await read('src/persistent-timer-ui.js');
  assert.ok(source.includes("selectedMode: 'countdown'"));
  assert.ok(source.includes('mode: state.selectedMode'));
});

test('카운트다운은 오늘 예산과 기록 기준값을 불러온다', async () => {
  const source = await read('src/persistent-timer-ui.js');
  assert.ok(source.includes('resolveCountdownBudgetBaseline'));
  assert.ok(source.includes('refreshTimerData'));
  assert.ok(source.includes('weeklyBudgets'));
  assert.ok(source.includes('dailyBudgets'));
  assert.ok(source.includes('defaultDayWeights'));
});

test('카운트다운은 저장, 카운트업은 종료하고 저장 문구를 사용한다', async () => {
  const source = await read('src/persistent-timer-ui.js');
  assert.ok(source.includes("timer?.mode === 'countdown' ? '저장' : '종료하고 저장'"));
});

test('0 도달 알람과 선택창을 만들지 않는다', async () => {
  const source = await read('src/persistent-timer-ui.js');
  assert.doesNotMatch(source, /AudioContext|new Audio|\.vibrate\(|Notification\(|중단하고 저장|계속할지/);
});
