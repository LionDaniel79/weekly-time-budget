# Statistics Subsystem Rebuild Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 실제 브라우저에서 월간 통계 멈춤을 재현·계측하고, 통계 데이터·상태·기간 이동·렌더링의 소유권을 하나로 통합하여 월간 통계를 안정적으로 표시한다.

**Architecture:** 통계 기능을 `statistics-state.js`, `statistics-data-source.js`, `statistics-view.js`, `statistics-feature.js`, `statistics-bootstrap.js`로 분리한다. Firebase 연결은 bootstrap에만 두고, 실제 DOM은 feature 하나만 수정한다. 브라우저 테스트는 같은 feature에 가짜 데이터 소스를 주입하며, 서비스 워커는 앱 셸과 Firebase CDN 캐시를 서로 다른 캐시에서만 조회한다.

**Tech Stack:** JavaScript ES modules, Node.js 22 `node:test`, Playwright Chromium, Firebase Auth/Firestore 11.10.0, IndexedDB 오프라인 런타임, GitHub Pages, Service Worker Cache API.

## Global Constraints

- 브라우저 테스트로 현재 실패를 확인하고 `docs/debug/2026-08-01-monthly-statistics-root-cause.md`에 증거를 기록하기 전에는 통계 제품 동작을 변경하지 않는다.
- `#statistics-view` 내부 DOM을 수정하는 제품 코드는 `statistics-feature.js` 하나만 허용한다.
- 통계 기능은 `document.body` 전역 `MutationObserver`, 인공 버튼 클릭, `stopImmediatePropagation()`을 사용하지 않는다.
- 월간 탭·연도·월 변경은 Firestore를 다시 조회하지 않는다.
- 동일 `dataVersion + mode + period`에서는 집계와 DOM 반영을 각각 한 번만 수행한다.
- 캐시 자료가 서버 자료로 교체되어 `dataVersion`이 달라질 때만 추가 렌더 한 번을 허용한다.
- 기록이 있는 과거 월과 이번 달만 활성화하고, 기록 없는 과거 월과 미래 월은 비활성화한다.
- 저장 월이 유효하지 않으면 같은 연도의 이전 기록 월, 같은 연도의 이후 기록 월, 이번 달 순으로 보정한다.
- 월간 화면은 클릭 후 2초 이내 표시하고, 30,000건 이상 자료의 월간 순수 집계는 1초 이내 완료한다.
- 주간과 월간을 20회 반복 전환해도 멈춤, 콘솔 오류, 처리되지 않은 Promise 오류가 없어야 한다.
- 성장·절제 계산, 생성일 규칙, Firestore 문서 구조는 변경하지 않는다.
- 구형 PWA에서 갱신해도 같은 빌드 세대의 HTML·JavaScript·CSS만 함께 사용한다.

---

## File Map

### Create

- `playwright.config.mjs`
- `tests/browser/fixtures/statistics-current.html`
- `tests/browser/fixtures/statistics-feature.html`
- `tests/browser/support/fake-firebase-routes.mjs`
- `tests/browser/support/statistics-fixtures.mjs`
- `tests/browser/statistics-current-flow.spec.mjs`
- `tests/browser/statistics-feature.spec.mjs`
- `tests/browser/pwa-cache-generation.spec.mjs`
- `docs/debug/2026-08-01-monthly-statistics-root-cause.md`
- `src/statistics-state.js`
- `src/statistics-data-source.js`
- `src/statistics-view.js`
- `src/statistics-feature.js`
- `src/statistics-bootstrap.js`
- `tests/statistics-state.test.js`
- `tests/statistics-data-source.test.js`
- `tests/statistics-view.test.js`
- `tests/statistics-ownership.test.js`

### Modify

- `package.json`, `package-lock.json`
- `src/app.js`
- `src/recorded-period-navigation.js`
- `src/statistics-primary.css`
- `index.html`
- `service-worker.js`
- `.github/workflows/ci.yml`
- 서비스 워커 및 Pages 산출물 계약 테스트

### Delete

- `src/statistics-offline-rescue.js`
- `src/statistics-ui.js`
- `src/statistics-session-state.js`
- `src/statistics-mobile-overflow.js`
- `tests/monthly-statistics-observer-ownership.test.js`
- `tests/monthly-statistics-zero-loop.test.js`
- `tests/statistics-single-renderer.test.js`

---

### Task 1: Reproduce the Current Browser Failure Before Product Changes

**Files:**
- Modify: `package.json`, `package-lock.json`
- Create: `playwright.config.mjs`
- Create: `tests/browser/fixtures/statistics-current.html`
- Create: `tests/browser/support/fake-firebase-routes.mjs`
- Create: `tests/browser/statistics-current-flow.spec.mjs`
- Create: `tests/browser/pwa-cache-generation.spec.mjs`
- Create after the failing run: `docs/debug/2026-08-01-monthly-statistics-root-cause.md`

**Interfaces:**
- Produces `installFakeFirebaseRoutes(page, fixture)`.
- Task 2 is blocked until at least one browser test fails on the current product and the debug document records the exact evidence.

- [ ] **Step 1: Install Playwright and add scripts**

Run:

```bash
npm install -D @playwright/test@latest
```

Set the scripts to:

```json
{
  "test": "node --test",
  "test:browser": "playwright test",
  "test:all": "npm test && npm run test:browser",
  "prepare:icons": "node scripts/materialize-icons.mjs",
  "start": "npm run prepare:icons && npx serve .",
  "prepare:pages": "node scripts/prepare-pages-site.mjs"
}
```

Expected: only `devDependencies` and the lockfile change.

- [ ] **Step 2: Configure deterministic Chromium execution**

Create `playwright.config.mjs`:

```js
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/browser',
  timeout: 20_000,
  expect: { timeout: 2_000 },
  fullyParallel: false,
  workers: 1,
  use: {
    baseURL: 'http://127.0.0.1:4173',
    trace: 'retain-on-failure',
    video: 'retain-on-failure',
    ...devices['Desktop Chrome'],
  },
  webServer: {
    command: 'npm run prepare:icons && npx serve . -l 4173',
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: true,
    timeout: 30_000,
  },
});
```

