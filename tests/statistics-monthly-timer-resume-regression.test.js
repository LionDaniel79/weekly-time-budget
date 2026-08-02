import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('같은 월간 상태는 렌더 키가 같아 DOM을 반복 교체하지 않는다', async () => {
  const [state, feature] = await Promise.all([read('src/statistics-state.js'), read('src/statistics-feature.js')]);
  assert.match(state, /statisticsRenderKey/);
  assert.match(feature, /signature === lastRenderedSignature/);
  assert.match(feature, /if \(next === state\) return false/);
  assert.doesNotMatch(feature, /MutationObserver/);
});

test('타이머 메뉴 진입 시 activeTimer를 예산 원격 갱신보다 먼저 복구하고 렌더한다', async () => {
  const source = await read('src/persistent-timer-ui.js');
  const start = source.indexOf('async function refreshTimerFromRemote');
  const end = source.indexOf('function renderTimer', start);
  const refreshSource = source.slice(start, end);
  const recoverIndex = refreshSource.indexOf('controller.recover()');
  const renderIndex = refreshSource.indexOf('renderTimer()');
  const dataIndex = refreshSource.indexOf('refreshTimerData()');
  assert.ok(recoverIndex >= 0 && renderIndex > recoverIndex);
  assert.ok(dataIndex < 0 || dataIndex > renderIndex);
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
  assert.ok(cacheIndex >= 0 && configureIndex > cacheIndex && recoverIndex > configureIndex && remoteDataIndex > recoverIndex);
});

test('화면이 다시 보일 때 활성 타이머 탭은 원격 상태를 다시 복구한다', async () => {
  const source = await read('src/persistent-timer-ui.js');
  assert.match(source, /visibilitychange[\s\S]*timerTabIsActive\(\)[\s\S]*refreshTimerFromRemote/);
});

test('수정된 화면을 최신 서비스 워커 셸로 배포한다', async () => {
  const source = await read('service-worker.js');
  assert.ok(source.includes('weekly-time-budget-shell-v16'));
  assert.ok(source.includes('./src/countdown-timer-domain.js'));
  assert.ok(source.includes('./src/statistics-bootstrap.js'));
});
