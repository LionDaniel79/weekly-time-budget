import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('월간 통계 옵션 패치는 같은 모델에서 select DOM을 반복 교체하지 않는다', async () => {
  const source = await read('src/recorded-period-navigation.js');
  assert.doesNotMatch(source, /if \(select\.innerHTML !== html\)/);
  assert.ok(source.includes('recordedPeriodOptionsSignature'));
  assert.match(source, /function replaceSelectOptions\(select, html, selectedValue, signature\)/);
  assert.match(source, /select\.dataset\.recordedPeriodOptionsSignature === signature/);
});

test('타이머 메뉴 진입 시 원격 activeTimer를 다시 확인한 뒤 즉시 렌더한다', async () => {
  const source = await read('src/persistent-timer-ui.js');
  assert.match(source, /async function refreshTimerFromRemote/);
  assert.match(source, /refreshTimerFromRemote[\s\S]*state\.controller\.recover\(\)[\s\S]*renderTimer\(\)/);
  assert.match(source, /opensRecord[\s\S]*refreshTimerFromRemote/);
});

test('화면이 다시 보일 때 활성 타이머 탭은 원격 상태를 다시 복구한다', async () => {
  const source = await read('src/persistent-timer-ui.js');
  assert.match(source, /visibilitychange[\s\S]*timerTabIsActive\(\)[\s\S]*refreshTimerFromRemote/);
});

test('수정된 화면 모듈을 강제 갱신하도록 서비스 워커 셸 캐시를 v6으로 올린다', async () => {
  const source = await read('service-worker.js');
  assert.ok(source.includes('weekly-time-budget-shell-v6'));
});
