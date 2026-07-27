# 오프라인 기록 동기화·저장 확인·화면 복원 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 인터넷이 없거나 불안정해도 수동 입력과 타이머 기록을 기기에 먼저 안전하게 저장하고 자동 동기화하며, 저장 결과와 마지막 메뉴·내부 탭을 명확히 복원한다.

**Architecture:** IndexedDB에 사용자별 대기 기록·데이터 스냅숏·UI 상태를 저장한다. 모든 기록은 동일한 `localId`를 IndexedDB 키와 Firestore 문서 ID로 사용하며, `offline-runtime.js`가 앱과 타이머에 하나의 저장소·기록 저장소·동기화 코디네이터를 공유한다. 모듈형 서비스 워커는 앱 셸과 Firebase ESM 의존성 그래프를 캐시해 이전 로그인 사용자의 오프라인 재실행을 지원한다.

**Tech Stack:** Vanilla JavaScript ES modules, Firebase Auth/Firestore 11.10.0, IndexedDB, Service Worker module, Node.js 22 `node:test`, `fake-indexeddb` 6.2.5, GitHub Pages.

## Global Constraints

- 오프라인 사용은 이 기기에서 이전에 로그인한 동일 사용자만 허용한다.
- 로그인하지 않은 임시 기록은 만들지 않는다.
- 수동 입력과 타이머 기록 모두 IndexedDB 저장이 성공한 뒤에만 저장 성공으로 표시한다.
- `navigator.onLine`은 힌트로만 사용하고 실제 Firestore 쓰기 결과로 최종 상태를 판정한다.
- Firestore 문서 ID는 IndexedDB의 `localId`와 동일해야 한다.
- iOS의 Background Sync API에는 의존하지 않는다.
- 저장 알림은 확인 버튼 없는 하단 토스트이며 기본 4초, 오류는 7초 표시한다.
- 마지막 메뉴와 대시보드·기록·시간 예산·통계 내부 상태를 사용자별로 복원한다.
- 미래 날짜와 미래 주는 기존 제한에 맞춰 오늘 또는 이번 주로 보정한다.
- 기존 통계 계산, 대분류 보관/완전 삭제, 로그인, 모바일 레이아웃을 회귀시키지 않는다.

---

## File Map

**Create**

- `src/offline-entry-domain.js`: 대기 기록 생성, 오류 분류, 기록 병합 순수 로직.
- `src/offline-store.js`: IndexedDB 스키마와 사용자별 CRUD.
- `src/offline-entry-repository.js`: local-first 저장과 Firestore 원격 어댑터.
- `src/offline-sync.js`: 사용자별 단일 실행 자동 동기화.
- `src/offline-runtime.js`: 앱·타이머가 공유하는 사용자별 런타임 싱글턴.
- `src/app-toast.js`: 저장·대기·동기화·오류 토스트.
- `src/ui-session-state.js`: UI 상태 기본값·정규화·기간 보정.
- `src/service-worker-cache.js`: ESM 의존성 그래프 캐시 함수.
- `service-worker.js`: 앱 셸·Firebase 모듈 캐시와 탐색 fallback.
- `src/service-worker-registration.js`: 모듈형 서비스 워커 등록.
- `tests/offline-entry-domain.test.js`
- `tests/offline-store.test.js`
- `tests/offline-entry-repository.test.js`
- `tests/offline-sync.test.js`
- `tests/ui-session-state.test.js`
- `tests/service-worker-cache.test.js`
- `tests/offline-app-integration.test.js`

**Modify**

- `package.json`, `package-lock.json`: `fake-indexeddb` 6.2.5 개발 의존성.
- `src/app.js`: 캐시 우선 초기화, 수동 기록 저장, pending 병합, 기록 상태·메뉴 상태.
- `src/persistent-timer.js`, `src/persistent-timer-ui.js`: 오프라인 시작·종료.
- `src/time-budget-feature.js`: 캐시 fallback과 대시보드·예산 탭 복원.
- `src/statistics-ui.js`: 캐시 fallback과 통계 상태 복원.
- `src/category-delete-guard.js`: 대기 기록 경고·삭제.
- `index.html`, `styles.css`: 서비스 워커 등록, 토스트·상태 배지.
- `scripts/prepare-pages-site.mjs`, `.github/workflows/ci.yml`: 배포 산출물.

---

### Task 1: 대기 기록과 UI 상태 순수 로직

**Files:**
- Create: `src/offline-entry-domain.js`
- Create: `src/ui-session-state.js`
- Test: `tests/offline-entry-domain.test.js`
- Test: `tests/ui-session-state.test.js`

**Interfaces:**
- `createPendingEntry({ userId, entry, localId, createdAt, clearActiveTimer })`.
- `classifySyncError(error) -> 'retryable' | 'permanent'`.
- `mergeRemoteAndPendingEntries(remoteEntries, pendingRecords)`.
- `createDefaultUiState({ today, currentWeekStart })`.
- `normalizeUiState(raw, { today, currentWeekStart, validViews })`.

- [ ] **Step 1: Write failing tests**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { createPendingEntry, classifySyncError, mergeRemoteAndPendingEntries } from '../src/offline-entry-domain.js';

test('pending 기록은 사용자·대분류·동일 문서 ID를 보존한다', () => {
  const record = createPendingEntry({
    userId: 'u1', localId: 'local-1', createdAt: 1000,
    entry: { categoryId: 'reading', date: '2026-07-27', durationMinutes: 30 },
  });
  assert.deepEqual(record, {
    localId: 'local-1', userId: 'u1', categoryId: 'reading',
    entry: { id: 'local-1', categoryId: 'reading', date: '2026-07-27', durationMinutes: 30 },
    status: 'pending', attempts: 0, createdAt: 1000, lastAttemptAt: null, lastError: null, clearActiveTimer: null,
  });
});