- [ ] **Step 3: Create the current statistics fixture**

Create `tests/browser/fixtures/statistics-current.html`:

```html
<!doctype html>
<html lang="ko">
<head><meta charset="utf-8"><title>Current statistics</title></head>
<body>
  <aside class="sidebar"><button class="nav-button" data-view="statistics">통계</button></aside>
  <p id="week-label"></p>
  <h1 id="page-title"></h1>
  <section id="statistics-view" class="view hidden"></section>
  <script type="module" src="/src/statistics-offline-rescue.js"></script>
</body>
</html>
```

- [ ] **Step 4: Create deterministic Firebase route fakes**

Create `tests/browser/support/fake-firebase-routes.mjs`:

```js
export async function installFakeFirebaseRoutes(page, fixture) {
  await page.addInitScript((value) => { globalThis.__statisticsFixture = value; }, fixture);

  await page.route('**/firebase-config.js', (route) => route.fulfill({
    contentType: 'text/javascript',
    body: `export const firebaseConfig = { apiKey: 'test', projectId: 'test' };`,
  }));

  await page.route('https://www.gstatic.com/firebasejs/11.10.0/firebase-app.js', (route) => route.fulfill({
    contentType: 'text/javascript',
    body: `
      const app = {};
      export const getApps = () => [app];
      export const getApp = () => app;
      export const initializeApp = () => app;
    `,
  }));

  await page.route('https://www.gstatic.com/firebasejs/11.10.0/firebase-auth.js', (route) => route.fulfill({
    contentType: 'text/javascript',
    body: `
      const user = { uid: 'browser-user', displayName: 'Browser User' };
      const auth = { currentUser: user };
      export const getAuth = () => auth;
      export const onAuthStateChanged = (_auth, callback) => {
        queueMicrotask(() => callback(user));
        return () => {};
      };
    `,
  }));

  await page.route('https://www.gstatic.com/firebasejs/11.10.0/firebase-firestore.js', (route) => route.fulfill({
    contentType: 'text/javascript',
    body: `
      export const getFirestore = () => ({});
      export const collection = (_db, ...parts) => ({ path: parts.join('/') });
      export const orderBy = (...parts) => ({ type: 'orderBy', parts });
      export const query = (source) => source;
      export const getDocs = async (source) => ({
        docs: (globalThis.__statisticsFixture?.[source.path] || []).map((data, index) => ({
          id: data.id || String(index),
          data: () => ({ ...data }),
        })),
      });
    `,
  }));
}
```

- [ ] **Step 5: Write the current monthly-click regression**

Create `tests/browser/statistics-current-flow.spec.mjs`:

```js
import { test, expect } from '@playwright/test';
import { installFakeFirebaseRoutes } from './support/fake-firebase-routes.mjs';

const fixture = {
  'users/browser-user/entries': [
    { id: 'e1', date: '2026-07-02', categoryId: 'reading', durationMinutes: 45 },
    { id: 'e2', date: '2026-08-01', categoryId: 'reading', durationMinutes: 30 },
  ],
  'users/browser-user/categories': [
    { id: 'reading', name: '독서', order: 1, defaultBudgetMinutes: 420 },
  ],
  'users/browser-user/archivedCategories': [],
  'users/browser-user/weeklyBudgets': [],
};

test('현재 월간 통계 클릭은 2초 안에 끝나고 반복 전환 후에도 응답한다', async ({ page }) => {
  const errors = [];
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  page.on('pageerror', (error) => errors.push(error.message));
  await installFakeFirebaseRoutes(page, fixture);
  await page.goto('/tests/browser/fixtures/statistics-current.html');
  await page.getByRole('button', { name: '통계' }).click();
  await expect(page.getByRole('button', { name: '주별 통계' })).toBeVisible();

  const startedAt = Date.now();
  await page.getByRole('button', { name: '월간 통계' }).click();
  await expect(page.getByRole('button', { name: '월간 통계' })).toHaveClass(/active/);
  await expect(page.locator('#statistics-rescue-month')).toBeVisible();
  expect(Date.now() - startedAt).toBeLessThan(2_000);

  for (let index = 0; index < 20; index += 1) {
    await page.getByRole('button', { name: '주별 통계' }).click();
    await page.getByRole('button', { name: '월간 통계' }).click();
  }
  await expect(page.locator('#statistics-rescue-month')).toBeVisible();
  expect(errors).toEqual([]);
});
```

- [ ] **Step 6: Write the stale-cache generation regression**

Create `tests/browser/pwa-cache-generation.spec.mjs`:

```js
import { test, expect } from '@playwright/test';

test('구형 runtime 캐시가 최신 셸 통계 파일을 가리지 않는다', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(async () => {
    const registrations = await navigator.serviceWorker.getRegistrations();
    await Promise.all(registrations.map((registration) => registration.unregister()));
    await Promise.all((await caches.keys()).map((name) => caches.delete(name)));
    const runtime = await caches.open('weekly-time-budget-runtime-v1');
    await runtime.put('/src/statistics-offline-rescue.js', new Response('/* stale-statistics-v13 */', {
      headers: { 'Content-Type': 'text/javascript' },
    }));
  });
  await page.reload();
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null);
  const source = await page.evaluate(() => fetch('/src/statistics-offline-rescue.js').then((response) => response.text()));
  expect(source).not.toContain('stale-statistics-v13');
});
```

- [ ] **Step 7: Run the diagnostic gate and retain evidence**

```bash
npx playwright install chromium
npm run test:browser -- tests/browser/statistics-current-flow.spec.mjs tests/browser/pwa-cache-generation.spec.mjs
```

Expected: at least one test fails on the current branch. Keep its trace and console output. If both tests pass, stop implementation and add more instrumentation until the user's monthly freeze is reproducible.

- [ ] **Step 8: Write the debug report using actual command output**

Create `docs/debug/2026-08-01-monthly-statistics-root-cause.md`. Include the exact output of `git rev-parse HEAD`, the exact failing test title, the first failing stage, observed render/state/network counts, the trace file name, the evidence-backed root cause, and hypotheses disproved by the passing test. Do not write a cause that the browser test did not demonstrate.

- [ ] **Step 9: Commit the diagnostic gate**

