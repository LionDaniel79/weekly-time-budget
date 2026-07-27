# 오프라인 기록 동기화·저장 확인·화면 복원 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 인터넷이 없거나 불안정해도 수동 입력과 타이머 기록을 기기에 먼저 안전하게 저장하고 자동 동기화하며, 저장 결과와 마지막 메뉴·내부 탭을 명확히 복원한다.

**Architecture:** 브라우저 IndexedDB를 사용자별 영속 저장소로 사용하고, 모든 기록은 동일한 `localId`로 기기 대기함과 Firestore 문서를 연결한다. `offline-sync.js`가 사용자별 단일 동기화 실행을 보장하고, 앱·타이머·통계·시간 예산 모듈은 IndexedDB 스냅숏과 UI 상태를 공통 API로 읽는다. 모듈형 서비스 워커가 앱 셸과 Firebase ESM 의존성 그래프를 캐시해 이전 로그인 사용자의 오프라인 재실행을 지원한다.

**Tech Stack:** Vanilla JavaScript ES modules, Firebase Auth/Firestore 11.10.0, IndexedDB, Service Worker module, Node.js 22 `node:test`, GitHub Pages.

## Global Constraints

- 오프라인 사용은 이 기기에서 이전에 로그인한 동일 사용자만 허용한다.
- 로그인하지 않은 임시 기록은 만들지 않는다.
- 수동 입력과 타이머 기록 모두 IndexedDB에 먼저 저장한다.
- `navigator.onLine`은 힌트로만 사용하고 실제 Firestore 쓰기 결과로 상태를 판정한다.
- Firestore 문서 ID는 IndexedDB의 `localId`와 동일해야 한다.
- iOS에서 지원이 일정하지 않은 Background Sync API에는 의존하지 않는다.
- 저장 알림은 확인 버튼 없는 하단 토스트이며 기본 4초, 오류는 7초 표시한다.
- 마지막 메뉴와 대시보드·기록·시간 예산·통계 내부 상태를 사용자별로 복원한다.
- 미래 날짜와 미래 주는 기존 제한에 맞춰 오늘 또는 이번 주로 보정한다.
- 기존 통계 계산, 대분류 보관/완전 삭제, 로그인, 모바일 레이아웃을 회귀시키지 않는다.

---

## File Map

**Create**

- `src/offline-entry-domain.js`: 대기 기록 생성, 오류 분류, 원격·대기 기록 병합의 순수 로직.
- `src/offline-store.js`: IndexedDB 스키마와 사용자별 pending/snapshot/uiState CRUD.
- `src/offline-entry-repository.js`: local-first 저장과 동일 ID 원격 동기화.
- `src/offline-sync.js`: 사용자별 단일 실행 동기화 코디네이터와 브라우저 이벤트 연결.
- `src/app-toast.js`: 저장·대기·동기화·오류 토스트 렌더링.
- `src/ui-session-state.js`: UI 상태 기본값, 정규화, 기간 보정.
- `src/service-worker-cache.js`: 서비스 워커가 재사용하는 앱 셸·ESM 그래프 캐시 함수.
- `service-worker.js`: 앱 셸/모듈 캐시와 오프라인 탐색 fallback.
- `src/service-worker-registration.js`: 모듈형 서비스 워커 등록과 업데이트 처리.
- `tests/helpers/fake-offline-store.js`: 저장소/동기화 단위 테스트용 메모리 구현.
- `tests/offline-entry-domain.test.js`
- `tests/offline-store.test.js`
- `tests/offline-entry-repository.test.js`
- `tests/offline-sync.test.js`
- `tests/ui-session-state.test.js`
- `tests/service-worker-cache.test.js`
- `tests/offline-app-integration.test.js`

**Modify**

- `src/app.js`: 오프라인 우선 초기화, 수동 기록 공통 저장, pending 병합, 메뉴/기록 탭 상태 저장.
- `src/persistent-timer.js`: 오프라인 시작 허용과 local-first 종료 계약.
- `src/persistent-timer-ui.js`: 공통 기록 저장·토스트·원격 activeTimer 조건부 정리.
- `src/time-budget-feature.js`: 스냅숏 fallback과 대시보드/시간 예산 상태 복원.
- `src/statistics-ui.js`: 스냅숏 fallback과 통계 상태 복원.
- `src/category-delete-guard.js`: 같은 사용자의 대기 기록 경고·삭제.
- `index.html`: 서비스 워커 등록 모듈과 오프라인 모듈 로드.
- `styles.css`: 토스트, 동기화 배지, 재시도 버튼, safe-area 스타일.
- `scripts/prepare-pages-site.mjs`: 서비스 워커를 Pages 산출물에 복사.
- `.github/workflows/ci.yml`: 오프라인 관련 배포 파일 존재 검증.

---

### Task 1: 대기 기록과 UI 상태 순수 로직

**Files:**
- Create: `src/offline-entry-domain.js`
- Create: `src/ui-session-state.js`
- Test: `tests/offline-entry-domain.test.js`
- Test: `tests/ui-session-state.test.js`

**Interfaces:**
- Produces: `createPendingEntry({ userId, entry, localId, createdAt, clearActiveTimer })`.
- Produces: `classifySyncError(error) -> 'retryable' | 'permanent'`.
- Produces: `mergeRemoteAndPendingEntries(remoteEntries, pendingRecords)`.
- Produces: `createDefaultUiState({ today, currentWeekStart })`.
- Produces: `normalizeUiState(raw, { today, currentWeekStart, validViews })`.

- [ ] **Step 1: Write failing domain tests**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createPendingEntry,
  classifySyncError,
  mergeRemoteAndPendingEntries,
} from '../src/offline-entry-domain.js';

test('pending 기록은 Firestore에도 사용할 동일 localId를 가진다', () => {
  const record = createPendingEntry({
    userId: 'u1', localId: 'local-1', createdAt: 1000,
    entry: { categoryId: 'reading', date: '2026-07-27', durationMinutes: 30 },
  });
  assert.equal(record.localId, 'local-1');
  assert.equal(record.entry.id, 'local-1');
  assert.equal(record.status, 'pending');
  assert.equal(record.attempts, 0);
});