test('pending 또는 failed 상태가 같은 ID의 원격 기록보다 우선한다', () => {
  const merged = mergeRemoteAndPendingEntries(
    [{ id: 'a', createdAt: 1000 }, { id: 'b', createdAt: 2000 }],
    [{ localId: 'b', createdAt: 2000, status: 'pending', entry: { id: 'b', createdAt: 2000 } },
     { localId: 'c', createdAt: 3000, status: 'failed', entry: { id: 'c', createdAt: 3000 } }],
  );
  assert.deepEqual(merged.map((item) => [item.id, item.syncStatus]), [['c', 'failed'], ['b', 'pending'], ['a', 'synced']]);
});

test('네트워크 오류만 자동 재시도한다', () => {
  assert.equal(classifySyncError({ code: 'unavailable' }), 'retryable');
  assert.equal(classifySyncError({ code: 'auth/network-request-failed' }), 'retryable');
  assert.equal(classifySyncError({ code: 'permission-denied' }), 'permanent');
  assert.equal(classifySyncError({ code: 'invalid-argument' }), 'permanent');
});
```

```js
import { createDefaultUiState, normalizeUiState } from '../src/ui-session-state.js';

test('메뉴와 내부 탭을 유지하고 미래 기간을 현재로 보정한다', () => {
  const value = normalizeUiState({
    activeView: 'statistics',
    dashboard: { mode: 'weekly', selectedDate: '2026-08-10', selectedWeekStart: '2026-08-10', calendarYear: 2026, calendarMonth: 8 },
    record: { tab: 'manual', manualMode: 'duration' },
    budget: { mode: 'week' },
    statistics: { mode: 'monthly-comparison', weekStart: '2026-08-10', year: 2028, month: 12 },
  }, { today: '2026-07-27', currentWeekStart: '2026-07-27', validViews: ['dashboard','record','budget','history','statistics','categories'] });
  assert.equal(value.activeView, 'statistics');
  assert.equal(value.dashboard.selectedDate, '2026-07-27');
  assert.equal(value.dashboard.selectedWeekStart, '2026-07-27');
  assert.deepEqual(value.record, { tab: 'manual', manualMode: 'duration' });
  assert.equal(value.statistics.year, 2026);
  assert.equal(value.statistics.month, 7);
});

