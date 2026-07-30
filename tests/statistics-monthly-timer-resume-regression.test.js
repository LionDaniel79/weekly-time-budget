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

test('타이머 메뉴 진입 시 activeTimer를 예산 원격 갱신보다 먼저 복구하고 렌더한다', async () => {
  const source = await read('src/persistent-timer-ui.js');
  assert.match(source, /async function refreshTimerFromRemote/);
  const start = source.indexOf('async function refreshTimerFromRemote');
  const end = source.indexOf('function renderTimer', start);
  const refreshSource = source.slice(start, end);
  const recoverIndex = refreshSource.indexOf('controller.recover()');
  const renderIndex = refreshSource.indexOf('renderTimer()');
  const dataIndex = refreshSource.indexOf('refreshTimerData()');
  assert.ok(recoverIndex >= 0 && renderIndex > recoverIndex, 'active timer must render after recovery');
  assert.ok(dataIndex < 0 || dataIndex > renderIndex, 'budget refresh must not delay active timer rendering');
  assert.match(source, /opensRecord[\s\S]*refreshTimerFromRemote/);
});

test('로그인 복구도 기기 캐시와 activeTimer를 전체 원격 예산 조회보다 먼저 처리한다', async () => {
  const source = await read('src/persistent-timer-ui.js');
  const authStart = source.indexOf('authModule.onAuthStateChanged');
  const authEnd = source.indexOf("document.addEventListener('weekly-time-budget:data-changed'", authStart);
  const authSource = source.slice(authStart, authEnd);
  const cacheIndex = authSource.indexOf('restoreCachedTimerData');
  const configureIndex = authSource.indexOf('configureController()');
  const recoverIndex = authSource.indexOf('refreshTimerFromRemote()');
  const remoteDataIndex = authSource.indexOf('refreshTimerData()');
  assert.ok(cacheIndex >= 0);
  assert.ok(configureIndex > cacheIndex);
  assert.ok(recoverIndex > configureIndex);
  assert.ok(remoteDataIndex > recoverIndex);
});

test('화면이 다시 보일 때 활성 타이머 탭은 원격 상태를 다시 복구한다', async () => {
  const source = await read('src/persistent-timer-ui.js');
  assert.match(source, /visibilitychange[\s\S]*timerTabIsActive\(\)[\s\S]*refreshTimerFromRemote/);
});

test('수정된 화면을 강제 갱신하도록 서비스 워커 셸 캐시를 v12로 올린다', async () => {
  const source = await read('service-worker.js');
  assert.ok(source.includes('weekly-time-budget-shell-v12'));
  assert.ok(source.includes('./src/countdown-timer-domain.js'));
});
