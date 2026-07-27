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

test('앱은 마지막 메뉴와 기록 내부 탭을 사용자별로 저장하고 복원한다', async () => {
  const source = await read('src/app.js');
  for (const token of [
    'getUiState',
    'putUiState',
    'weekly-time-budget:ui-state-restored',
    'weekly-time-budget:save-ui-state',
    'activeView',
    'manualMode',
  ]) assert.ok(source.includes(token), token);
});
