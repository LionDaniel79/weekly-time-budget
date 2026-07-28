import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('오프라인 모듈은 올바른 자바스크립트 문법이다', async () => {
  for (const relative of [
    '../src/offline-entry-domain.js',
    '../src/offline-store.js',
    '../src/offline-entry-repository.js',
    '../src/offline-sync.js',
    '../src/offline-runtime.js',
    '../src/app-toast.js',
    '../src/ui-session-state.js',
    '../src/service-worker-cache.js',
    '../src/service-worker-registration.js',
    '../src/statistics-session-state.js',
    '../src/statistics-offline-rescue.js',
    '../src/recorded-period-domain.js',
    '../src/recorded-period-navigation.js',
    '../src/orphan-local-timer-cleanup.js',
    '../src/local-timer-removal-reload.js',
    '../src/category-bulk-editor.js',
    '../src/countdown-timer-domain.js',
    '../src/persistent-timer.js',
    '../src/persistent-timer-ui.js',
    '../service-worker.js',
  ]) {
    const result = spawnSync(process.execPath, ['--check', fileURLToPath(new URL(relative, import.meta.url))], { encoding: 'utf8' });
    assert.equal(result.status, 0, `${relative}: ${result.stderr || result.stdout}`);
  }
});

test('app은 addDoc 대신 local-first 저장과 pending 병합을 사용한다', async () => {
  const source = await read('src/app.js');
  for (const token of [
    'getOfflineRuntime',
    'saveEntryLocalFirst',
    'mergedEntries',
    'patchSnapshot',
    'showEntrySaveResult',
    '동기화 대기',
    'sync-retry',
  ]) assert.ok(source.includes(token), token);
  const saveStart = source.indexOf('async function saveEntry');
  const saveEnd = source.indexOf('async function deleteEntry', saveStart);
  assert.doesNotMatch(source.slice(saveStart, saveEnd), /addDoc\(/);
  assert.match(source.slice(saveStart, saveEnd), /onLocalSaved/);
});

test('캐시 스냅숏을 먼저 복원하고 원격 실패 시 오프라인 안내를 유지한다', async () => {
  const [appSource, toastSource] = await Promise.all([
    read('src/app.js'),
    read('src/app-toast.js'),
  ]);
  for (const token of [
    'restoreCachedState',
    'getSnapshot',
    'applySnapshotToState',
    '온라인에서 한 번 실행한 뒤',
  ]) assert.ok(appSource.includes(token), token);
  assert.ok(toastSource.includes('오프라인 상태입니다.'), '오프라인 상태입니다.');
});

test('저장 결과 토스트는 서버·기기·동기화 완료 상태와 iOS safe area를 제공한다', async () => {
  const source = await read('src/app-toast.js');
  for (const token of [
    '기록을 서버에 저장했습니다',
    '기기에 안전하게 저장했습니다',
    '인터넷 연결 시 자동으로 반영됩니다',
    '대기 중이던 기록',
    'env(safe-area-inset-bottom)',
    '.sync-status.pending',
    '.sync-status.failed',
  ]) assert.ok(source.includes(token), token);
});

test('앱은 마지막 메뉴와 모든 내부 상태를 사용자별로 저장하고 복원한다', async () => {
  const [appSource, budgetSource, statisticsSource] = await Promise.all([
    read('src/app.js'),
    read('src/time-budget-feature.js'),
    read('src/statistics-session-state.js'),
  ]);
  for (const token of [
    'getUiState',
    'putUiState',
    'weekly-time-budget:ui-state-restored',
    'weekly-time-budget:save-ui-state',
    'activeView',
    'manualMode',
  ]) assert.ok(appSource.includes(token), token);
  for (const token of ['dashboard', 'budget', 'selectedDate', 'selectedWeekStart']) {
    assert.ok(budgetSource.includes(token), token);
  }
  for (const token of ['statistics', 'weekStart', 'year', 'month', 'activeView']) {
    assert.ok(statisticsSource.includes(token), token);
  }
});

test('사용자 전환 시 화면 모듈은 이전 사용자의 캐시 데이터를 비운다', async () => {
  const [budgetSource, timerSource] = await Promise.all([
    read('src/time-budget-feature.js'),
    read('src/persistent-timer-ui.js'),
  ]);
  assert.match(
    budgetSource,
    /if \(!user\) \{[\s\S]*state\.categories = \[\];[\s\S]*state\.archived = \[\];[\s\S]*state\.entries = \[\];[\s\S]*state\.weekly = \[\];[\s\S]*state\.daily = \[\];/,
  );
  assert.ok(budgetSource.includes('state.defaultDayWeights = { ...EQUAL_DAY_WEIGHTS };'));
  assert.match(
    timerSource,
    /if \(!user\) \{[\s\S]*state\.categories = \[\];[\s\S]*state\.archived = \[\];[\s\S]*state\.entries = \[\];[\s\S]*state\.weekly = \[\];[\s\S]*state\.daily = \[\];/,
  );
  assert.ok(timerSource.includes("state.selectedMode = 'countdown';"));
});

test('서비스 워커는 앱 셸을 캐시하고 인증·Firestore API 응답은 캐시하지 않는다', async () => {
  const [html, serviceWorker] = await Promise.all([
    read('index.html'),
    read('service-worker.js'),
  ]);
  assert.ok(html.includes('./src/service-worker-registration.js'));
  assert.ok(html.includes('./src/local-timer-removal-reload.js'));
  assert.ok(html.includes('./src/mobile-compact.css'));
  assert.ok(html.includes('./src/category-bulk-editor.js'));
  for (const token of [
    'weekly-time-budget-shell-v8',
    'firebase-firestore.js',
    'firestore.googleapis.com',
    'identitytoolkit.googleapis.com',
    "request.mode === 'navigate'",
    'local-timer-removal-reload.js',
    'statistics-offline-rescue.js',
    'recorded-period-domain.js',
    'recorded-period-navigation.js',
    'mobile-compact.css',
    'category-bulk-editor.js',
    'countdown-timer-domain.js',
  ]) assert.ok(serviceWorker.includes(token), token);
});

test('완전 삭제는 서버 기록과 동기화 대기 기록을 함께 경고하고 제거한다', async () => {
  const [deleteSource, cleanupSource, reloadSource] = await Promise.all([
    read('src/category-delete-guard.js'),
    read('src/orphan-local-timer-cleanup.js'),
    read('src/local-timer-removal-reload.js'),
  ]);
  for (const token of [
    'countPendingByCategory',
    'deletePendingByCategory',
    '동기화 대기 기록',
    'cleanupOfflineCategory',
  ]) assert.ok(deleteSource.includes(token), token);
  assert.ok(cleanupSource.includes('weekly-time-budget:local-timer-removed'));
  assert.ok(reloadSource.includes('location.reload()'));
});
