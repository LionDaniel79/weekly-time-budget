import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('오프라인 모듈은 올바른 자바스크립트 문법이다', async () => {
  for (const relative of [
    '../src/offline-entry-domain.js', '../src/offline-store.js',
    '../src/offline-entry-repository.js', '../src/offline-sync.js',
    '../src/offline-runtime.js', '../src/app-toast.js', '../src/ui-session-state.js',
    '../src/service-worker-cache.js', '../src/service-worker-registration.js',
    '../src/statistics-state.js', '../src/statistics-data-source.js',
    '../src/statistics-view.js', '../src/statistics-feature.js',
    '../src/statistics-bootstrap.js', '../src/view-change-events.js',
    '../src/category-selection-memory.js', '../src/history-feature.js', '../src/category-feature.js', '../src/recorded-period-domain.js',
    '../src/orphan-local-timer-cleanup.js', '../src/local-timer-removal-reload.js',
    '../src/category-bulk-editor.js', '../src/countdown-timer-domain.js',
    '../src/goal-domain.js', '../src/persistent-timer.js',
    '../src/persistent-timer-ui.js', '../service-worker.js',
  ]) {
    const result = spawnSync(process.execPath, ['--check', fileURLToPath(new URL(relative, import.meta.url))], { encoding: 'utf8' });
    assert.equal(result.status, 0, `${relative}: ${result.stderr || result.stdout}`);
  }
});

test('app은 addDoc 대신 local-first 저장과 pending 병합을 사용한다', async () => {
  const [appSource, historySource] = await Promise.all([
    read('src/app.js'),
    read('src/history-feature.js'),
  ]);
  for (const token of ['getOfflineRuntime', 'saveEntryLocalFirst', 'mergedEntries', 'patchSnapshot', 'showEntrySaveResult']) {
    assert.ok(appSource.includes(token), token);
  }
  for (const token of ['동기화 대기', 'sync-retry']) {
    assert.ok(historySource.includes(token), token);
  }
  const saveStart = appSource.indexOf('async function saveEntry');
  const saveEnd = appSource.indexOf('async function deleteEntry', saveStart);
  assert.doesNotMatch(appSource.slice(saveStart, saveEnd), /addDoc\(/);
  assert.match(appSource.slice(saveStart, saveEnd), /onLocalSaved/);
});

test('캐시 스냅숏을 먼저 복원하고 원격 실패 시 오프라인 안내를 유지한다', async () => {
  const [appSource, toastSource] = await Promise.all([read('src/app.js'), read('src/app-toast.js')]);
  for (const token of ['restoreCachedState', 'getSnapshot', 'applySnapshotToState', '온라인에서 한 번 실행한 뒤']) {
    assert.ok(appSource.includes(token), token);
  }
  assert.ok(toastSource.includes('오프라인 상태입니다.'));
});

test('저장 결과 토스트는 서버·기기·동기화 완료 상태와 iOS safe area를 제공한다', async () => {
  const source = await read('src/app-toast.js');
  for (const token of ['기록을 서버에 저장했습니다', '기기에 안전하게 저장했습니다', '인터넷 연결 시 자동으로 반영됩니다', '대기 중이던 기록', 'env(safe-area-inset-bottom)', '.sync-status.pending', '.sync-status.failed']) {
    assert.ok(source.includes(token), token);
  }
});

test('앱은 마지막 메뉴와 통계 내부 상태를 사용자별로 저장하고 직접 복원한다', async () => {
  const [appSource, budgetSource, statisticsFeature, statisticsBootstrap] = await Promise.all([
    read('src/app.js'), read('src/time-budget-feature.js'),
    read('src/statistics-feature.js'), read('src/statistics-bootstrap.js'),
  ]);
  for (const token of ['getUiState', 'putUiState', 'weekly-time-budget:ui-state-restored', 'weekly-time-budget:save-ui-state', 'activeView', 'manualMode']) {
    assert.ok(appSource.includes(token), token);
  }
  for (const token of ['dashboard', 'budget', 'selectedDate', 'selectedWeekStart']) assert.ok(budgetSource.includes(token), token);
  for (const token of ['weekStart', 'year', 'month', 'saveUiState', 'restore(saved']) assert.ok(statisticsFeature.includes(token), token);
  assert.match(statisticsBootstrap, /weekly-time-budget:ui-state-restored[\s\S]*feature\.restore/);
  assert.doesNotMatch(statisticsBootstrap, /\.click\(\)|MutationObserver/);
});

test('사용자 전환 시 화면 모듈은 이전 사용자의 캐시 데이터를 비운다', async () => {
  const [budgetSource, timerSource, statisticsSource] = await Promise.all([
    read('src/time-budget-feature.js'), read('src/persistent-timer-ui.js'), read('src/statistics-data-source.js'),
  ]);
  assert.match(budgetSource, /if \(!user\) \{[\s\S]*state\.categories = \[\];[\s\S]*state\.archived = \[\];[\s\S]*state\.entries = \[\];/);
  assert.match(timerSource, /if \(!user\) \{[\s\S]*state\.categories = \[\];[\s\S]*state\.archived = \[\];[\s\S]*state\.entries = \[\];/);
  assert.match(statisticsSource, /runtimeForUser\(userId\)/);
});

test('서비스 워커는 앱 셸과 Firebase 런타임 캐시를 분리한다', async () => {
  const [html, serviceWorker] = await Promise.all([read('index.html'), read('service-worker.js')]);
  for (const token of ['./src/service-worker-registration.js', './src/statistics-primary.css', './src/statistics-bootstrap.js', './src/view-change-events.js']) {
    assert.ok(html.includes(token), token);
  }
  assert.doesNotMatch(html, /statistics-offline-rescue|statistics-ui|statistics-session-state|statistics-mobile-overflow/);
  for (const token of ['weekly-time-budget-shell-v16', 'weekly-time-budget-firebase-v2', 'firebaseCacheFirst', 'shellCacheFirst', 'firestore.googleapis.com', "request.mode === 'navigate'", './src/statistics-feature.js', './src/statistics-bootstrap.js']) {
    assert.ok(serviceWorker.includes(token), token);
  }
  assert.doesNotMatch(serviceWorker, /caches\.match\(/);
});

test('완전 삭제는 서버 기록과 동기화 대기 기록을 함께 경고하고 제거한다', async () => {
  const [deleteSource, cleanupSource, reloadSource] = await Promise.all([
    read('src/category-delete-guard.js'), read('src/orphan-local-timer-cleanup.js'), read('src/local-timer-removal-reload.js'),
  ]);
  for (const token of ['countPendingByCategory', 'deletePendingByCategory', '동기화 대기 기록', 'cleanupOfflineCategory']) assert.ok(deleteSource.includes(token), token);
  assert.ok(cleanupSource.includes('weekly-time-budget:local-timer-removed'));
  assert.ok(reloadSource.includes('location.reload()'));
});