test('원격 기록과 pending 기록을 ID로 합치고 pending 상태를 우선 표시한다', () => {
  const merged = mergeRemoteAndPendingEntries(
    [{ id: 'a', durationMinutes: 10 }, { id: 'b', durationMinutes: 20 }],
    [{ localId: 'b', status: 'pending', entry: { id: 'b', durationMinutes: 20 } },
     { localId: 'c', status: 'failed', entry: { id: 'c', durationMinutes: 30 } }],
  );
  assert.deepEqual(merged.map((item) => [item.id, item.syncStatus]), [
    ['c', 'failed'], ['b', 'pending'], ['a', 'synced'],
  ]);
});

test('네트워크·unavailable은 재시도하고 권한·검증 오류는 영구 실패로 분류한다', () => {
  assert.equal(classifySyncError({ code: 'unavailable' }), 'retryable');
  assert.equal(classifySyncError({ code: 'auth/network-request-failed' }), 'retryable');
  assert.equal(classifySyncError({ code: 'permission-denied' }), 'permanent');
  assert.equal(classifySyncError({ code: 'invalid-argument' }), 'permanent');
});
```

- [ ] **Step 2: Write failing UI state tests**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { createDefaultUiState, normalizeUiState } from '../src/ui-session-state.js';

test('마지막 메뉴와 내부 탭을 유지하되 미래 기간은 현재로 보정한다', () => {
  const value = normalizeUiState({
    activeView: 'statistics',
    dashboard: { mode: 'weekly', selectedDate: '2026-08-10', selectedWeekStart: '2026-08-10' },
    record: { tab: 'manual', manualMode: 'duration' },
    budget: { mode: 'week' },
    statistics: { mode: 'monthly-comparison', year: 2028, month: 12, weekStart: '2026-08-10' },
  }, { today: '2026-07-27', currentWeekStart: '2026-07-27', validViews: ['dashboard','record','budget','history','statistics','categories'] });
  assert.equal(value.activeView, 'statistics');
  assert.equal(value.dashboard.selectedDate, '2026-07-27');
  assert.equal(value.dashboard.selectedWeekStart, '2026-07-27');
  assert.deepEqual(value.record, { tab: 'manual', manualMode: 'duration' });
  assert.equal(value.statistics.year, 2026);
  assert.equal(value.statistics.month, 7);
});

test('알 수 없는 메뉴와 탭은 안전한 기본값으로 돌아간다', () => {
  const value = normalizeUiState({ activeView: 'missing', record: { tab: 'other' } }, {
    today: '2026-07-27', currentWeekStart: '2026-07-27', validViews: ['dashboard','record'],
  });
  assert.equal(value.activeView, 'dashboard');
  assert.deepEqual(value.record, createDefaultUiState({ today: '2026-07-27', currentWeekStart: '2026-07-27' }).record);
});
```

- [ ] **Step 3: Run tests and verify RED**

Run: `node --test tests/offline-entry-domain.test.js tests/ui-session-state.test.js`

Expected: FAIL with `ERR_MODULE_NOT_FOUND` for the two new modules.

- [ ] **Step 4: Implement minimal pure functions**

```js
// src/offline-entry-domain.js
const RETRYABLE_CODES = new Set(['unavailable', 'deadline-exceeded', 'resource-exhausted', 'auth/network-request-failed']);
export function createPendingEntry({ userId, entry, localId, createdAt = Date.now(), clearActiveTimer = null }) {
  if (!userId || !localId) throw new Error('사용자와 기록 ID가 필요합니다.');
  return { localId, userId, entry: { ...entry, id: localId }, status: 'pending', attempts: 0, createdAt, lastAttemptAt: null, lastError: null, clearActiveTimer };
}
export function classifySyncError(error = {}) {
  const code = String(error.code || '').replace(/^firestore\//, '');
  return RETRYABLE_CODES.has(code) || /network|offline|failed to fetch/i.test(String(error.message || '')) ? 'retryable' : 'permanent';
}
export function mergeRemoteAndPendingEntries(remoteEntries = [], pendingRecords = []) {
  const map = new Map(remoteEntries.map((entry) => [entry.id, { ...entry, syncStatus: 'synced' }]));
  pendingRecords.forEach((record) => map.set(record.localId, { ...record.entry, id: record.localId, syncStatus: record.status }));
  return [...map.values()].sort((a, b) => String(b.createdAt || b.date || '').localeCompare(String(a.createdAt || a.date || '')));
}
```

Implement `ui-session-state.js` with explicit allowed values:

```js
const RECORD_TABS = new Set(['timer', 'manual']);
const MANUAL_MODES = new Set(['time-range', 'duration']);
const DASHBOARD_MODES = new Set(['daily', 'weekly']);
const BUDGET_MODES = new Set(['today', 'week']);
const STATISTICS_MODES = new Set(['weekly', 'monthly', 'yearly', 'monthly-comparison', 'yearly-comparison']);
```

Clamp `selectedDate`, `selectedWeekStart`, and statistics `weekStart` to current values; clamp future statistics year/month to the current year/month derived from `today`.

- [ ] **Step 5: Run tests and verify GREEN**

