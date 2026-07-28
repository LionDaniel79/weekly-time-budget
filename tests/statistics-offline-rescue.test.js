import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('통계는 서버 조회가 멈춰도 기기 스냅숏으로 먼저 표시한다', async () => {
  const source = await read('src/statistics-offline-rescue.js');
  assert.ok(source.includes('getExistingOfflineRuntime'));
  assert.ok(source.includes('getSnapshot'));
  assert.ok(source.includes('mergedEntries'));
  assert.match(source, /Promise\.race\([\s\S]*timeoutPromise\(\)/);
  assert.match(source, /setTimeout\([\s\S]*STATISTICS_SERVER_TIMEOUT_MS/);
  assert.ok(source.includes('statisticsData'));
  assert.ok(source.includes('기기에 저장된 자료'));
});

test('통계 구조 요청은 무기한 대기하지 않고 재시도 화면으로 전환한다', async () => {
  const source = await read('src/statistics-offline-rescue.js');
  assert.ok(source.includes('통계를 다시 불러오기'));
  assert.ok(source.includes('statistics-rescue-retry'));
  assert.ok(source.includes('서버 응답이 늦어'));
});

test('통계 메모리 캐시는 사용자 전환 시 초기화된다', async () => {
  const source = await read('src/statistics-offline-rescue.js');
  const resetStart = source.indexOf('function resetUserState');
  const resetEnd = source.indexOf('async function readCachedStatistics', resetStart);
  const resetSource = source.slice(resetStart, resetEnd);
  assert.ok(source.includes('activeUserId'));
  assert.ok(resetSource.includes('state.data = null;'));
  assert.ok(resetSource.includes('activeUserId = nextUserId;'));
  assert.match(source, /onAuthStateChanged\([\s\S]*resetUserState\(nextUserId\)/);
  assert.match(source, /if \(activeUserId !== user\.uid\) \{[\s\S]*state\.data = null;[\s\S]*activeUserId = user\.uid;/);
});

test('오프라인 통계 구조와 기록 기간 탐색이 앱 셸에 포함된다', async () => {
  const [html, serviceWorker] = await Promise.all([
    read('index.html'),
    read('service-worker.js'),
  ]);
  const navigationIndex = html.indexOf('./src/recorded-period-navigation.js');
  const rescueIndex = html.indexOf('./src/statistics-offline-rescue.js');
  const legacyIndex = html.indexOf('./src/statistics-ui.js');
  assert.ok(html.includes('data-view="statistics" class="nav-button"'));
  assert.ok(navigationIndex >= 0 && rescueIndex > navigationIndex, '기록 기간 탐색이 통계 이벤트보다 먼저 등록되어야 합니다.');
  assert.ok(rescueIndex >= 0 && legacyIndex > rescueIndex, '캐시 우선 통계 모듈이 기존 통계 모듈보다 먼저 실행되어야 합니다.');
  assert.ok(serviceWorker.includes('./src/statistics-offline-rescue.js'));
  assert.ok(serviceWorker.includes('./src/recorded-period-domain.js'));
  assert.ok(serviceWorker.includes('./src/recorded-period-navigation.js'));
  assert.ok(serviceWorker.includes('weekly-time-budget-shell-v9'));
});