```bash
git add package.json package-lock.json playwright.config.mjs tests/browser docs/debug/2026-08-01-monthly-statistics-root-cause.md
git commit -m "test: reproduce monthly statistics browser failure"
```

---

### Task 2: Add Deterministic Statistics State

**Files:**
- Create: `src/statistics-state.js`
- Create: `tests/statistics-state.test.js`

**Interfaces:**
- `createStatisticsState({ now, restored })`
- `applyStatisticsAction(state, action, context)` returns `{ state, changed }`
- `statisticsRenderKey(state)` returns a string.

- [ ] **Step 1: Write the failing tests**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyStatisticsAction,
  createStatisticsState,
  statisticsRenderKey,
} from '../src/statistics-state.js';

const context = {
  currentWeekStart: '2026-07-27',
  currentYear: 2026,
  currentMonth: 8,
  recordedWeekStarts: ['2026-07-06', '2026-07-27'],
  recordedMonths: ['2026-06', '2026-08'],
};

test('같은 월간 모드를 다시 선택하면 변경이 아니다', () => {
  const state = createStatisticsState({
    now: new Date('2026-08-01T12:00:00'),
    restored: { mode: 'monthly', year: 2026, month: 8 },
  });
  const result = applyStatisticsAction(state, { type: 'select-mode', mode: 'monthly' }, context);
  assert.equal(result.changed, false);
  assert.equal(statisticsRenderKey(result.state), statisticsRenderKey(state));
});

test('기록 없는 7월은 같은 연도의 이전 기록 월인 6월로 보정한다', () => {
  const state = createStatisticsState({ now: new Date('2026-08-01T12:00:00') });
  const result = applyStatisticsAction(state, { type: 'select-month', year: 2026, month: 7 }, context);
  assert.deepEqual({ year: result.state.year, month: result.state.month }, { year: 2026, month: 6 });
});

test('dataVersion 변경은 같은 기간에도 새 렌더 키를 만든다', () => {
  const state = { ...createStatisticsState({ now: new Date('2026-08-01T12:00:00') }), dataVersion: 'cache:1' };
  assert.notEqual(statisticsRenderKey(state), statisticsRenderKey({ ...state, dataVersion: 'server:2' }));
});
```

- [ ] **Step 2: Verify RED**

```bash
node --test tests/statistics-state.test.js
```

Expected: `ERR_MODULE_NOT_FOUND`.

- [ ] **Step 3: Implement `src/statistics-state.js`**

```js
import { getWeekRange } from './domain.js';
import {
  coerceMonthlySelection,
  coerceRecordedPeriodSelection,
} from './recorded-period-domain.js';

const MODES = new Set(['weekly', 'monthly', 'yearly', 'monthly-comparison', 'yearly-comparison']);

export function createStatisticsState({ now = new Date(), restored = {} } = {}) {
  return {
    mode: MODES.has(restored.mode) ? restored.mode : 'weekly',
    weekStart: restored.weekStart || getWeekRange(now).start,
    year: Number(restored.year) || now.getFullYear(),
    month: Number(restored.month) || now.getMonth() + 1,
    data: null,
    dataVersion: 'none',
    loadStatus: 'idle',
    source: 'none',
    warning: '',
    renderError: null,
  };
}

export function statisticsRenderKey(state) {
  const period = state.mode === 'weekly'
    ? state.weekStart
    : state.mode === 'monthly'
      ? `${state.year}-${String(state.month).padStart(2, '0')}`
      : state.mode === 'yearly-comparison' ? 'all' : String(state.year);
  return `${state.dataVersion}|${state.mode}|${period}`;
}

export function applyStatisticsAction(state, action, context) {
  let next = state;
  if (action.type === 'select-mode' && MODES.has(action.mode) && action.mode !== state.mode) {
    next = { ...state, mode: action.mode, warning: '', renderError: null };
  }
  if (action.type === 'select-week') {
    const weekStart = coerceRecordedPeriodSelection({
      selected: action.weekStart,
      current: context.currentWeekStart,
      recordedPeriods: context.recordedWeekStarts,
    });
    if (weekStart !== state.weekStart) next = { ...state, weekStart };
  }
  if (action.type === 'select-month') {
    const selected = coerceMonthlySelection({
      year: action.year,
      month: action.month,
      currentYear: context.currentYear,
      currentMonth: context.currentMonth,
      recordedMonths: context.recordedMonths,
    });
    if (selected.year !== state.year || selected.month !== state.month) next = { ...state, ...selected };
  }
  if (action.type === 'replace-data') {
    next = {
      ...state,
      data: action.data,
      dataVersion: action.dataVersion,
      source: action.source,
      loadStatus: 'ready',
      warning: action.warning || '',
      renderError: null,
    };
  }
  if (action.type === 'load-status') next = { ...state, loadStatus: action.status, warning: action.warning || '' };
  if (action.type === 'render-error') next = { ...state, renderError: action.error };
  return {
    state: next,
    changed: statisticsRenderKey(next) !== statisticsRenderKey(state)
      || next.loadStatus !== state.loadStatus
      || next.warning !== state.warning
      || next.renderError !== state.renderError,
  };
}
```

- [ ] **Step 4: Verify GREEN and commit**

```bash
node --test tests/statistics-state.test.js
git add src/statistics-state.js tests/statistics-state.test.js
git commit -m "feat: add deterministic statistics state"
```

---

### Task 3: Isolate Cache-First Data Loading

**Files:**
- Create: `src/statistics-data-source.js`
- Create: `tests/statistics-data-source.test.js`

**Interfaces:**
- `createStatisticsDataSource({ firestore, db, runtimeForUser, timeoutMs, clock })`
- Returned methods: `readCache(userId)`, `readServer(userId)`, `load(userId, { onCache, onServer })`.
- Snapshot: `{ data, dataVersion, source, warning }`.

- [ ] **Step 1: Write complete fake dependencies and failing tests**

Create a `fixtureDependencies` helper inside the test:

```js
function fixtureDependencies({ serverDelay = 0, serverNeverResolves = false, timeoutMs = 50 } = {}) {
  const snapshots = new Map([['u1', {
    statisticsData: {
      entries: [{ id: 'cached', date: '2026-08-01', categoryId: 'reading', durationMinutes: 20 }],
      activeCategories: [{ id: 'reading', name: '독서', defaultBudgetMinutes: 420 }],
      archivedCategories: [],
      weeklyBudgets: [],
      updatedAt: 1,
    },
  }]]);
  const runtimeForUser = (userId) => snapshots.has(userId) ? {
    store: {
      getSnapshot: async (requested) => snapshots.get(requested) || null,
      patchSnapshot: async () => {},
    },
    mergedEntries: async (entries) => entries,
  } : null;
  const documents = {
    entries: [{ id: 'server', date: '2026-08-01', categoryId: 'reading', durationMinutes: 30 }],
    categories: [{ id: 'reading', name: '독서', defaultBudgetMinutes: 420 }],
    archivedCategories: [],
    weeklyBudgets: [],
  };
  const firestore = {
    collection: (_db, _users, _uid, name) => ({ name }),
    orderBy: () => ({}),
    query: (source) => source,
    getDocs: async (source) => {
      if (serverNeverResolves) return new Promise(() => {});
      await new Promise((resolve) => setTimeout(resolve, serverDelay));
      return { docs: documents[source.name].map((data) => ({ id: data.id, data: () => ({ ...data }) })) };
    },
  };
  return { firestore, db: {}, runtimeForUser, timeoutMs, clock: () => 2 };
}
```

Add these tests:

```js
test('캐시를 서버보다 먼저 전달한다', async () => {
  const order = [];
  const source = createStatisticsDataSource(fixtureDependencies({ serverDelay: 20 }));
  await source.load('u1', {
    onCache: (snapshot) => order.push(snapshot.source),
    onServer: (snapshot) => order.push(snapshot.source),
  });
  assert.deepEqual(order, ['cache', 'server']);
});

