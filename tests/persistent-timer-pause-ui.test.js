import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('타이머 UI는 실행 중 멈춤과 일시정지 중 계속 버튼을 표시한다', async () => {
  const source = await read('src/persistent-timer-ui.js');
  assert.ok(source.includes('id="timer-pause"'));
  assert.ok(source.includes("timer.running !== false ? '멈춤' : '계속'"));
  assert.ok(source.includes('state.controller.pause()'));
  assert.ok(source.includes('state.controller.resume()'));
});

test('일시정지 상태에서는 화면 갱신 인터벌을 시작하지 않는다', async () => {
  const source = await read('src/persistent-timer-ui.js');
  assert.match(source, /function startDisplay\(\)[\s\S]*active\.running === false[\s\S]*return;/);
});

test('Firestore 어댑터는 기존 activeTimer 문서를 갱신할 수 있다', async () => {
  const source = await read('src/persistent-timer-ui.js');
  assert.match(source, /async update\(timer\)[\s\S]*setDoc\(\s*activeRef[\s\S]*merge: true/);
});

test('멈춤 버튼 클릭은 기존 타이머 액션보다 먼저 처리된다', async () => {
  const source = await read('src/persistent-timer-ui.js');
  assert.ok(source.includes("event.target.closest('#timer-pause')"));
  assert.match(source, /pauseButton[\s\S]*handlePauseToggle/);
});