Run: `node --test tests/offline-entry-domain.test.js tests/ui-session-state.test.js`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/offline-entry-domain.js src/ui-session-state.js tests/offline-entry-domain.test.js tests/ui-session-state.test.js
git commit -m "feat: add offline entry and UI state domain logic"
```

---

### Task 2: 사용자별 IndexedDB 저장소

**Files:**
- Create: `src/offline-store.js`
- Create: `tests/helpers/fake-offline-store.js`
- Test: `tests/offline-store.test.js`

**Interfaces:**
- Consumes: pending record shape from Task 1.
- Produces: `createOfflineStore({ indexedDB, dbName })` with `putPending`, `getPending`, `getPendingById`, `deletePending`, `updatePending`, `countPending`, `countPendingByCategory`, `deletePendingByCategory`, `getSnapshot`, `patchSnapshot`, `getUiState`, `putUiState`.

- [ ] **Step 1: Write failing storage contract tests**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { createMemoryOfflineStore } from './helpers/fake-offline-store.js';

async function verifyStore(createStore) {
  const store = await createStore();
  await store.putPending({ localId: 'a', userId: 'u1', createdAt: 1, status: 'pending', entry: { categoryId: 'reading' } });
  await store.putPending({ localId: 'b', userId: 'u2', createdAt: 2, status: 'pending', entry: { categoryId: 'reading' } });
  assert.deepEqual((await store.getPending('u1')).map((item) => item.localId), ['a']);
  assert.equal(await store.countPending('u1'), 1);
  assert.equal(await store.countPendingByCategory('u1', 'reading'), 1);
  await store.patchSnapshot('u1', { categories: [{ id: 'reading' }] });
  await store.patchSnapshot('u1', { entries: [{ id: 'a' }] });
  assert.deepEqual(await store.getSnapshot('u1'), { userId: 'u1', categories: [{ id: 'reading' }], entries: [{ id: 'a' }] });
  await store.putUiState('u1', { activeView: 'record' });
  assert.deepEqual(await store.getUiState('u1'), { activeView: 'record' });
}

test('메모리 저장소 계약', () => verifyStore(createMemoryOfflineStore));
```

Add an IndexedDB adapter test using a minimal request/transaction fake that checks schema creation names `pendingEntries`, `userSnapshots`, `uiState` and indexes `userId`, `[userId, createdAt]`, `[userId, entry.categoryId]`.

- [ ] **Step 2: Run test and verify RED**

Run: `node --test tests/offline-store.test.js`

Expected: FAIL because store modules do not exist.

- [ ] **Step 3: Implement memory test helper and IndexedDB store**

Use DB name `weekly-time-budget-offline`, version `1`. Implement a single `requestToPromise(request)` and `transactionDone(transaction)` helper. `patchSnapshot` must read the existing object and write `{ ...existing, ...partial, userId }` in one readwrite transaction so independent modules do not erase each other's fields.

```js
export async function createOfflineStore({ indexedDB = globalThis.indexedDB, dbName = 'weekly-time-budget-offline' } = {}) {
  if (!indexedDB) throw new Error('이 브라우저에서는 오프라인 저장소를 사용할 수 없습니다.');
  const db = await openDatabase(indexedDB, dbName, 1);
  return {
    putPending: (record) => put(db, 'pendingEntries', record),
    getPending: (userId) => getAllByUser(db, 'pendingEntries', userId),
    // remaining contract methods
  };
}
```

Sort `getPending(userId)` by `createdAt`, then `localId`. Never return another user's records.

- [ ] **Step 4: Run test and verify GREEN**

Run: `node --test tests/offline-store.test.js`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/offline-store.js tests/helpers/fake-offline-store.js tests/offline-store.test.js
git commit -m "feat: add user-scoped IndexedDB offline store"
```

---

### Task 3: Local-first 기록 저장소와 자동 동기화

**Files:**
- Create: `src/offline-entry-repository.js`
- Create: `src/offline-sync.js`
- Test: `tests/offline-entry-repository.test.js`
- Test: `tests/offline-sync.test.js`

**Interfaces:**
- Consumes: `createPendingEntry`, `classifySyncError`, store contract.
- Produces: `createOfflineEntryRepository({ store, remote, createId, now })`.
- Repository methods: `saveEntryLocalFirst({ userId, entry, localId, clearActiveTimer })`, `flushPendingEntries(userId)`, `retryEntry(userId, localId)`, `listMergedEntries(userId, remoteEntries)`.
- Produces: `createOfflineSyncCoordinator({ repository, userId, eventTarget, documentTarget, onResult })` with `flush(reason)`, `start()`, `stop()`.

- [ ] **Step 1: Write failing repository tests**

```js
test('기기 저장 후 원격 성공이면 대기함을 제거한다', async () => {
  const store = await createMemoryOfflineStore();
  const writes = [];
  const repository = createOfflineEntryRepository({
    store, createId: () => 'entry-1', now: () => 1000,
    remote: { save: async (record) => writes.push(record) },
  });
  const result = await repository.saveEntryLocalFirst({ userId: 'u1', entry: { categoryId: 'reading', date: '2026-07-27', durationMinutes: 30 } });
  assert.equal(result.status, 'synced');
  assert.equal(writes[0].localId, 'entry-1');
  assert.equal(await store.countPending('u1'), 0);
});

test('네트워크 실패면 기록을 pending으로 유지한다', async () => {
  const store = await createMemoryOfflineStore();
  const repository = createOfflineEntryRepository({
    store, createId: () => 'entry-2', now: () => 1000,
    remote: { save: async () => { const error = new Error('offline'); error.code = 'unavailable'; throw error; } },
  });
  const result = await repository.saveEntryLocalFirst({ userId: 'u1', entry: { categoryId: 'reading', date: '2026-07-27', durationMinutes: 30 } });
  assert.equal(result.status, 'queued');
  assert.equal(await store.countPending('u1'), 1);
});