test('서버 제한시간 후 캐시와 경고를 유지한다', async () => {
  const source = createStatisticsDataSource(fixtureDependencies({ serverNeverResolves: true, timeoutMs: 10 }));
  const result = await source.load('u1', { onCache() {}, onServer() {} });
  assert.equal(result.source, 'cache');
  assert.match(result.warning, /서버 응답/);
});

test('다른 사용자 캐시는 읽지 않는다', async () => {
  const source = createStatisticsDataSource(fixtureDependencies());
  assert.equal(await source.readCache('u2'), null);
});
```

- [ ] **Step 2: Verify RED**

```bash
node --test tests/statistics-data-source.test.js
```

- [ ] **Step 3: Implement the data source exactly**

```js
function plainDocuments(snapshot) {
  return snapshot.docs.map((item) => ({ id: item.id, ...item.data() }));
}

function timeoutAfter(milliseconds) {
  return new Promise((_, reject) => {
    setTimeout(() => reject(new Error('서버 응답이 늦어 기기에 저장된 자료를 표시합니다.')), milliseconds);
  });
}

export function createStatisticsDataSource({
  firestore,
  db,
  runtimeForUser,
  timeoutMs = 8000,
  clock = () => Date.now(),
}) {
  async function readCache(userId) {
    const runtime = runtimeForUser(userId);
    if (!runtime) return null;
    const snapshot = await runtime.store.getSnapshot(userId);
    if (!snapshot) return null;
    const statistics = snapshot.statisticsData || {};
    const remoteEntries = Array.isArray(statistics.entries)
      ? statistics.entries : Array.isArray(snapshot.entries) ? snapshot.entries : [];
    const data = {
      entries: await runtime.mergedEntries(remoteEntries),
      activeCategories: Array.isArray(statistics.activeCategories)
        ? statistics.activeCategories : Array.isArray(snapshot.categories) ? snapshot.categories : [],
      archivedCategories: Array.isArray(statistics.archivedCategories)
        ? statistics.archivedCategories : Array.isArray(snapshot.archivedCategories) ? snapshot.archivedCategories : [],
      weeklyBudgets: Array.isArray(statistics.weeklyBudgets)
        ? statistics.weeklyBudgets : Array.isArray(snapshot.weeklyBudgets)
          ? snapshot.weeklyBudgets : snapshot.weeklyBudget ? [snapshot.weeklyBudget] : [],
    };
    const hasData = Object.values(data).some((items) => items.length > 0);
    if (!hasData) return null;
    const updatedAt = Number(statistics.updatedAt || snapshot.updatedAt || 0);
    return { data, dataVersion: `cache:${updatedAt}`, source: 'cache', warning: '' };
  }

  async function readServer(userId) {
    const root = ['users', userId];
    const request = Promise.all([
      firestore.getDocs(firestore.query(firestore.collection(db, ...root, 'entries'), firestore.orderBy('date', 'desc'))),
      firestore.getDocs(firestore.collection(db, ...root, 'categories')),
      firestore.getDocs(firestore.collection(db, ...root, 'archivedCategories')),
      firestore.getDocs(firestore.collection(db, ...root, 'weeklyBudgets')),
    ]);
    const [entries, active, archived, weekly] = await Promise.race([request, timeoutAfter(timeoutMs)]);
    const runtime = runtimeForUser(userId);
    const remoteEntries = plainDocuments(entries);
    const updatedAt = clock();
    const data = {
      entries: runtime ? await runtime.mergedEntries(remoteEntries) : remoteEntries,
      activeCategories: plainDocuments(active),
      archivedCategories: plainDocuments(archived),
      weeklyBudgets: plainDocuments(weekly),
    };
    if (runtime) {
      await runtime.store.patchSnapshot(userId, {
        statisticsData: { ...data, entries: remoteEntries, updatedAt },
      });
    }
    return { data, dataVersion: `server:${updatedAt}`, source: 'server', warning: '' };
  }

  async function load(userId, { onCache = () => {}, onServer = () => {} } = {}) {
    const cached = await readCache(userId);
    if (cached) await onCache(cached);
    try {
      const server = await readServer(userId);
      await onServer(server);
      return server;
    } catch (error) {
      if (!cached) throw error;
      return { ...cached, warning: error.message };
    }
  }

  return { readCache, readServer, load };
}
```

- [ ] **Step 4: Verify GREEN and commit**

```bash
node --test tests/statistics-data-source.test.js
git add src/statistics-data-source.js tests/statistics-data-source.test.js
git commit -m "feat: isolate statistics data loading"
```

---

### Task 4: Build a Pure Statistics View

**Files:**
- Create: `src/statistics-view.js`
- Create: `tests/statistics-view.test.js`
- Modify: `src/statistics-primary.css`

**Interfaces:**
- `buildStatisticsViewModel(state, { now })`
- `renderStatisticsHtml(model)`
- `renderStatisticsFailure({ mode, stage, message })`
- DOM contract: `data-statistics-mode`, `data-statistics-week`, `#statistics-year`, `#statistics-month`, `data-statistics-retry`.