test('지원하지 않는 값은 안전한 기본값으로 돌아간다', () => {
  const defaults = createDefaultUiState({ today: '2026-07-27', currentWeekStart: '2026-07-27' });
  const value = normalizeUiState({ activeView: 'missing', record: { tab: 'other', manualMode: 'other' } }, {
    today: '2026-07-27', currentWeekStart: '2026-07-27', validViews: ['dashboard','record'],
  });
  assert.equal(value.activeView, 'dashboard');
  assert.deepEqual(value.record, defaults.record);
});
```

- [ ] **Step 2: Verify RED**

Run: `node --test tests/offline-entry-domain.test.js tests/ui-session-state.test.js`

Expected: FAIL with `ERR_MODULE_NOT_FOUND`.

- [ ] **Step 3: Implement the pure modules**

`offline-entry-domain.js` must include top-level `categoryId` for IndexedDB indexing and deterministic numeric sorting:

```js
const RETRYABLE_CODES = new Set(['unavailable', 'deadline-exceeded', 'resource-exhausted', 'auth/network-request-failed']);
export function createPendingEntry({ userId, entry, localId, createdAt = Date.now(), clearActiveTimer = null }) {
  if (!userId || !localId || !entry?.categoryId) throw new Error('사용자, 기록 ID, 대분류가 필요합니다.');
  return { localId, userId, categoryId: entry.categoryId, entry: { ...entry, id: localId }, status: 'pending', attempts: 0, createdAt, lastAttemptAt: null, lastError: null, clearActiveTimer };
}
export function classifySyncError(error = {}) {
  const code = String(error.code || '').replace(/^(firestore|auth)\//, '');
  return RETRYABLE_CODES.has(code) || /network|offline|failed to fetch/i.test(String(error.message || '')) ? 'retryable' : 'permanent';
}
export function mergeRemoteAndPendingEntries(remoteEntries = [], pendingRecords = []) {
  const map = new Map(remoteEntries.map((entry) => [entry.id, { ...entry, syncStatus: 'synced' }]));
  pendingRecords.forEach((record) => map.set(record.localId, { ...record.entry, id: record.localId, createdAt: record.createdAt, syncStatus: record.status }));
  return [...map.values()].sort((a, b) => Number(b.createdAt?.toMillis?.() ?? b.createdAt ?? 0) - Number(a.createdAt?.toMillis?.() ?? a.createdAt ?? 0));
}
```

`ui-session-state.js` must explicitly allow:

```js
const RECORD_TABS = new Set(['timer', 'manual']);
const MANUAL_MODES = new Set(['time-range', 'duration']);
const DASHBOARD_MODES = new Set(['daily', 'weekly']);
const BUDGET_MODES = new Set(['today', 'week']);
const STATISTICS_MODES = new Set(['weekly', 'monthly', 'yearly', 'monthly-comparison', 'yearly-comparison']);
```

Return a complete object even when `raw` is partial. Clamp dashboard date/week and statistics week to current values. Derive current year/month from `today` and clamp future statistics year/month.

- [ ] **Step 4: Verify GREEN and commit**

Run: `node --test tests/offline-entry-domain.test.js tests/ui-session-state.test.js`

Expected: PASS.

```bash
git add src/offline-entry-domain.js src/ui-session-state.js tests/offline-entry-domain.test.js tests/ui-session-state.test.js
git commit -m "feat: add offline entry and UI state domain logic"
```

---

### Task 2: 실제 IndexedDB 사용자별 저장소

**Files:**
- Modify: `package.json`, `package-lock.json`
- Create: `src/offline-store.js`
- Test: `tests/offline-store.test.js`

**Interfaces:**
- `createOfflineStore({ indexedDB, IDBKeyRange, dbName })`.
- Methods: `putPending`, `getPending`, `getPendingById`, `updatePending`, `deletePending`, `countPending`, `countPendingByCategory`, `deletePendingByCategory`, `getSnapshot`, `patchSnapshot`, `getUiState`, `putUiState`.

- [ ] **Step 1: Install the test-only IndexedDB implementation**

Run: `npm install --save-dev fake-indexeddb@6.2.5`

Expected: `package.json` and `package-lock.json` change; production bundle remains dependency-free because test code alone imports the package.

- [ ] **Step 2: Write failing IndexedDB tests**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { indexedDB, IDBKeyRange } from 'fake-indexeddb';
import { createOfflineStore } from '../src/offline-store.js';

const newStore = () => createOfflineStore({ indexedDB, IDBKeyRange, dbName: `test-${crypto.randomUUID()}` });

test('pending 기록은 사용자별·생성 순서대로 격리된다', async () => {
  const store = await newStore();
  await store.putPending({ localId: 'b', userId: 'u1', categoryId: 'reading', createdAt: 2, status: 'pending', entry: {} });
  await store.putPending({ localId: 'a', userId: 'u1', categoryId: 'reading', createdAt: 1, status: 'pending', entry: {} });
  await store.putPending({ localId: 'x', userId: 'u2', categoryId: 'reading', createdAt: 0, status: 'pending', entry: {} });
  assert.deepEqual((await store.getPending('u1')).map((item) => item.localId), ['a', 'b']);
  assert.equal(await store.countPending('u1'), 2);
  assert.equal(await store.countPendingByCategory('u1', 'reading'), 2);
});

test('snapshot 부분 갱신은 다른 모듈의 필드를 지우지 않는다', async () => {
  const store = await newStore();
  await store.patchSnapshot('u1', { categories: [{ id: 'reading' }] });
  await store.patchSnapshot('u1', { entries: [{ id: 'e1' }] });
  assert.deepEqual(await store.getSnapshot('u1'), { userId: 'u1', categories: [{ id: 'reading' }], entries: [{ id: 'e1' }] });
});

test('UI 상태와 대분류별 pending 삭제가 사용자 경계를 지킨다', async () => {
  const store = await newStore();
  await store.putPending({ localId: 'a', userId: 'u1', categoryId: 'reading', createdAt: 1, status: 'pending', entry: {} });
  await store.putPending({ localId: 'b', userId: 'u2', categoryId: 'reading', createdAt: 1, status: 'pending', entry: {} });
  await store.deletePendingByCategory('u1', 'reading');
  assert.equal(await store.countPending('u1'), 0);
  assert.equal(await store.countPending('u2'), 1);
  await store.putUiState('u1', { activeView: 'record' });
  assert.deepEqual(await store.getUiState('u1'), { activeView: 'record' });
});
```

- [ ] **Step 3: Verify RED**

Run: `node --test tests/offline-store.test.js`

Expected: FAIL because `src/offline-store.js` does not exist.

- [ ] **Step 4: Implement IndexedDB schema and every method**

Database: `weekly-time-budget-offline`, version `1`.

```js
function upgrade(db) {
  const pending = db.createObjectStore('pendingEntries', { keyPath: 'localId' });
  pending.createIndex('userCreatedAt', ['userId', 'createdAt']);
  pending.createIndex('userCategory', ['userId', 'categoryId']);
  db.createObjectStore('userSnapshots', { keyPath: 'userId' });
  db.createObjectStore('uiState', { keyPath: 'userId' });
}
```

Use `IDBKeyRange.bound([userId, 0], [userId, Number.MAX_SAFE_INTEGER])` for ordered pending reads and `IDBKeyRange.only([userId, categoryId])` for category count/delete. `patchSnapshot` must read and put `{ ...existing, ...partial, userId }` within one readwrite transaction. Store UI as `{ userId, state }` and return only `state`.

The returned object must implement all declared methods by calling transaction helpers; `updatePending` and `putPending` both use `put`, while `deletePendingByCategory` deletes every cursor result from the composite index.

- [ ] **Step 5: Verify GREEN and commit**

Run: `node --test tests/offline-store.test.js`

Expected: PASS.

```bash
git add package.json package-lock.json src/offline-store.js tests/offline-store.test.js
git commit -m "feat: add user-scoped IndexedDB offline store"
```

---

### Task 3: 기록 저장소, Firestore 어댑터, 공유 런타임, 자동 동기화

**Files:**
- Create: `src/offline-entry-repository.js`
- Create: `src/offline-sync.js`
- Create: `src/offline-runtime.js`
- Test: `tests/offline-entry-repository.test.js`
- Test: `tests/offline-sync.test.js`

**Interfaces:**
- `createFirestoreEntryRemote({ db, firestore })` with `save(record)`.
- `createOfflineEntryRepository({ store, remote, createId, now })`.
- Repository methods: `saveEntryLocalFirst`, `flushPendingEntries`, `retryEntry`, `mergeEntries`.
- `createOfflineSyncCoordinator({ repository, userId, eventTarget, documentTarget })`.
- `configureOfflineRuntime({ userId, indexedDB, IDBKeyRange, remote, eventTarget, documentTarget })`.
- `getOfflineRuntime(userId)`, `disposeOfflineRuntime()`.

- [ ] **Step 1: Write failing repository tests**

```js
test('원격 성공 전에도 IndexedDB에 먼저 기록한다', async () => {
  const calls = [];
  const store = await createTestStore();
  const repository = createOfflineEntryRepository({
    store, createId: () => 'e1', now: () => 1000,
    remote: { save: async (record) => { calls.push((await store.getPendingById(record.localId))?.localId); } },
  });
  const result = await repository.saveEntryLocalFirst({ userId: 'u1', entry: { categoryId: 'reading', date: '2026-07-27', durationMinutes: 30 } });
  assert.deepEqual(calls, ['e1']);
  assert.equal(result.status, 'synced');
  assert.equal(await store.countPending('u1'), 0);
});

test('네트워크 실패는 queued, 권한 실패는 failed로 보존한다', async () => {
  const store = await createTestStore();
  const network = createOfflineEntryRepository({ store, createId: () => 'n1', remote: { save: async () => { throw Object.assign(new Error('offline'), { code: 'unavailable' }); } } });
  assert.equal((await network.saveEntryLocalFirst({ userId: 'u1', entry: { categoryId: 'reading' } })).status, 'queued');
  const denied = createOfflineEntryRepository({ store, createId: () => 'p1', remote: { save: async () => { throw Object.assign(new Error('denied'), { code: 'permission-denied' }); } } });
  assert.equal((await denied.saveEntryLocalFirst({ userId: 'u1', entry: { categoryId: 'reading' } })).status, 'failed');
  assert.equal((await store.getPendingById('p1')).status, 'failed');
});

test('같은 localId 재시도는 같은 원격 문서를 사용한다', async () => {
  const ids = [];
  const store = await createTestStore();
  const repository = createOfflineEntryRepository({ store, createId: () => 'same', remote: { save: async (record) => ids.push(record.localId) } });
  await repository.saveEntryLocalFirst({ userId: 'u1', localId: 'same', entry: { categoryId: 'reading' } });
  await store.putPending(createPendingEntry({ userId: 'u1', localId: 'same', entry: { categoryId: 'reading' } }));
  await repository.flushPendingEntries('u1');
  assert.deepEqual(ids, ['same', 'same']);
});
```

- [ ] **Step 2: Write failing coordinator/runtime tests**

```js
test('동시 flush는 같은 Promise를 공유한다', async () => {
  let calls = 0;
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const coordinator = createOfflineSyncCoordinator({
    userId: 'u1', repository: { flushPendingEntries: async () => { calls += 1; await gate; return { syncedCount: 1, pendingCount: 0, failedCount: 0 }; } },
    eventTarget: new EventTarget(), documentTarget: new EventTarget(),
  });
  const first = coordinator.flush('online');
  const second = coordinator.flush('visible');
  assert.equal(first, second);
  release();
  await first;
  assert.equal(calls, 1);
});

test('같은 사용자 configure는 동일 런타임을 반환한다', async () => {
  const first = await configureTestRuntime('u1');
  const second = await configureTestRuntime('u1');
  assert.equal(first, second);
  disposeOfflineRuntime();
});
```

- [ ] **Step 3: Verify RED**

Run: `node --test tests/offline-entry-repository.test.js tests/offline-sync.test.js`

Expected: FAIL with missing modules.

- [ ] **Step 4: Implement repository and idempotent Firestore remote**

Repository algorithm: `putPending` → `remote.save` → success deletes local pending; retryable failure leaves `pending`; permanent failure writes `failed`. `flushPendingEntries` processes creation order, skips failed records, and continues after retryable errors.

Firestore remote must read conditional active timer before any transaction write:

```js
export function createFirestoreEntryRemote({ db, firestore }) {
  return { async save(record) {
    const entryRef = firestore.doc(db, 'users', record.userId, 'entries', record.localId);
    await firestore.runTransaction(db, async (transaction) => {
      let activeRef = null;
      let active = null;
      if (record.clearActiveTimer) {
        activeRef = firestore.doc(db, 'users', record.userId, 'activeTimer', 'current');
        active = await transaction.get(activeRef);
      }
      transaction.set(entryRef, { ...record.entry, localCreatedAt: record.createdAt, createdAt: firestore.serverTimestamp() }, { merge: true });
      if (activeRef && active.exists() && active.data().userId === record.clearActiveTimer.userId && Number(active.data().startedAt) === Number(record.clearActiveTimer.startedAt)) transaction.delete(activeRef);
    });
  } };
}
```

- [ ] **Step 5: Implement coordinator and shared runtime**

Coordinator keeps one `inFlight` Promise, listens to `online` and visible `visibilitychange`, and dispatches `weekly-time-budget:sync-result` with `{ reason, syncedCount, pendingCount, failedCount }` after each completed flush.

Runtime owns exactly one active user:

```js
let current = null;
export async function configureOfflineRuntime(options) {
  if (current?.userId === options.userId) return current;
  current?.coordinator.stop();
  const store = await createOfflineStore(options);
  const repository = createOfflineEntryRepository({ store, remote: options.remote });
  const coordinator = createOfflineSyncCoordinator({ repository, userId: options.userId, eventTarget: options.eventTarget, documentTarget: options.documentTarget });
  current = { userId: options.userId, store, repository, coordinator };
  coordinator.start();
  return current;
}
export function getOfflineRuntime(userId) { return current?.userId === userId ? current : null; }
export function disposeOfflineRuntime() { current?.coordinator.stop(); current = null; }
```

- [ ] **Step 6: Verify GREEN and commit**

Run: `node --test tests/offline-entry-repository.test.js tests/offline-sync.test.js`

Expected: PASS.

```bash
git add src/offline-entry-repository.js src/offline-sync.js src/offline-runtime.js tests/offline-entry-repository.test.js tests/offline-sync.test.js
git commit -m "feat: add shared local-first synchronization runtime"
```

---

### Task 4: 저장 결과 토스트와 동기화 상태 스타일

**Files:**
- Create: `src/app-toast.js`
- Modify: `styles.css`
- Test: `tests/offline-app-integration.test.js`

- [ ] **Step 1: Write failing source-contract test**

```js
test('토스트는 서버 저장·대기·동기화 완료 문구와 safe-area 스타일을 제공한다', async () => {
  const [toast, css] = await Promise.all([read('src/app-toast.js'), read('styles.css')]);
  for (const text of ['기록을 서버에 저장했습니다', '기기에 안전하게 저장했습니다', '인터넷 연결 시 자동으로 반영됩니다', '대기 중이던 기록']) assert.ok(toast.includes(text));
  for (const token of ['env(safe-area-inset-bottom)', '.app-toast', '.sync-status.pending', '.sync-status.failed']) assert.ok(css.includes(token));
});
```

- [ ] **Step 2: Verify RED**

Run: `node --test tests/offline-app-integration.test.js`

Expected: FAIL because `app-toast.js` does not exist.

- [ ] **Step 3: Implement toast API and listener**

```js
export function showEntrySaveResult(result) {
  if (result.status === 'synced') return showToast({ type: 'success', title: '✓ 기록을 서버에 저장했습니다.' });
  if (result.status === 'queued') return showToast({ type: 'queued', title: '✓ 기기에 안전하게 저장했습니다.', message: `인터넷 연결 시 자동으로 반영됩니다. · 동기화 대기 ${result.pendingCount}건` });
  return showToast({ type: 'error', title: '✓ 기기에 기록을 저장했습니다.', message: '서버 동기화에 실패했습니다. 기록 내역에서 다시 시도하세요.', duration: 7000 });
}
export function showSyncResult({ syncedCount }) {
  if (syncedCount > 0) showToast({ type: 'success', title: `✓ 대기 중이던 기록 ${syncedCount}건을 서버에 반영했습니다.` });
}
```

Create one `#app-toast-region` with `aria-live="polite"`. Default duration 4000ms; error 7000ms. Listen for `weekly-time-budget:sync-result` and call `showSyncResult`. Position at `bottom: calc(16px + env(safe-area-inset-bottom));`.

- [ ] **Step 4: Verify GREEN and commit**

Run: `node --test tests/offline-app-integration.test.js`

Expected: PASS.

```bash
git add src/app-toast.js styles.css tests/offline-app-integration.test.js
git commit -m "feat: show entry save and synchronization status"
```

---

### Task 5: 앱 캐시 우선 초기화와 수동 기록 저장

**Files:**
- Modify: `src/app.js:17-175, 234-322`
- Modify: `index.html:70-79`
- Test: `tests/offline-app-integration.test.js`

- [ ] **Step 1: Add failing integration contracts**

```js
test('app은 공유 런타임과 local-first 저장을 사용한다', async () => {
  const source = await read('src/app.js');
  for (const token of ['configureOfflineRuntime', 'createFirestoreEntryRemote', 'mergeRemoteAndPendingEntries', 'showEntrySaveResult', 'patchSnapshot']) assert.ok(source.includes(token), token);
  const start = source.indexOf('async function saveEntry');
  const end = source.indexOf('async function deleteEntry', start);
  assert.doesNotMatch(source.slice(start, end), /addDoc\(/);
  assert.match(source.slice(start, end), /saveEntryLocalFirst/);
});

test('기록 내역은 동기화 대기·실패·재시도를 표시한다', async () => {
  const source = await read('src/app.js');
  for (const token of ['동기화 대기', '동기화 실패', 'data-retry-entry', 'retryEntry']) assert.ok(source.includes(token));
});
```

- [ ] **Step 2: Verify RED**

Run: `node --test tests/offline-app-integration.test.js`

Expected: FAIL on missing integration tokens.

- [ ] **Step 3: Split remote loading from state application**

Add `applySnapshotToState(snapshot)`, `loadRemoteData()`, and `refreshMergedEntries()`. Auth flow:

1. Set `browserLocalPersistence`.
2. Configure shared runtime with `createFirestoreEntryRemote`.
3. Read snapshot and UI state; render cached categories/entries/budget immediately.
4. Try Firestore reads; on success patch snapshot and merge pending.
5. On retryable failure keep cached UI and show `오프라인 상태입니다. 새 기록은 기기에 저장됩니다.` once.
6. If no cached categories exist, disable record controls and show `온라인에서 한 번 실행한 뒤 사용할 수 있습니다.`

`refreshMergedEntries` must call:

```js
const pending = await runtime.store.getPending(state.user.uid);
state.entries = mergeRemoteAndPendingEntries(remoteEntries, pending);
```

- [ ] **Step 4: Replace `saveEntry` after IndexedDB success only**

```js
async function saveEntry(entry) {
  const result = await runtime.repository.saveEntryLocalFirst({ userId: state.user.uid, entry });
  const pending = await runtime.store.getPending(state.user.uid);
  const withoutSameId = state.entries.filter((item) => item.id !== result.localId && item.syncStatus === 'synced');
  state.entries = mergeRemoteAndPendingEntries([...withoutSameId, result.entry], pending);
  await runtime.store.patchSnapshot(state.user.uid, { entries: state.entries });
  renderDashboard(); renderHistory();
  showEntrySaveResult(result);
  document.dispatchEvent(new CustomEvent('weekly-time-budget:entries-changed', { detail: { entries: state.entries, pendingCount: result.pendingCount } }));
  return result;
}
```

Disable `기록 저장` while awaiting. Reset form only after `saveEntry` returns `synced`, `queued`, or `failed`; all three mean IndexedDB succeeded. If IndexedDB throws, keep every field and show a 7-second storage error toast.

- [ ] **Step 5: Make history deletion/retry queue-aware**

- pending/failed delete: remove IndexedDB item and local snapshot; do not call Firestore.
- synced delete: retain current Firestore delete path.
- failed retry: `runtime.repository.retryEntry(uid, localId)`, refresh, show result toast.
- render `.sync-status.pending` or `.sync-status.failed` beside the record.

- [ ] **Step 6: Load modules and verify**

Add `app-toast.js` import through app.js and `service-worker-registration.js` as the first feature script in `index.html`. Do not add a second form-submit interceptor.

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

### Task 6: 타이머 오프라인 시작·종료

**Files:**
- Modify: `src/persistent-timer.js:35-109`
- Modify: `src/persistent-timer-ui.js:32-169`
- Test: `tests/persistent-timer.test.js`
- Test: `tests/offline-app-integration.test.js`

- [ ] **Step 1: Write failing controller tests**

```js
test('원격 조회가 실패해도 로컬 타이머를 시작한다', async () => {
  const storage = memoryStorage();
  const controller = createPersistentTimerController({
    storage, storageKey: 'timer', now: () => 1000,
    remote: { get: async () => { throw Object.assign(new Error('offline'), { code: 'unavailable' }); }, set: async () => {}, remove: async () => {} },
    complete: async () => ({ status: 'queued' }),
  });
  const result = await controller.start({ userId: 'u1', categoryId: 'reading', startedDate: '2026-07-27' });
  assert.equal(result.remotePending, true);
  assert.equal(controller.active.startedAt, 1000);
  assert.ok(storage.getItem('timer'));
});

test('IndexedDB 종료 저장 실패 시 타이머를 유지한다', async () => {
  const controller = configuredController({ complete: async () => { throw new Error('indexeddb failed'); } });
  await controller.start({ userId: 'u1', categoryId: 'reading', startedDate: '2026-07-27' });
  await assert.rejects(() => controller.stop(() => ({ categoryId: 'reading', durationMinutes: 1 })), /indexeddb failed/);
  assert.ok(controller.active);
});
```

- [ ] **Step 2: Verify RED**

Run: `node --test tests/persistent-timer.test.js`

Expected: FAIL because start and completion are remote-first.

- [ ] **Step 3: Modify controller contract**

`start` writes local state before remote calls. If `remote.get()` returns an existing timer, replace local with it. If get/set fails, retain local and return `{ timer, recovered: false, remotePending: true }`. Add `syncActive()` to retry only the same local timer and never overwrite a different remote timer.

`stop(buildEntry)` calls injected `complete(active, entry)`; clear local timer only after it returns. `cancel` remains conservative: remote remove failure retains local timer.

- [ ] **Step 4: Integrate shared runtime in timer UI**

Both app.js and timer UI call `configureOfflineRuntime`; same UID returns the same runtime. Completion:

```js
complete: async (timer, entry) => runtime.repository.saveEntryLocalFirst({
  userId: timer.userId,
  localId: `timer-${Math.round(timer.startedAt)}`,
  entry,
  clearActiveTimer: { userId: timer.userId, startedAt: timer.startedAt },
})
```

After stop, show `showEntrySaveResult(result)` and dispatch `weekly-time-budget:entries-changed` plus existing data-change event. Call `syncActive()` on `online` and visible `visibilitychange`.

- [ ] **Step 5: Verify and commit**

Run: `node --test tests/persistent-timer.test.js tests/offline-app-integration.test.js`

Expected: PASS.

Run: `npm test`

Expected: PASS.

```bash
git add src/persistent-timer.js src/persistent-timer-ui.js tests/persistent-timer.test.js tests/offline-app-integration.test.js
git commit -m "feat: support offline timer recording"
```

---

### Task 7: 마지막 메뉴와 모든 내부 상태 복원

**Files:**
- Modify: `src/app.js`
- Modify: `src/time-budget-feature.js`
- Modify: `src/statistics-ui.js`
- Test: `tests/ui-session-state.test.js`
- Test: `tests/offline-app-integration.test.js`

- [ ] **Step 1: Add failing contracts**

```js
test('각 화면은 복원 이벤트를 받고 변경 상태를 저장한다', async () => {
  const [app, budget, statistics] = await Promise.all([read('src/app.js'), read('src/time-budget-feature.js'), read('src/statistics-ui.js')]);
  assert.ok(app.includes('getUiState'));
  assert.ok(app.includes('putUiState'));
  for (const source of [budget, statistics]) {
    assert.ok(source.includes('weekly-time-budget:ui-state-restored'));
    assert.ok(source.includes('weekly-time-budget:save-ui-state'));
  }
});
```

- [ ] **Step 2: Verify RED**

Run: `node --test tests/ui-session-state.test.js tests/offline-app-integration.test.js`

Expected: FAIL.

- [ ] **Step 3: Add one partial-state writer in app.js**

On `weekly-time-budget:save-ui-state`, read current state, deep-merge only `dashboard`, `record`, `budget`, or `statistics`, normalize, and write through `putUiState`. Before first authenticated render assign record tab/mode and dispatch `weekly-time-budget:ui-state-restored` with the normalized complete state.

Every side menu click saves `activeView`. Record tab and manual mode changes save `record`. If active view is statistics, let statistics-ui open its own view after the restore event.

- [ ] **Step 4: Connect feature module state**

`time-budget-feature.js` applies saved dashboard/budget state before initial render and emits partial state after tab, date, calendar, week, and budget mode changes. Reapply existing future guards after restoration.

`statistics-ui.js` applies `mode`, `weekStart`, `year`, `month` before render and emits after every tab/period change. If restored `activeView` is statistics, call existing `showStatisticsView` exactly once.

- [ ] **Step 5: Verify and commit**

Run: `node --test tests/ui-session-state.test.js tests/offline-app-integration.test.js tests/statistics-ui.test.js tests/time-budget-integration.test.js`

Expected: PASS.

Run: `npm test`

Expected: PASS.

```bash
git add src/app.js src/time-budget-feature.js src/statistics-ui.js tests/ui-session-state.test.js tests/offline-app-integration.test.js
git commit -m "feat: restore last menu and internal tabs"
```

---

### Task 8: 대시보드·시간 예산·통계의 캐시 fallback

**Files:**
- Modify: `src/time-budget-feature.js:94-166`
- Modify: `src/statistics-ui.js` data-loading functions
- Test: `tests/offline-app-integration.test.js`
- Test: `tests/time-budget-integration.test.js`

- [ ] **Step 1: Add failing contracts**

```js
test('시간 예산과 통계는 snapshot과 pending 기록을 사용한다', async () => {
  const [budget, statistics] = await Promise.all([read('src/time-budget-feature.js'), read('src/statistics-ui.js')]);
  for (const source of [budget, statistics]) {
    for (const token of ['getSnapshot', 'patchSnapshot', 'mergeRemoteAndPendingEntries', 'weekly-time-budget:entries-changed']) assert.ok(source.includes(token), token);
  }
});
```

- [ ] **Step 2: Verify RED**

Run: `node --test tests/offline-app-integration.test.js tests/time-budget-integration.test.js`

Expected: FAIL.

- [ ] **Step 3: Make both modules cache-first**

For each module:

1. Obtain shared runtime for UID.
2. Read snapshot and pending entries; render cached fields immediately.
3. Attempt Firestore reads.
4. On success replace owned remote fields, merge pending, and patch only owned snapshot fields.
5. On failure retain cached fields and do not replace them with empty arrays.
6. Handle `weekly-time-budget:entries-changed` to recompute dashboard/statistics immediately.

Snapshot keys are fixed: `categories`, `archivedCategories`, `entries`, `weeklyBudgets`, `dailyBudgets`, `defaultDayWeights`, `weeklyBudget`, `updatedAt`.

Budget/category edits remain online-only existing operations; this feature queues record creation only.

- [ ] **Step 4: Verify and commit**

Run: `node --test tests/offline-app-integration.test.js tests/time-budget-integration.test.js tests/statistics-ui.test.js`

Expected: PASS.

Run: `npm test`

Expected: PASS.

```bash
git add src/time-budget-feature.js src/statistics-ui.js tests/offline-app-integration.test.js tests/time-budget-integration.test.js
git commit -m "feat: render reporting screens from offline snapshots"
```

---

### Task 9: 서비스 워커 앱 셸과 Firebase ESM 그래프 캐시

**Files:**
- Create: `src/service-worker-cache.js`
- Create: `service-worker.js`
- Create: `src/service-worker-registration.js`
- Modify: `index.html`
- Test: `tests/service-worker-cache.test.js`
- Test: `tests/offline-app-integration.test.js`

- [ ] **Step 1: Write failing graph-cache tests**

```js
import { cacheModuleGraph, extractModuleSpecifiers } from '../src/service-worker-cache.js';

test('정적 import를 절대 URL로 추출하고 중복을 제거한다', () => {
  const source = `import './a.js'; import { b } from './b.js'; import './a.js';`;
  assert.deepEqual(extractModuleSpecifiers(source, 'https://cdn/x/root.js'), ['https://cdn/x/a.js', 'https://cdn/x/b.js']);
});

test('Firebase ESM 그래프를 순환 없이 재귀 캐시한다', async () => {
  const sources = new Map([
    ['https://cdn/root.js', `import './a.js'; import './b.js';`],
    ['https://cdn/a.js', `import './b.js';`],
    ['https://cdn/b.js', `export const b = 1;`],
  ]);
  const cached = [];
  await cacheModuleGraph({
    roots: ['https://cdn/root.js'], allowed: (url) => url.startsWith('https://cdn/'),
    fetchFn: async (url) => new Response(sources.get(url), { status: 200 }),
    cache: { put: async (url) => cached.push(String(url)) },
  });
  assert.deepEqual(new Set(cached), new Set(sources.keys()));
});
```

- [ ] **Step 2: Verify RED**

Run: `node --test tests/service-worker-cache.test.js`

Expected: FAIL because helper does not exist.

- [ ] **Step 3: Implement graph helper and service worker**

`extractModuleSpecifiers` handles `import 'x'` and `from 'x'`; resolves with `new URL`, returns unique URLs. `cacheModuleGraph` caches a successful cloned response, reads source text, and recursively processes allowed imports with a `seen` set.

Use cache names `weekly-time-budget-shell-v1` and `weekly-time-budget-runtime-v1`. Precache these local paths:

```js
const SHELL_URLS = [
  './', './index.html', './styles.css', './manifest.webmanifest', './firebase-config.js',
  './icons/apple-touch-icon.png', './icons/icon-192.png', './icons/icon-512.png',
  './src/domain.js', './src/manual-entry.js', './src/app.js', './src/auth-login-guard.js',
  './src/category-ui-patch.js', './src/category-bulk-editor.js', './src/category-delete-guard.js',
  './src/time-budget-domain.js', './src/time-budget-ui.js', './src/time-budget-feature.js',
  './src/statistics-ui.js', './src/statistics-mobile-overflow.js',
  './src/persistent-timer.js', './src/persistent-timer-ui.js',
  './src/offline-entry-domain.js', './src/offline-store.js', './src/offline-entry-repository.js',
  './src/offline-sync.js', './src/offline-runtime.js', './src/app-toast.js', './src/ui-session-state.js',
  './src/service-worker-cache.js', './src/service-worker-registration.js',
];
```

Warm these roots with `Promise.allSettled` so CDN failure does not abort shell install:

```js
const FIREBASE_ROOTS = [
  'https://www.gstatic.com/firebasejs/11.10.0/firebase-app.js',
  'https://www.gstatic.com/firebasejs/11.10.0/firebase-auth.js',
  'https://www.gstatic.com/firebasejs/11.10.0/firebase-firestore.js',
];
```

Fetch policy:

- `firestore.googleapis.com`, `identitytoolkit.googleapis.com`, `securetoken.googleapis.com`: network only.
- navigation: network first, cached `index.html` fallback.
- local shell and `www.gstatic.com/firebasejs/11.10.0/`: cache first, network fill.
- other requests: normal fetch.

Activate removes older `weekly-time-budget-*` caches and calls `clients.claim()`.

- [ ] **Step 4: Register module service worker**

```js
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./service-worker.js', { type: 'module', scope: './' })
      .catch((error) => console.error('서비스 워커 등록 실패', error));
  });
}
```

Load registration before Firebase feature scripts.

- [ ] **Step 5: Verify and commit**

Run: `node --test tests/service-worker-cache.test.js tests/offline-app-integration.test.js`

Expected: PASS.

```bash
git add src/service-worker-cache.js service-worker.js src/service-worker-registration.js index.html tests/service-worker-cache.test.js tests/offline-app-integration.test.js
git commit -m "feat: cache the web app for offline reopening"
```

---

### Task 10: 완전 삭제·Pages 산출물·전체 회귀 검증

**Files:**
- Modify: `src/category-delete-guard.js:47-175`
- Modify: `scripts/prepare-pages-site.mjs:210-230`
- Modify: `.github/workflows/ci.yml:29-37`
- Modify: `tests/pages-deploy.test.js`
- Modify: `tests/offline-app-integration.test.js`
- Modify: `tests/time-budget-integration.test.js`

- [ ] **Step 1: Add failing deletion and deployment tests**

```js
test('완전 삭제는 같은 사용자의 pending 기록을 경고하고 제거한다', async () => {
  const source = await read('src/category-delete-guard.js');
  for (const token of ['countPendingByCategory', 'deletePendingByCategory', '동기화 대기 기록']) assert.ok(source.includes(token), token);
});
```

```js
test('Pages 산출물에 모든 오프라인 파일이 포함된다', async () => {
  const outputDir = await preparePagesSite({ rootDir, outputDir: tempDir, env: testFirebaseEnv });
  for (const file of [
    'service-worker.js', 'src/offline-entry-domain.js', 'src/offline-store.js',
    'src/offline-entry-repository.js', 'src/offline-sync.js', 'src/offline-runtime.js',
    'src/app-toast.js', 'src/ui-session-state.js', 'src/service-worker-cache.js',
    'src/service-worker-registration.js',
  ]) await access(path.join(outputDir, file));
});
```

- [ ] **Step 2: Verify RED**

Run: `node --test tests/pages-deploy.test.js tests/offline-app-integration.test.js tests/time-budget-integration.test.js`

Expected: FAIL because deletion integration and root service worker copy are absent.

- [ ] **Step 3: Integrate pending deletion**

Count Firestore entries and IndexedDB pending entries separately. Warning copy:

```text
서버 기록 N건과 아직 서버에 반영되지 않은 동기화 대기 기록 M건이 있습니다.
완전 삭제하면 모두 복구할 수 없습니다.
```

After Firestore deletion succeeds, call `deletePendingByCategory(uid, categoryId)`, patch snapshot categories/entries, and dispatch data-change events. If local cleanup fails, state explicitly that server deletion succeeded but 기기 대기 기록 정리에 실패했다고 report; do not claim full success.

- [ ] **Step 4: Copy and verify deployment files**

Add to `preparePagesSite`:

```js
await cp(path.join(rootDir, 'service-worker.js'), path.join(outputDir, 'service-worker.js'));
```

Add CI `test -f` checks for every file in the Pages test list.

- [ ] **Step 5: Run syntax, tests, and Pages build**

```bash
node --check src/offline-entry-domain.js
node --check src/offline-store.js
node --check src/offline-entry-repository.js
node --check src/offline-sync.js
node --check src/offline-runtime.js
node --check src/app-toast.js
node --check src/ui-session-state.js
node --check src/service-worker-cache.js
node --check service-worker.js
node --check src/service-worker-registration.js
npm test
FIREBASE_API_KEY=test-api-key \
FIREBASE_AUTH_DOMAIN=test.firebaseapp.com \
FIREBASE_PROJECT_ID=test-project \
FIREBASE_STORAGE_BUCKET=test.firebasestorage.app \
FIREBASE_MESSAGING_SENDER_ID=123456789 \
FIREBASE_APP_ID=1:123456789:web:test \
npm run prepare:pages
```

Expected: every command exits `0`; `_site/service-worker.js` and all offline modules exist.

- [ ] **Step 6: Manual browser verification**

1. Online manual save → `기록을 서버에 저장했습니다` toast.
2. DevTools offline manual save → `기기에 안전하게 저장했습니다` toast and pending badge.
3. Offline reload → same user, last menu/tab, cached categories, pending record remain.
4. Offline timer start/stop → timer clears only after local record succeeds.
5. Network restoration → one sync-complete toast, badge disappears, no duplicate.
6. Reopen from each dashboard/record/budget/statistics internal state → same state restores, future periods remain clamped.
7. Another account login → previous user's queue/snapshot/UI state invisible.
8. Permanent category delete with pending record → warning counts server and pending, both removed.
9. iPhone home-screen app airplane mode → app opens after one prior online run and records safely.

- [ ] **Step 7: Commit**

```bash
git add src/category-delete-guard.js scripts/prepare-pages-site.mjs .github/workflows/ci.yml tests/pages-deploy.test.js tests/offline-app-integration.test.js tests/time-budget-integration.test.js
git commit -m "test: verify offline recording and deployment"
```

---

## Final Review Checklist

- [ ] IndexedDB succeeds before any record success UI or form reset.
- [ ] Manual and timer paths share one runtime and one `localId`/Firestore ID rule.
- [ ] Retryable errors remain pending; permanent errors remain failed until explicit retry.
- [ ] One user has at most one active flush Promise.
- [ ] Pending records appear immediately after local save in history, dashboard, and statistics.
- [ ] Firestore transaction reads active timer before setting/deleting documents.
- [ ] Remote active timer deletion requires matching UID and `startedAt`.
- [ ] Queue, snapshot, and UI state never cross user IDs.
- [ ] Service worker never caches Firestore/Auth API responses.
- [ ] Last menu and all requested internal states restore with future limits clamped.
- [ ] Full `npm test` and `npm run prepare:pages` pass before PR integration.