test('권한 오류는 failed로 표시하고 자동 반복하지 않는다', async () => {
  const store = await createMemoryOfflineStore();
  const repository = createOfflineEntryRepository({
    store, createId: () => 'entry-3', now: () => 1000,
    remote: { save: async () => { const error = new Error('denied'); error.code = 'permission-denied'; throw error; } },
  });
  const result = await repository.saveEntryLocalFirst({ userId: 'u1', entry: { categoryId: 'reading' } });
  assert.equal(result.status, 'failed');
  assert.equal((await store.getPendingById('entry-3')).status, 'failed');
});
```

Add a retry test where the same `localId` is flushed twice but `remote.save` receives the same ID and only one logical Firestore target.

- [ ] **Step 2: Write failing coordinator test**

```js
test('동시에 여러 flush 요청이 와도 사용자별 한 Promise만 실행한다', async () => {
  let calls = 0;
  let resolve;
  const pending = new Promise((done) => { resolve = done; });
  const coordinator = createOfflineSyncCoordinator({
    userId: 'u1', repository: { flushPendingEntries: async () => { calls += 1; await pending; return { syncedCount: 1, pendingCount: 0, failedCount: 0 }; } },
    eventTarget: new EventTarget(), documentTarget: new EventTarget(), onResult: () => {},
  });
  const a = coordinator.flush('online');
  const b = coordinator.flush('visible');
  assert.equal(a, b);
  resolve();
  await a;
  assert.equal(calls, 1);
});
```

- [ ] **Step 3: Run tests and verify RED**

Run: `node --test tests/offline-entry-repository.test.js tests/offline-sync.test.js`

Expected: FAIL because repository/coordinator modules do not exist.

- [ ] **Step 4: Implement repository and coordinator**

`remote.save(record)` must be idempotent and own Firestore-specific behavior later. Repository algorithm:

```js
await store.putPending(record);
try {
  await remote.save(record);
  await store.deletePending(record.localId);
  return { status: 'synced', localId, entry: { ...record.entry, syncStatus: 'synced' }, pendingCount: await store.countPending(userId) };
} catch (error) {
  const kind = classifySyncError(error);
  const next = { ...record, status: kind === 'retryable' ? 'pending' : 'failed', attempts: record.attempts + 1, lastAttemptAt: now(), lastError: String(error.message || error) };
  await store.updatePending(next);
  return { status: kind === 'retryable' ? 'queued' : 'failed', localId, entry: { ...next.entry, syncStatus: next.status }, pendingCount: await store.countPending(userId), error };
}
```

`flushPendingEntries` processes records in creation order, skips `failed`, continues after individual retryable failures, and returns counts. Coordinator listens to `online` and visible `visibilitychange`; `start()` registers and performs one startup flush, `stop()` removes listeners.

- [ ] **Step 5: Run tests and verify GREEN**

Run: `node --test tests/offline-entry-repository.test.js tests/offline-sync.test.js`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/offline-entry-repository.js src/offline-sync.js tests/offline-entry-repository.test.js tests/offline-sync.test.js
git commit -m "feat: add local-first entry synchronization"
```

---

### Task 4: 저장 결과 토스트와 동기화 상태 UI

**Files:**
- Create: `src/app-toast.js`
- Modify: `styles.css`
- Test: `tests/offline-app-integration.test.js`

**Interfaces:**
- Produces: `showToast({ type, title, message, duration })`.
- Produces: `showEntrySaveResult(result)` and `showSyncResult(result)`.
- DOM contract: one `#app-toast-region` with `aria-live="polite"`, pending badge class `.sync-status.pending`, failed badge class `.sync-status.failed`.

- [ ] **Step 1: Write failing source-contract tests**

```js
test('토스트는 서버 저장·대기·동기화 완료 문구와 safe-area를 제공한다', async () => {
  const [toast, css] = await Promise.all([read('src/app-toast.js'), read('styles.css')]);
  for (const text of ['기록을 서버에 저장했습니다', '기기에 안전하게 저장했습니다', '인터넷 연결 시 자동으로 반영됩니다', '대기 중이던 기록']) assert.ok(toast.includes(text));
  assert.ok(css.includes('env(safe-area-inset-bottom)'));
  assert.ok(css.includes('.app-toast'));
  assert.ok(css.includes('.sync-status.pending'));
  assert.ok(css.includes('.sync-status.failed'));
});
```

- [ ] **Step 2: Run test and verify RED**

Run: `node --test tests/offline-app-integration.test.js`

Expected: FAIL because `src/app-toast.js` does not exist.

- [ ] **Step 3: Implement toast module and styles**

```js
export function showEntrySaveResult(result) {
  if (result.status === 'synced') return showToast({ type: 'success', title: '✓ 기록을 서버에 저장했습니다.' });
  if (result.status === 'queued') return showToast({ type: 'queued', title: '✓ 기기에 안전하게 저장했습니다.', message: `인터넷 연결 시 자동으로 반영됩니다. · 동기화 대기 ${result.pendingCount}건` });
  return showToast({ type: 'error', title: '기기에는 저장했지만 서버 동기화가 필요합니다.', message: '로그인과 네트워크 상태를 확인한 뒤 기록 내역에서 다시 시도하세요.', duration: 7000 });
}
```

Position toast with `bottom: calc(16px + env(safe-area-inset-bottom));`, use `pointer-events:none` on region and `pointer-events:auto` on actionable failed toast only.

- [ ] **Step 4: Run test and verify GREEN**