- [ ] **Step 1: Write failing view tests with concrete models**

```js
const monthlyState = {
  mode: 'monthly', weekStart: '2026-07-27', year: 2026, month: 8,
  dataVersion: 'cache:1', source: 'cache', warning: '',
  data: {
    entries: [{ date: '2026-06-10', categoryId: 'reading', durationMinutes: 30 }],
    activeCategories: [{ id: 'reading', name: '독서', defaultBudgetMinutes: 420 }],
    archivedCategories: [], weeklyBudgets: [],
  },
};

test('기록 월과 이번 달만 활성화한다', () => {
  const model = buildStatisticsViewModel(monthlyState, { now: new Date('2026-08-01T12:00:00') });
  assert.equal(model.monthOptions.find((item) => item.month === 6).disabled, false);
  assert.equal(model.monthOptions.find((item) => item.month === 7).disabled, true);
  assert.equal(model.monthOptions.find((item) => item.month === 8).disabled, false);
  assert.equal(model.monthOptions.find((item) => item.month === 9).disabled, true);
});

test('0분 예산과 0분 기록은 처음부터 목표 준수 —로 렌더한다', () => {
  const state = {
    ...monthlyState,
    data: { entries: [], activeCategories: [], archivedCategories: [], weeklyBudgets: [] },
  };
  const html = renderStatisticsHtml(buildStatisticsViewModel(state, { now: new Date('2026-08-01T12:00:00') }));
  assert.match(html, /<p class="muted">목표 준수<\/p><div class="metric">—<\/div>/);
});

test('오류 HTML은 실패 단계와 다시 시도를 포함한다', () => {
  const html = renderStatisticsFailure({ mode: 'monthly', stage: '월간 집계', message: 'invalid date' });
  assert.match(html, /월간 통계를 표시하지 못했습니다/);
  assert.match(html, /월간 집계/);
  assert.match(html, /data-statistics-retry/);
});
```

- [ ] **Step 2: Verify RED**

```bash
node --test tests/statistics-view.test.js
```

- [ ] **Step 3: Implement the view-model switch**

Use these imports from `domain.js`:

```js
calculateRecordedMonthAverage,
detailedRecordedMonthlyBudgetComparison,
detailedRecordedYearlyBudgetComparison,
formatMinutes,
getWeekRange,
summarizeRecordedMonthlyBudgetPeriod,
summarizeRecordedYearlyBudgetPeriod,
summarizeWeeklyBudgetPeriod
```

Use `buildRecordedPeriodIndex`, `monthOptionStates`, `recordedYearOptions`, `previousRecordedPeriod`, and `nextRecordedPeriodOrCurrent` from `recorded-period-domain.js`.

The summary selection must be exactly:

```js
if (state.mode === 'weekly') {
  summary = summarizeWeeklyBudgetPeriod(entries, categories, budgets, state.weekStart);
}
if (state.mode === 'monthly') {
  summary = summarizeRecordedMonthlyBudgetPeriod(entries, categories, budgets, state.year, state.month);
}
if (state.mode === 'yearly') {
  summary = summarizeRecordedYearlyBudgetPeriod(entries, categories, budgets, state.year);
}
if (state.mode === 'monthly-comparison') {
  comparison = detailedRecordedMonthlyBudgetComparison(entries, categories, budgets, state.year);
}
if (state.mode === 'yearly-comparison') {
  comparison = detailedRecordedYearlyBudgetComparison(entries, categories, budgets);
}
```

Merge categories by inserting archived categories first and active categories second into a `Map`, so active data wins. Compute `achievementText` as `—` when total budget and total actual are both zero, otherwise use `계산 제외` or the score with `점`.

`renderStatisticsHtml` must emit:

```html
<button data-statistics-mode="monthly" type="button">월간 통계</button>
<select id="statistics-year"></select>
<select id="statistics-month"></select>
<button data-statistics-week="previous" type="button"></button>
<button data-statistics-retry type="button">통계를 다시 불러오기</button>
```

Only emit controls relevant to the active mode.

- [ ] **Step 4: Consolidate all statistics CSS**

Move banner, table, mobile table, overflow, and disabled-option rules from `statistics-offline-rescue.js` and `statistics-mobile-overflow.js` into `statistics-primary.css`. The new JavaScript files must not create `<style>` elements.

- [ ] **Step 5: Verify GREEN and commit**

```bash
node --test tests/statistics-view.test.js
git add src/statistics-view.js src/statistics-primary.css tests/statistics-view.test.js
git commit -m "feat: render statistics from a pure view model"
```

---

### Task 5: Make One Feature Own Statistics State and DOM

**Files:**
- Create: `src/statistics-feature.js`
- Create: `src/statistics-bootstrap.js`
- Create: `tests/browser/fixtures/statistics-feature.html`
- Create: `tests/browser/statistics-feature.spec.mjs`
- Modify: `src/app.js`

**Interfaces:**
- `createStatisticsFeature({ root, dataSource, getCurrentUser, saveUiState, setHeader, now, diagnostics })`
- Methods: `enter()`, `leave()`, `restore(saved)`, `refresh()`, `destroy()`.

- [ ] **Step 1: Create the browser fixture with an exact fake source**

Create `tests/browser/fixtures/statistics-feature.html`:

