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

test('저장이나 취소로 종료한 뒤 새 타이머 기본값은 countdown이다', async () => {
  const source = await read('src/persistent-timer-ui.js');
  const saveStart = source.indexOf('async function saveActiveTimer');
  const saveEnd = source.indexOf('async function handleAction', saveStart);
  const cancelStart = source.indexOf('async function handleCancel');
  const cancelEnd = source.indexOf('function handleModeChange', cancelStart);
  assert.ok(source.slice(saveStart, saveEnd).includes("state.selectedMode = 'countdown';"));
  assert.ok(source.slice(cancelStart, cancelEnd).includes("state.selectedMode = 'countdown';"));
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
  assert.ok(source.includes('timerMode: timer.mode'));
});

test('실행 중 대분류를 잠그고 멈춘 카운트다운 변경은 자동 저장한다', async () => {
  const source = await read('src/persistent-timer-ui.js');
  assert.ok(source.includes('handleCountdownCategoryChange'));
  assert.ok(source.includes('await saveActiveTimer({ refreshData: false, rerender: false })'));
  assert.match(source, /timer\.mode !== 'countdown' \|\| timer\.running !== false/);
  assert.match(source, /categoryLocked = Boolean\(state\.transitioning \|\| \(timer && \(timer\.mode !== 'countdown' \|\| timer\.running !== false\)\)\)/);
});

test('대분류 자동 저장은 중복 조작을 잠그고 로컬 기록으로 즉시 전환한다', async () => {
  const source = await read('src/persistent-timer-ui.js');
  assert.ok(source.includes('transitioning: false'));
  const start = source.indexOf('async function handleCountdownCategoryChange');
  const end = source.indexOf("document.addEventListener('click'", start);
  const transitionSource = source.slice(start, end);
  assert.ok(transitionSource.includes('if (state.transitioning) return;'));
  assert.ok(transitionSource.includes('state.transitioning = true;'));
  assert.ok(transitionSource.includes('await restoreCachedTimerData()'));
  assert.ok(transitionSource.includes('state.selectedCategoryId = nextCategoryId'));
  assert.ok(transitionSource.includes('refreshTimerData().then'));
  assert.ok(transitionSource.includes('state.transitioning = false;'));
  assert.doesNotMatch(transitionSource, /await refreshTimerData\(\)/);
});

test('방식 변경은 활성 타이머가 없고 전환 중이 아닐 때만 허용한다', async () => {
  const source = await read('src/persistent-timer-ui.js');
  assert.match(source, /function handleModeChange\(button\)[\s\S]*state\.transitioning[\s\S]*state\.controller\?\.active[\s\S]*return/);
});

test('0 도달 알람과 선택창을 만들지 않는다', async () => {
  const source = await read('src/persistent-timer-ui.js');
  assert.doesNotMatch(source, /AudioContext|new Audio|\.vibrate\(|Notification\(|중단하고 저장|계속할지/);
});

test('분할 탭 스타일과 최신 앱 셸을 제공한다', async () => {
  const [css, worker] = await Promise.all([
    read('src/mobile-compact.css'),
    read('service-worker.js'),
  ]);
  assert.ok(css.includes('.timer-mode-tabs'));
  assert.ok(css.includes('grid-template-columns: repeat(2, minmax(0, 1fr))'));
  assert.ok(worker.includes('weekly-time-budget-shell-v16'));
  assert.ok(worker.includes('./src/countdown-timer-domain.js'));
});