Run: `node --test tests/offline-app-integration.test.js`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/app-toast.js styles.css tests/offline-app-integration.test.js
git commit -m "feat: show entry save and sync status toasts"
```

---

### Task 5: 앱 오프라인 bootstrap, 수동 저장, pending 기록 표시

**Files:**
- Modify: `src/app.js:17-175, 234-322`
- Modify: `index.html:70-79`
- Test: `tests/offline-app-integration.test.js`

**Interfaces:**
- Consumes: offline store, repository, coordinator, toast, UI state.
- Produces browser events:
  - `weekly-time-budget:entries-changed` detail `{ entries, pendingCount }`.
  - `weekly-time-budget:snapshot-changed` detail `{ userId }`.
  - `weekly-time-budget:ui-state-restored` detail normalized state.
- Exposes no mutable globals.

- [ ] **Step 1: Add failing integration contracts**

```js
test('app은 addDoc 대신 local-first 저장과 pending 병합을 사용한다', async () => {
  const source = await read('src/app.js');
  for (const token of ['createOfflineStore', 'createOfflineEntryRepository', 'createOfflineSyncCoordinator', 'mergeRemoteAndPendingEntries', 'showEntrySaveResult', 'patchSnapshot']) assert.ok(source.includes(token), token);
  const saveStart = source.indexOf('async function saveEntry');
  const saveEnd = source.indexOf('async function deleteEntry', saveStart);
  assert.doesNotMatch(source.slice(saveStart, saveEnd), /addDoc\(/);
  assert.match(source.slice(saveStart, saveEnd), /saveEntryLocalFirst/);
});

test('오프라인 스냅숏을 먼저 렌더하고 원격 실패 시 입력 화면을 유지한다', async () => {
  const source = await read('src/app.js');
  assert.ok(source.includes('getSnapshot'));
  assert.ok(source.includes('applySnapshotToState'));
  assert.ok(source.includes('오프라인 상태입니다. 새 기록은 기기에 저장됩니다.'));
});

test('기록 내역은 pending과 failed 배지와 재시도 버튼을 렌더한다', async () => {
  const source = await read('src/app.js');
  assert.ok(source.includes('동기화 대기'));
  assert.ok(source.includes('동기화 실패'));
  assert.ok(source.includes('data-retry-entry'));
});
```

- [ ] **Step 2: Run test and verify RED**

Run: `node --test tests/offline-app-integration.test.js`

Expected: FAIL on missing integration tokens.

- [ ] **Step 3: Implement shared runtime initialization in app.js**

After Firebase modules load, call `firebase.setPersistence(auth, firebase.browserLocalPersistence)` and create the offline services once per authenticated UID. Add helpers:

```js
function applySnapshotToState(snapshot = {}) {
  if (snapshot.categories) state.categories = snapshot.categories;
  if (snapshot.entries) state.entries = snapshot.entries;
  if (snapshot.weeklyBudget !== undefined) state.weeklyBudget = snapshot.weeklyBudget;
}
async function refreshEntriesFromCacheAndRemote() {
  const pending = await offlineStore.getPending(state.user.uid);
  state.entries = mergeRemoteAndPendingEntries(state.entries.filter((item) => item.syncStatus !== 'pending' && item.syncStatus !== 'failed'), pending);
}
```

Auth flow order:

1. Read `getSnapshot(uid)` and `getUiState(uid)`.
2. Apply snapshot and normalized UI state; render immediately if snapshot exists.
3. Attempt current Firestore reads.
4. On success patch snapshot fields and merge pending.
5. On failure keep cached state and show one offline toast.
6. Start sync coordinator; when it reports synced records, reload remote data, patch snapshot, and dispatch data-change events.

- [ ] **Step 4: Replace manual `saveEntry` with local-first flow**

```js
async function saveEntry(entry) {
  const optimisticId = crypto.randomUUID();
  const optimistic = { ...entry, id: optimisticId, createdAt: Date.now(), syncStatus: 'pending' };
  state.entries = mergeRemoteAndPendingEntries(state.entries, [{ localId: optimisticId, status: 'pending', entry: optimistic }]);
  renderDashboard(); renderHistory();
  const result = await entryRepository.saveEntryLocalFirst({ userId: state.user.uid, localId: optimisticId, entry: optimistic });
  await refreshEntriesFromCacheAndRemote();
  await offlineStore.patchSnapshot(state.user.uid, { entries: state.entries });
  renderDashboard(); renderHistory();
  showEntrySaveResult(result);
  document.dispatchEvent(new CustomEvent('weekly-time-budget:entries-changed', { detail: { entries: state.entries, pendingCount: result.pendingCount } }));
  return result;
}
```

Disable the `기록 저장` button while awaiting IndexedDB write. Reset fields only for `synced` or `queued`; keep them for thrown IndexedDB failures. Keep `manualCategoryId` and `manualInputMode`.

Render badges beside pending/failed entries and bind failed retry buttons to `entryRepository.retryEntry(uid, localId)` followed by toast and rerender.

- [ ] **Step 5: Add module imports to index.html**

Load `service-worker-registration.js` before Firebase feature modules. Keep app.js as the owner of manual form actions; do not add a second submit interceptor.

- [ ] **Step 6: Run focused and full tests**

Run: `node --test tests/offline-app-integration.test.js tests/manual-entry.test.js tests/app-entry-selection.test.js`

Expected: PASS.

Run: `npm test`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/app.js index.html tests/offline-app-integration.test.js
git commit -m "feat: save manual entries offline first"
```

---

### Task 6: 타이머의 오프라인 시작·종료와 조건부 원격 정리

**Files:**
- Modify: `src/persistent-timer.js:35-109`
- Modify: `src/persistent-timer-ui.js:32-169`
- Test: `tests/persistent-timer.test.js`
- Test: `tests/offline-app-integration.test.js`

**Interfaces:**
- Controller `start(input)` returns `{ timer, recovered, remotePending }`.
- Controller `stop(buildEntry)` delegates to injected `complete(timer, entry)` which must confirm IndexedDB save before local timer removal.
- Pending record `clearActiveTimer` shape: `{ userId, startedAt }`.

- [ ] **Step 1: Add failing controller tests**

```js
test('원격 조회가 오프라인이어도 로컬 타이머를 시작한다', async () => {
  const storage = memoryStorage();
  const controller = createPersistentTimerController({
    storage, storageKey: 'timer', now: () => 1000,
    remote: {
      get: async () => { const error = new Error('offline'); error.code = 'unavailable'; throw error; },
      set: async () => { throw Object.assign(new Error('offline'), { code: 'unavailable' }); },
      remove: async () => {},
    },
    complete: async () => ({ status: 'queued' }),
  });
  const result = await controller.start({ userId: 'u1', categoryId: 'reading', startedDate: '2026-07-27' });
  assert.equal(result.remotePending, true);
  assert.equal(controller.active.startedAt, 1000);
  assert.ok(storage.getItem('timer'));
});

test('종료 기록의 기기 저장이 실패하면 진행 중 타이머를 유지한다', async () => {
  const controller = configuredController({ complete: async () => { throw new Error('indexeddb failed'); } });
  await controller.start({ userId: 'u1', categoryId: 'reading', startedDate: '2026-07-27' });
  await assert.rejects(() => controller.stop(() => ({ durationMinutes: 1 })), /indexeddb failed/);
  assert.ok(controller.active);
});
```

- [ ] **Step 2: Run test and verify RED**

Run: `node --test tests/persistent-timer.test.js`

Expected: FAIL because current start throws on remote failure and completion is remote-only.

- [ ] **Step 3: Modify controller minimally**

Write local timer before remote synchronization. Only replace with another device's remote timer when `remote.get()` succeeds and returns one. Treat retryable remote get/set failures as `remotePending: true`; propagate permanent validation errors. Move completion out of `remote.complete` into injected `complete` so local clear occurs only after local-first entry save succeeds.

Offline cancellation remains conservative: if `remote.remove()` fails, do not clear local timer; show error so a cancelled remote timer cannot reappear silently.

- [ ] **Step 4: Integrate timer UI with entry repository**

Configure `complete` as:

```js
complete: async (timer, entry) => entryRepository.saveEntryLocalFirst({
  userId: state.user.uid,
  localId: `timer-${Math.round(timer.startedAt)}`,
  entry,
  clearActiveTimer: { userId: timer.userId, startedAt: timer.startedAt },
})
```

Implement Firestore `remote.save(record)` in app/runtime with a transaction:

```js
const entryRef = store.doc(db, 'users', record.userId, 'entries', record.localId);
await store.runTransaction(db, async (transaction) => {
  transaction.set(entryRef, { ...record.entry, createdAt: store.serverTimestamp() }, { merge: true });
  if (!record.clearActiveTimer) return;
  const activeRef = store.doc(db, 'users', record.userId, 'activeTimer', 'current');
  const active = await transaction.get(activeRef);
  if (active.exists() && active.data().userId === record.clearActiveTimer.userId && Number(active.data().startedAt) === Number(record.clearActiveTimer.startedAt)) transaction.delete(activeRef);
});
```

After stop, call `showEntrySaveResult(result)` and dispatch entry/data changed events. Do not display the old generic `타이머 작업에 실패했습니다` for queued saves.

- [ ] **Step 5: Run focused and full tests**

Run: `node --test tests/persistent-timer.test.js tests/offline-app-integration.test.js`

Expected: PASS.

Run: `npm test`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/persistent-timer.js src/persistent-timer-ui.js tests/persistent-timer.test.js tests/offline-app-integration.test.js
git commit -m "feat: support offline timer recording"
```

---

### Task 7: 마지막 메뉴와 모든 내부 탭·기간 복원

**Files:**
- Modify: `src/app.js:26-36, 177-185, 253-264`
- Modify: `src/time-budget-feature.js`
- Modify: `src/statistics-ui.js`
- Test: `tests/ui-session-state.test.js`
- Test: `tests/offline-app-integration.test.js`

**Interfaces:**
- Consumes: normalized state from `ui-session-state.js`, `offlineStore.getUiState/putUiState`.
- Custom event: `weekly-time-budget:save-ui-state` detail partial UI state; app merges with current user state before writing.

- [ ] **Step 1: Add failing integration contracts**

```js
test('각 화면 모듈은 내부 상태를 복원하고 변경 시 저장 이벤트를 보낸다', async () => {
  const [app, budget, statistics] = await Promise.all([read('src/app.js'), read('src/time-budget-feature.js'), read('src/statistics-ui.js')]);
  assert.ok(app.includes('getUiState'));
  assert.ok(app.includes('putUiState'));
  assert.ok(app.includes("activeView"));
  for (const source of [budget, statistics]) {
    assert.ok(source.includes('weekly-time-budget:ui-state-restored'));
    assert.ok(source.includes('weekly-time-budget:save-ui-state'));
  }
});
```

- [ ] **Step 2: Run test and verify RED**

Run: `node --test tests/ui-session-state.test.js tests/offline-app-integration.test.js`

Expected: FAIL on missing restoration contracts.

- [ ] **Step 3: Persist and restore app-owned state**

Before first authenticated `renderAll`, assign:

```js
state.activeRecordTab = restored.record.tab;
state.manualInputMode = restored.record.manualMode;
```

Call `switchView(restored.activeView)` after all navigation buttons exist. On every side navigation click save `activeView`; on record tab/mode changes save `record`. If restored view is `statistics`, dispatch the restoration event and let statistics-ui own its rendering instead of forcing app.js `switchView`.

- [ ] **Step 4: Restore dashboard/time-budget state**

In `time-budget-feature.js`, listen before initial render:

```js
document.addEventListener('weekly-time-budget:ui-state-restored', (event) => {
  const saved = event.detail;
  Object.assign(state.dashboard, saved.dashboard);
  Object.assign(state.budget, saved.budget);
});
```

After every mode/date/week/calendar/budget-tab change, dispatch partial state. Keep the existing future date/week guards after applying restored values.

- [ ] **Step 5: Restore statistics state**

Apply `mode`, `weekStart`, `year`, `month` before `renderStatistics()`. Save state after every statistics tab, previous/next week, month, or year selection. When `activeView === 'statistics'`, call the existing `showStatisticsView` once with its navigation button.

- [ ] **Step 6: Test and commit**

Run: `node --test tests/ui-session-state.test.js tests/offline-app-integration.test.js tests/statistics-ui.test.js tests/time-budget-integration.test.js`

Expected: PASS.

Run: `npm test`

Expected: PASS.

```bash
git add src/app.js src/time-budget-feature.js src/statistics-ui.js tests/ui-session-state.test.js tests/offline-app-integration.test.js
git commit -m "feat: restore last menu and internal tabs"
```

---

### Task 8: 스냅숏 fallback을 시간 예산·대시보드·통계에 연결

**Files:**
- Modify: `src/time-budget-feature.js:94-166`
- Modify: `src/statistics-ui.js` data-loading functions
- Test: `tests/offline-app-integration.test.js`
- Test: `tests/time-budget-integration.test.js`

**Interfaces:**
- Consumes: `offlineStore.getSnapshot(uid)` and `patchSnapshot(uid, partial)`.
- Consumes pending entries merged by `mergeRemoteAndPendingEntries`.
- Produces no new persistence format; snapshot keys are `categories`, `archivedCategories`, `entries`, `weeklyBudgets`, `dailyBudgets`, `defaultDayWeights`, `updatedAt`.

- [ ] **Step 1: Add failing fallback contracts**

```js
test('시간 예산과 통계는 캐시 스냅숏 fallback과 pending 기록을 사용한다', async () => {
  const [budget, statistics] = await Promise.all([read('src/time-budget-feature.js'), read('src/statistics-ui.js')]);
  for (const source of [budget, statistics]) {
    assert.ok(source.includes('getSnapshot'));
    assert.ok(source.includes('patchSnapshot'));
    assert.ok(source.includes('mergeRemoteAndPendingEntries'));
  }
});
```

- [ ] **Step 2: Run test and verify RED**

Run: `node --test tests/offline-app-integration.test.js tests/time-budget-integration.test.js`

Expected: FAIL.

- [ ] **Step 3: Refactor load functions to cache-first**

For each module:

1. Load snapshot fields and pending records; render cached data.
2. Attempt Firestore reads.
3. On success replace remote fields, merge pending entries, patch only owned snapshot fields.
4. On retryable failure retain cached values without clearing UI.
5. Dispatch/handle `weekly-time-budget:entries-changed` to recompute dashboard/statistics immediately.

Do not make offline editing of budgets/categories part of this task; only record creation is queued. Disable budget/category save buttons while offline with a concise toast if their Firestore write fails.

- [ ] **Step 4: Test and commit**

Run: `node --test tests/offline-app-integration.test.js tests/time-budget-integration.test.js tests/statistics-ui.test.js`

Expected: PASS.

Run: `npm test`

Expected: PASS.

```bash
git add src/time-budget-feature.js src/statistics-ui.js tests/offline-app-integration.test.js tests/time-budget-integration.test.js
git commit -m "feat: render dashboards and statistics from offline snapshots"
```

---

### Task 9: 서비스 워커와 첫 온라인 실행 캐시 준비

**Files:**
- Create: `src/service-worker-cache.js`
- Create: `service-worker.js`
- Create: `src/service-worker-registration.js`
- Modify: `index.html`
- Test: `tests/service-worker-cache.test.js`
- Test: `tests/offline-app-integration.test.js`

**Interfaces:**
- Produces: `extractModuleSpecifiers(source, baseUrl)`.
- Produces: `cacheModuleGraph({ cache, fetchFn, roots, allowed })`.
- Service worker cache names: `weekly-time-budget-shell-v1`, `weekly-time-budget-runtime-v1`.

- [ ] **Step 1: Write failing module graph tests**

```js
test('Firebase ESM 정적 import 그래프를 재귀 캐시한다', async () => {
  const sources = new Map([
    ['https://www.gstatic.com/firebasejs/11.10.0/firebase-auth.js', `import './firebase-app.js'; import { x } from './firebase-util.js';`],
    ['https://www.gstatic.com/firebasejs/11.10.0/firebase-app.js', 'export const app = 1;'],
    ['https://www.gstatic.com/firebasejs/11.10.0/firebase-util.js', 'export const x = 1;'],
  ]);
  const cached = [];
  await cacheModuleGraph({
    roots: ['https://www.gstatic.com/firebasejs/11.10.0/firebase-auth.js'],
    allowed: (url) => url.startsWith('https://www.gstatic.com/firebasejs/11.10.0/'),
    fetchFn: async (url) => new Response(sources.get(url), { status: 200 }),
    cache: { put: async (url) => cached.push(String(url)) },
  });
  assert.deepEqual(new Set(cached), new Set([...sources.keys()]));
});
```

Add extraction tests for `import 'x'`, `import ... from 'x'`, and duplicate/cyclic imports.

- [ ] **Step 2: Run test and verify RED**

Run: `node --test tests/service-worker-cache.test.js`

Expected: FAIL because module does not exist.

- [ ] **Step 3: Implement cache graph helper**

Parse only static import specifiers using two explicit regexes; resolve with `new URL(specifier, baseUrl)`, deduplicate with `seen`, and reject URLs outside `allowed`. Cache cloned successful responses before recursing. A Firebase warmup failure must not prevent local app shell installation.

- [ ] **Step 4: Implement module service worker**

Precache local shell:

```js
const SHELL_URLS = ['./', './index.html', './styles.css', './manifest.webmanifest', './firebase-config.js', './src/app.js', './src/persistent-timer-ui.js', './src/time-budget-feature.js', './src/statistics-ui.js'];
const FIREBASE_ROOTS = [
  'https://www.gstatic.com/firebasejs/11.10.0/firebase-app.js',
  'https://www.gstatic.com/firebasejs/11.10.0/firebase-auth.js',
  'https://www.gstatic.com/firebasejs/11.10.0/firebase-firestore.js',
];
```

Install: cache shell; separately warm Firebase graph with `Promise.allSettled`. Activate: remove older `weekly-time-budget-*` caches and `clients.claim()`.

Fetch rules:

- Firestore/Auth API requests (`firestore.googleapis.com`, `identitytoolkit.googleapis.com`, `securetoken.googleapis.com`) always network and never cache.
- Navigation requests: network-first, fallback cached `index.html`.
- local same-origin assets and gstatic Firebase modules: cache-first with network fill.
- Other cross-origin requests: plain fetch.

- [ ] **Step 5: Register service worker**

`service-worker-registration.js`:

```js
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('./service-worker.js', { type: 'module', scope: './' }).catch((error) => console.error('서비스 워커 등록 실패', error)));
}
```

Add it before Firebase feature scripts in `index.html`.

- [ ] **Step 6: Run tests and commit**

Run: `node --test tests/service-worker-cache.test.js tests/offline-app-integration.test.js`

Expected: PASS.

```bash
git add src/service-worker-cache.js service-worker.js src/service-worker-registration.js index.html tests/service-worker-cache.test.js tests/offline-app-integration.test.js
git commit -m "feat: cache app shell for offline reopening"
```

---

### Task 10: 대분류 완전 삭제와 오프라인 대기함 연동

**Files:**
- Modify: `src/category-delete-guard.js:47-175`
- Test: `tests/time-budget-integration.test.js`
- Test: `tests/offline-app-integration.test.js`

**Interfaces:**
- Consumes: `offlineStore.countPendingByCategory(userId, categoryId)` and `deletePendingByCategory(userId, categoryId)`.

- [ ] **Step 1: Add failing deletion contracts**

```js
test('완전 삭제 경고와 실행은 같은 사용자의 pending 기록을 포함한다', async () => {
  const source = await read('src/category-delete-guard.js');
  assert.ok(source.includes('countPendingByCategory'));
  assert.ok(source.includes('deletePendingByCategory'));
  assert.ok(source.includes('동기화 대기 기록'));
});
```

- [ ] **Step 2: Run test and verify RED**

Run: `node --test tests/offline-app-integration.test.js tests/time-budget-integration.test.js`

Expected: FAIL.

- [ ] **Step 3: Integrate queue count and deletion**

Count Firestore entries and IndexedDB pending entries separately. Warning copy:

```text
서버 기록 N건과 아직 서버에 반영되지 않은 동기화 대기 기록 M건이 있습니다.
완전 삭제하면 모두 복구할 수 없습니다.
```

Only after Firestore deletion batches succeed, call `deletePendingByCategory(uid, categoryId)`, patch snapshot entries/categories, and dispatch data-change events. If IndexedDB cleanup fails, report that server deletion succeeded but local cleanup needs app restart/retry; do not falsely report full success.

- [ ] **Step 4: Test and commit**

Run: `node --test tests/offline-app-integration.test.js tests/time-budget-integration.test.js`

Expected: PASS.

Run: `npm test`

Expected: PASS.

```bash
git add src/category-delete-guard.js tests/offline-app-integration.test.js tests/time-budget-integration.test.js
git commit -m "fix: include pending entries in permanent category deletion"
```

---

### Task 11: Pages 산출물·CI·전체 회귀 검증

**Files:**
- Modify: `scripts/prepare-pages-site.mjs:210-230`
- Modify: `.github/workflows/ci.yml:29-37`
- Modify: `tests/pages-deploy.test.js`
- Modify: `tests/offline-app-integration.test.js`

**Interfaces:**
- Pages artifact must include `service-worker.js`, all `src/offline-*.js`, `src/app-toast.js`, `src/ui-session-state.js`, and `src/service-worker-*.js`.

- [ ] **Step 1: Add failing Pages artifact test**

```js
test('Pages 산출물에 오프라인 실행 파일이 모두 포함된다', async () => {
  const outputDir = await preparePagesSite({ rootDir, outputDir: tempDir, env: testFirebaseEnv });
  for (const file of [
    'service-worker.js',
    'src/offline-entry-domain.js',
    'src/offline-store.js',
    'src/offline-entry-repository.js',
    'src/offline-sync.js',
    'src/app-toast.js',
    'src/ui-session-state.js',
    'src/service-worker-cache.js',
    'src/service-worker-registration.js',
  ]) await access(path.join(outputDir, file));
});
```

- [ ] **Step 2: Run test and verify RED**

Run: `node --test tests/pages-deploy.test.js`

Expected: FAIL because root `service-worker.js` is not copied.

- [ ] **Step 3: Copy service worker and strengthen CI checks**

In `preparePagesSite`, add:

```js
await cp(path.join(rootDir, 'service-worker.js'), path.join(outputDir, 'service-worker.js'));
```

Extend the CI shell checks for every file listed above. Keep current Node 22 and existing failed-test artifact upload.

- [ ] **Step 4: Run syntax checks and complete test suite**

Run:

```bash
node --check src/offline-entry-domain.js
node --check src/offline-store.js
node --check src/offline-entry-repository.js
node --check src/offline-sync.js
node --check src/app-toast.js
node --check src/ui-session-state.js
node --check src/service-worker-cache.js
node --check service-worker.js
node --check src/service-worker-registration.js
npm test
```

Expected: every command exits `0`.

- [ ] **Step 5: Build and inspect Pages artifact**

Run:

```bash
FIREBASE_API_KEY=test-api-key \
FIREBASE_AUTH_DOMAIN=test.firebaseapp.com \
FIREBASE_PROJECT_ID=test-project \
FIREBASE_STORAGE_BUCKET=test.firebasestorage.app \
FIREBASE_MESSAGING_SENDER_ID=123456789 \
FIREBASE_APP_ID=1:123456789:web:test \
npm run prepare:pages