```html
<!doctype html>
<html lang="ko">
<head><meta charset="utf-8"><title>Statistics feature</title></head>
<body>
  <section id="statistics-view"></section>
  <script type="module">
    import { createStatisticsFeature } from '/src/statistics-feature.js';

    const data = {
      entries: [
        { id: 'e1', date: '2026-06-10', categoryId: 'reading', durationMinutes: 30 },
        { id: 'e2', date: '2026-08-01', categoryId: 'reading', durationMinutes: 30 },
      ],
      activeCategories: [{ id: 'reading', name: '독서', defaultBudgetMinutes: 420 }],
      archivedCategories: [], weeklyBudgets: [],
    };
    const counts = { cacheReads: 0, serverReads: 0, saves: 0 };
    const diagnostics = { modeChanges: 0, aggregateRuns: 0, renderRuns: 0, stateSaves: 0 };
    const dataSource = {
      async load(_userId, { onCache, onServer }) {
        counts.cacheReads += 1;
        await onCache({ data, dataVersion: 'cache:1', source: 'cache', warning: '' });
        counts.serverReads += 1;
        await onServer({ data, dataVersion: 'server:2', source: 'server', warning: '' });
        return { data, dataVersion: 'server:2', source: 'server', warning: '' };
      },
    };
    const feature = createStatisticsFeature({
      root: document.querySelector('#statistics-view'),
      dataSource,
      getCurrentUser: () => ({ uid: 'browser-user' }),
      saveUiState: async () => { counts.saves += 1; },
      setHeader: () => {},
      now: () => new Date('2026-08-01T12:00:00'),
      diagnostics,
    });
    globalThis.__statisticsHarness = { feature, counts, diagnostics, ready: feature.enter() };
  </script>
</body>
</html>
```

- [ ] **Step 2: Write the three ownership tests**

Create `tests/browser/statistics-feature.spec.mjs`:

```js
import { test, expect } from '@playwright/test';

async function harness(page) {
  await page.goto('/tests/browser/fixtures/statistics-feature.html');
  await page.evaluate(() => globalThis.__statisticsHarness.ready);
}

async function snapshot(page) {
  return page.evaluate(() => ({
    counts: { ...globalThis.__statisticsHarness.counts },
    diagnostics: { ...globalThis.__statisticsHarness.diagnostics },
  }));
}

test('월간 탭은 네트워크 재조회 없이 한 번 렌더한다', async ({ page }) => {
  await harness(page);
  const before = await snapshot(page);
  await page.locator('[data-statistics-mode="monthly"]').click();
  await expect(page.locator('#statistics-month')).toBeVisible();
  const after = await snapshot(page);
  expect(after.counts.cacheReads).toBe(before.counts.cacheReads);
  expect(after.counts.serverReads).toBe(before.counts.serverReads);
  expect(after.diagnostics.renderRuns).toBe(before.diagnostics.renderRuns + 1);
});

test('같은 월간 탭을 다시 클릭하면 렌더와 저장을 생략한다', async ({ page }) => {
  await harness(page);
  await page.locator('[data-statistics-mode="monthly"]').click();
  const before = await snapshot(page);
  await page.locator('[data-statistics-mode="monthly"]').click();
  const after = await snapshot(page);
  expect(after.diagnostics.renderRuns).toBe(before.diagnostics.renderRuns);
  expect(after.counts.saves).toBe(before.counts.saves);
});

test('cache와 server의 다른 dataVersion은 초기 렌더를 두 번만 만든다', async ({ page }) => {
  await harness(page);
  const value = await snapshot(page);
  expect(value.diagnostics.renderRuns).toBe(2);
  expect(value.counts.cacheReads).toBe(1);
  expect(value.counts.serverReads).toBe(1);
});
```

- [ ] **Step 3: Verify RED**

```bash
npm run test:browser -- tests/browser/statistics-feature.spec.mjs
```

- [ ] **Step 4: Implement the feature controller**

The controller must attach only:

```js
root.addEventListener('click', onClick);
root.addEventListener('change', onChange);
```

`onClick` handles `data-statistics-mode`, `data-statistics-week`, and `data-statistics-retry`. `onChange` handles only `#statistics-year` and `#statistics-month`. Mode/year/month handlers call `applyStatisticsAction`, render only when `changed` is true, and call `saveUiState` once after a successful state transition.

`render()` must:

1. Compare `statisticsRenderKey(state)` with `lastRenderedKey`.
2. Mark `statistics-aggregate-start` and `statistics-aggregate-end` around `buildStatisticsViewModel`.
3. Increment `diagnostics.aggregateRuns` once.
4. Build HTML once and assign `root.innerHTML` once.
5. Increment `diagnostics.renderRuns` once and set `lastRenderedKey`.
6. Catch `period-index`, `aggregate`, `html`, and `dom` failures and replace the root with `renderStatisticsFailure`.

`enter()` loads once per user and sends cache/server snapshots through `replace-data`. `leave()` does not clear data. `refresh()` starts a new sequence and discards results from older user/request sequences. `restore(saved)` applies values directly without clicking controls. `destroy()` removes the two root listeners.

- [ ] **Step 5: Add one app view event**

At the end of `switchView()` in `src/app.js`, dispatch only when the active view actually changes:

```js
if (previousView !== safe) {
  document.dispatchEvent(new CustomEvent('weekly-time-budget:view-changed', {
    detail: { view: safe },
  }));
}
```

Capture `previousView` before assigning `state.activeView`. During login restoration, call the feature's `restore()` through `weekly-time-budget:ui-state-restored`; do not force a duplicate view event.

- [ ] **Step 6: Wire Firebase only in `statistics-bootstrap.js`**

The bootstrap imports Firebase modules, creates `createStatisticsDataSource` with `getExistingOfflineRuntime`, creates the feature, and listens for:

- `weekly-time-budget:view-changed`: `enter()` for statistics and `leave()` otherwise.
- `weekly-time-budget:ui-state-restored`: `restore(event.detail.statistics)`; call `enter()` if the restored active view is statistics.
- `weekly-time-budget:data-changed`: `refresh()` only while statistics is visible.

Expose counters only:

```js
window.__weeklyTimeBudgetDiagnostics = window.__weeklyTimeBudgetDiagnostics || {};
window.__weeklyTimeBudgetDiagnostics.statistics = diagnostics;
```

Do not expose entries, category names, user IDs, or budgets.

- [ ] **Step 7: Verify GREEN and commit**

```bash
node --test tests/statistics-state.test.js tests/statistics-data-source.test.js tests/statistics-view.test.js
npm run test:browser -- tests/browser/statistics-feature.spec.mjs
git add src/app.js src/statistics-feature.js src/statistics-bootstrap.js tests/browser/fixtures/statistics-feature.html tests/browser/statistics-feature.spec.mjs
git commit -m "feat: make statistics a single owned feature"
```

---

### Task 6: Remove Legacy Statistics Ownership and Dead Code

**Files:**
- Modify: `src/recorded-period-navigation.js`, `index.html`
- Create: `tests/statistics-ownership.test.js`
- Delete the four legacy statistics product files and three source-string tests listed in the file map.

- [ ] **Step 1: Write the failing ownership test**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');
async function isMissing(path) {
  try { await access(new URL(`../${path}`, import.meta.url)); return false; }
  catch { return true; }
}

test('HTML은 새 통계 bootstrap만 로드한다', async () => {
  const html = await read('index.html');
  assert.match(html, /src="\.\/src\/statistics-bootstrap\.js"/);
  assert.doesNotMatch(html, /statistics-offline-rescue|statistics-ui|statistics-session-state|statistics-mobile-overflow/);
});

test('기록 기간 모듈은 통계 DOM을 참조하지 않는다', async () => {
  const source = await read('src/recorded-period-navigation.js');
  assert.doesNotMatch(source, /statistics-view|data-rescue-stat-mode|statistics-rescue-month|patchStatistics/);
});

test('레거시 통계 파일은 저장소에서 삭제한다', async () => {
  for (const path of [
    'src/statistics-offline-rescue.js',
    'src/statistics-ui.js',
    'src/statistics-session-state.js',
    'src/statistics-mobile-overflow.js',
  ]) assert.equal(await isMissing(path), true, path);
});
```

- [ ] **Step 2: Verify RED**

```bash
node --test tests/statistics-ownership.test.js
```

- [ ] **Step 3: Reduce `recorded-period-navigation.js` to dashboard only**

Delete `statisticsWeekModel`, `patchZeroAchievement`, `optionMarkup`, `replaceSelectOptions`, `patchMonthlyStatistics`, `patchStatistics`, `statisticsWeekClick`, the statistics year/month capture handler, and statistics selectors from `patchUnreadyControls`. Keep recorded index refresh and dashboard date/week movement.

- [ ] **Step 4: Update HTML and remove dead files**

Load:

```html
<script type="module" src="./src/statistics-bootstrap.js"></script>
```

Remove all four old statistics scripts. Change the opening tag to:

```html
<html lang="ko" data-app-build="statistics-v16">
```

Delete the four old product files and three obsolete tests.

- [ ] **Step 5: Verify and commit**

```bash
node --test tests/statistics-ownership.test.js
npm test
git add -A
git commit -m "refactor: remove legacy statistics ownership"
```

---

### Task 7: Add Full Browser Data-Shape and Performance Coverage

**Files:**
- Create: `tests/browser/support/statistics-fixtures.mjs`
- Modify: `tests/browser/statistics-feature.spec.mjs`

- [ ] **Step 1: Create deterministic fixture builders**

```js
function dateKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export function emptyStatisticsFixture() {
  return { entries: [], activeCategories: [], archivedCategories: [], weeklyBudgets: [] };
}

export function legacyCategoryFixture() {
  return {
    entries: [{ id: 'legacy-entry', date: '2024-01-10', categoryId: 'legacy', durationMinutes: 60 }],
    activeCategories: [{ id: 'legacy', name: '기도', defaultBudgetMinutes: 420, order: 1 }],
    archivedCategories: [], weeklyBudgets: [],
  };
}

export function restraintFixture() {
  return {
    entries: [
      { id: 'growth-entry', date: '2026-08-01', categoryId: 'reading', durationMinutes: 60, goalType: 'growth' },
      { id: 'restraint-entry', date: '2026-08-01', categoryId: 'phone', durationMinutes: 240, goalType: 'restraint' },
    ],
    activeCategories: [
      { id: 'reading', name: '독서', goalType: 'growth', defaultBudgetMinutes: 60, order: 1 },
      { id: 'phone', name: '스마트폰', goalType: 'restraint', defaultBudgetMinutes: 180, order: 2 },
    ],
    archivedCategories: [
      { id: 'archive', name: '과거 운동', archivedAt: '2026-07-31', defaultBudgetMinutes: 60, order: 3 },
    ],
    weeklyBudgets: [],
  };
}