test -f _site/service-worker.js
test -f _site/src/offline-store.js
test -f _site/src/offline-entry-repository.js
test -f _site/src/offline-sync.js
test -f _site/src/ui-session-state.js
```

Expected: artifact preparation message and all file checks succeed.

- [ ] **Step 6: Manual browser verification**

Run: `npm start`.

Verify in this order:

1. Online login and one normal manual record: bottom toast says server saved.
2. DevTools offline, manual record: toast says safely stored and history shows `동기화 대기`.
3. Reload while offline: previous menu/internal tab and pending record remain.
4. End a timer offline: timer clears only after IndexedDB save and pending record appears.
5. Restore network: one sync-complete toast appears and pending badge disappears without duplicate history.
6. Close/reopen app from dashboard weekly, record manual duration, budget week, and each statistics mode; each last state restores.
7. Log out and sign in with another account: first account's pending records and UI state do not appear.
8. Permanently delete a category with pending entries: warning counts both server and pending records, then both disappear.

- [ ] **Step 7: Commit final deployment changes**

```bash
git add scripts/prepare-pages-site.mjs .github/workflows/ci.yml tests/pages-deploy.test.js tests/offline-app-integration.test.js
git commit -m "test: verify offline sync deployment artifact"
```

---

## Final Review Checklist

- [ ] Every record path writes IndexedDB before claiming success.
- [ ] Manual and timer records share identical `localId`/Firestore document ID behavior.
- [ ] Retryable errors remain pending; permanent errors show failed/retry UI.
- [ ] A single user has at most one active flush Promise.
- [ ] Pending records appear immediately in history, dashboard, and statistics.
- [ ] Remote active timer deletion is conditional on matching UID and `startedAt`.
- [ ] IndexedDB data and UI state never cross user IDs.
- [ ] Service worker excludes Firestore/Auth API responses from caches.
- [ ] Last menu and all requested internal tabs/periods restore with future limits clamped.
- [ ] Full `npm test` and `npm run prepare:pages` pass before opening or merging the PR.