export function largeStatisticsFixture() {
  const entries = [];
  const start = new Date(2022, 0, 1, 12);
  const end = new Date(2026, 11, 31, 12);
  for (let date = new Date(start); date <= end; date.setDate(date.getDate() + 1)) {
    for (let index = 0; index < 20; index += 1) {
      entries.push({
        id: `${dateKey(date)}-${index}`,
        date: dateKey(date),
        categoryId: index % 2 ? 'reading' : 'prayer',
        durationMinutes: (index % 5) + 1,
      });
    }
  }
  return {
    entries,
    activeCategories: [
      { id: 'reading', name: '독서', defaultBudgetMinutes: 420, order: 1 },
      { id: 'prayer', name: '기도', defaultBudgetMinutes: 1260, order: 2 },
    ],
    archivedCategories: [], weeklyBudgets: [],
  };
}
```

Assert in the fixture test that `largeStatisticsFixture().entries.length >= 30_000`.

- [ ] **Step 2: Add release-blocking browser cases**

Add tests for:

1. Empty account shows monthly within 2 seconds and `목표 준수` is `—`.
2. Category without `createdDate` appears in January 2024.
3. Category with `createdDate: '2026-08-01'` is absent from July 2026 and present in August 2026.
4. Restraint category used 240 minutes against 180 minutes shows a negative individual percentage; total score equals `domain.js` output.
5. Archived category appears when the period has its record or budget.
6. Saved July 2026 selection with recorded June and current August resolves to June.
7. July and September options are disabled while June and August are enabled.
8. Weekly→monthly→weekly 20 times yields no console or page errors.
9. All five mode buttons remain usable.
10. Large fixture contains at least 30,000 entries, monthly display finishes within 2 seconds, and the latest `performance.getEntriesByName('statistics-aggregate').at(-1).duration` is below 1,000 milliseconds.

Use Playwright locators against the fixed DOM contract from Task 4. Do not inspect implementation strings.

- [ ] **Step 3: Run browser tests and commit**

```bash
npm run test:browser -- tests/browser/statistics-feature.spec.mjs
git add tests/browser
git commit -m "test: cover monthly statistics in a real browser"
```

---

### Task 8: Isolate PWA Cache Generations

**Files:**
- Modify: `service-worker.js`
- Modify: `tests/browser/pwa-cache-generation.spec.mjs`
- Modify service-worker unit tests.

- [ ] **Step 1: Expand the failing upgrade test**

Before registering the new worker, create stale caches named `weekly-time-budget-runtime-v1`, `weekly-time-budget-shell-v13`, `weekly-time-budget-shell-v14`, and `weekly-time-budget-shell-v15`. Put stale markers for `index.html`, `src/statistics-bootstrap.js`, and `src/statistics-primary.css` into them.

After activation, read names in the browser:

```js
const names = await page.evaluate(() => caches.keys());
expect(names).toEqual(expect.arrayContaining([
  'weekly-time-budget-shell-v16',
  'weekly-time-budget-firebase-runtime-v2',
]));
for (const oldName of [
  'weekly-time-budget-runtime-v1',
  'weekly-time-budget-shell-v13',
  'weekly-time-budget-shell-v14',
  'weekly-time-budget-shell-v15',
]) expect(names).not.toContain(oldName);
```

Fetch the three current assets and assert none contains `stale-statistics-asset`.

- [ ] **Step 2: Verify RED**

```bash
npm run test:browser -- tests/browser/pwa-cache-generation.spec.mjs
```

- [ ] **Step 3: Replace global cache lookup**

Use:

```js
const SHELL_CACHE = 'weekly-time-budget-shell-v16';
const FIREBASE_RUNTIME_CACHE = 'weekly-time-budget-firebase-runtime-v2';

async function shellCacheFirst(request) {
  const cache = await caches.open(SHELL_CACHE);
  const cached = await cache.match(request);
  if (cached) return cached;
  const response = await fetch(request, { cache: 'no-store' });
  if (response.ok) await cache.put(request, response.clone());
  return response;
}

async function firebaseCacheFirst(request) {
  const cache = await caches.open(FIREBASE_RUNTIME_CACHE);
  const cached = await cache.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok) await cache.put(request, response.clone());
  return response;
}
```

Never call global `caches.match(request)` for same-origin app files. During activate, delete every `weekly-time-budget-` cache except the two current names.

Add the five new statistics JavaScript files to `SHELL_URLS` and remove the four deleted files.

- [ ] **Step 4: Verify GREEN and commit**

```bash
node --test tests/*service-worker*.test.js
npm run test:browser -- tests/browser/pwa-cache-generation.spec.mjs
git add service-worker.js tests
git commit -m "fix: isolate PWA asset cache generations"
```

---

### Task 9: Add Browser Tests to CI and Verify the Pages Artifact

**Files:**
- Modify: `.github/workflows/ci.yml`
- Modify Pages artifact tests if present.

- [ ] **Step 1: Install dependencies and Chromium in CI**

Use:

```yaml
- name: Install dependencies
  run: npm ci
- name: Run unit tests
  run: npm test > test-output.txt 2>&1
- name: Install Chromium
  run: npx playwright install --with-deps chromium
- name: Run browser tests
  run: npm run test:browser >> test-output.txt 2>&1
```

Keep failed output upload and add:

```yaml
path: |
  test-output.txt
  test-results/
  playwright-report/
```

- [ ] **Step 2: Replace obsolete Pages checks**

Require:

```bash
test -f _site/src/statistics-state.js
test -f _site/src/statistics-data-source.js
test -f _site/src/statistics-view.js
test -f _site/src/statistics-feature.js
test -f _site/src/statistics-bootstrap.js
test -f _site/src/statistics-primary.css
```

Reject:

```bash
test ! -f _site/src/statistics-offline-rescue.js
test ! -f _site/src/statistics-ui.js
test ! -f _site/src/statistics-session-state.js
test ! -f _site/src/statistics-mobile-overflow.js
```

- [ ] **Step 3: Run the complete clean verification**

```bash
npm ci
npm test
npx playwright install chromium
npm run test:browser
FIREBASE_API_KEY=test-api-key \
FIREBASE_AUTH_DOMAIN=test.firebaseapp.com \
FIREBASE_PROJECT_ID=test-project \
FIREBASE_STORAGE_BUCKET=test.firebasestorage.app \
FIREBASE_MESSAGING_SENDER_ID=123456789 \
FIREBASE_APP_ID=1:123456789:web:test \
npm run prepare:pages
```

Run all required/forbidden `_site` file checks after the build.

- [ ] **Step 4: Confirm no dead runtime reference remains**

```bash
grep -R "statistics-offline-rescue\|statistics-session-state\|statistics-mobile-overflow\|statistics-ui.js" \
  --exclude-dir=.git \
  --exclude='2026-08-01-statistics-subsystem-rebuild-design.md' \
  --exclude='2026-08-01-statistics-subsystem-rebuild.md' .
```

Expected: no product, test, workflow, service-worker, or Pages reference.

- [ ] **Step 5: Record final evidence in the PR body**

Record the actual values from the final browser run: empty-account monthly duration, 30,000-entry monthly duration, aggregate duration, render count after 20 switches, cache-to-server render count, console/page error count, and remaining cache names.

- [ ] **Step 6: Commit and request review**

```bash
git add -A
git commit -m "ci: verify statistics browser stability"
```

Invoke `superpowers:requesting-code-review`. Review specifically for a second statistics DOM owner, a document-level observer touching statistics, network calls from mode/year/month handlers, same-origin assets stored in the Firebase runtime cache, browser tests that bypass production code, and changes to goal or category-effective-date semantics.

Do not merge until the final branch CI succeeds and every review finding is resolved.
