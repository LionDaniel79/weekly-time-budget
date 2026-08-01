# Statistics Subsystem Rebuild Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 실제 브라우저에서 월간 통계 멈춤을 재현·계측하고, 통계 데이터·상태·기간 이동·렌더링의 소유권을 하나로 통합하여 월간 통계를 안정적으로 표시한다.

**Architecture:** 현재 `statistics-offline-rescue.js`와 `recorded-period-navigation.js`에 흩어진 책임을 데이터 소스, 순수 상태 모델, 순수 뷰, 단일 기능 컨트롤러로 분리한다. 제품용 Firebase 연결은 얇은 bootstrap 파일에만 두고, 브라우저 테스트는 같은 컨트롤러에 가짜 데이터 소스를 주입한다. 통계 화면은 전역 `MutationObserver`나 인공 클릭 없이 한 컨트롤러만 수정하며, 서비스 워커는 셸 자산과 Firebase 런타임 모듈의 캐시를 물리적으로 분리한다.

**Tech Stack:** JavaScript ES modules, Node.js 22 `node:test`, Playwright Chromium, Firebase Auth/Firestore 11.10.0, IndexedDB 오프라인 런타임, GitHub Pages, Service Worker Cache API.

## Global Constraints

- 실제 월간 클릭 실패 또는 PWA 세대 혼합 실패를 브라우저 테스트로 확인하기 전에는 통계 제품 동작을 변경하지 않는다.
- `#statistics-view` 내부 DOM을 수정하는 제품 코드는 새 통계 기능 컨트롤러 하나만 허용한다.
- 통계 기능은 `document.body` 전역 `MutationObserver`를 사용하지 않는다.
- 월간 탭·연도·월 변경은 Firestore를 다시 조회하지 않는다.
- 동일 `dataVersion + mode + period`에서는 계산과 DOM 반영을 각각 한 번만 수행한다.
- 캐시 자료가 서버 자료로 실제 교체되어 `dataVersion`이 바뀌는 경우 한 차례 추가 렌더를 허용한다.
- 기록이 있는 과거 월과 이번 달만 활성화하고, 기록 없는 과거 월과 미래 월은 비활성화한다.
- 저장된 월이 유효하지 않으면 같은 연도의 이전 기록 월 → 이후 기록 월 → 이번 달 순으로 보정한다.
- 월간 화면은 클릭 후 2초 이내 표시하고, 대용량 월간 순수 계산은 1초 이내 완료한다.
- 주간↔월간 20회 반복 전환에서 멈춤·콘솔 오류·처리되지 않은 Promise 오류가 없어야 한다.
- 성장·절제 목표 계산, 생성일 규칙, Firestore 문서 구조는 변경하지 않는다.
- 구형 PWA 캐시에서 갱신해도 동일 빌드 세대의 HTML·JS·CSS만 사용해야 한다.

---

## File Structure

### Create

- `playwright.config.mjs` — Chromium 브라우저 테스트와 로컬 정적 서버 설정.
- `tests/browser/fixtures/statistics-current.html` — 현재 통계 모듈만 실제 브라우저에서 실행하는 최소 DOM.
- `tests/browser/support/fake-firebase-routes.mjs` — Firebase CDN 모듈을 가짜 Auth/Firestore 모듈로 응답.
- `tests/browser/statistics-current-flow.spec.mjs` — 현재 월간 클릭과 반복 전환 진단.
- `tests/browser/pwa-cache-generation.spec.mjs` — 구형 런타임 캐시가 새 셸 자산을 가리는 문제 재현.
- `docs/debug/2026-08-01-monthly-statistics-root-cause.md` — 브라우저 재현 결과와 확정 원인 기록.
- `src/statistics-state.js` — 통계 상태 정규화, 동일 상태 판정, 렌더 키 생성.
- `src/statistics-data-source.js` — IndexedDB 캐시와 시간 제한 Firestore 서버 자료 로드.
- `src/statistics-view.js` — 통계 뷰 모델과 순수 HTML 생성.
- `src/statistics-feature.js` — 단일 DOM 소유자와 이벤트·렌더·상태 저장 오케스트레이션.
- `src/statistics-bootstrap.js` — Firebase와 오프라인 런타임을 통계 기능에 연결.
- `tests/statistics-state.test.js` — 상태 정규화와 중복 렌더 방지 단위 테스트.
- `tests/statistics-data-source.test.js` — 캐시 우선, 서버 제한시간, 사용자 전환 테스트.
- `tests/statistics-view.test.js` — 월 옵션, 0분 표시, 오류 화면 순수 렌더 테스트.
- `tests/browser/statistics-feature.spec.mjs` — 새 통계 기능 실제 클릭·성능·반복 전환 테스트.

### Modify

- `package.json`, `package-lock.json` — Playwright 의존성과 테스트 명령.
- `src/app.js` — 화면 전환 후 `weekly-time-budget:view-changed` 이벤트 한 번 발생.
- `src/recorded-period-navigation.js` — 통계 관련 DOM·이벤트·Observer 책임 제거, 대시보드 기간 이동만 유지.
- `src/statistics-primary.css` — 런타임 삽입 스타일과 모바일 오버플로 스타일 통합.
- `index.html` — 새 bootstrap 로드, 과거 통계·모바일 스타일 스크립트 제거, 빌드 식별자 추가.
- `service-worker.js` — 셸/런타임 캐시 분리, 구형 동일 출처 자산 제거, 새 통계 파일 캐시.
- `.github/workflows/ci.yml` — Chromium 설치·브라우저 테스트·새 산출물 검사.
- 기존 통계 계약 테스트 — 소스 문자열 검사 대신 새 모듈 경계와 삭제 파일을 검증.

### Delete

- `src/statistics-offline-rescue.js`
- `src/statistics-ui.js`
- `src/statistics-session-state.js`
- `src/statistics-mobile-overflow.js`
- `tests/monthly-statistics-observer-ownership.test.js`
- `tests/monthly-statistics-zero-loop.test.js`
- 기존 구조만 고정하는 `tests/statistics-single-renderer.test.js`

---

### Task 1: Browser Reproduction and Root-Cause Gate

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Create: `playwright.config.mjs`
- Create: `tests/browser/fixtures/statistics-current.html`
- Create: `tests/browser/support/fake-firebase-routes.mjs`
- Create: `tests/browser/statistics-current-flow.spec.mjs`
- Create: `tests/browser/pwa-cache-generation.spec.mjs`
- Create after running tests: `docs/debug/2026-08-01-monthly-statistics-root-cause.md`

**Interfaces:**
- Produces: `installFakeFirebaseRoutes(page, fixture)` and two executable browser regressions.
- Gate: Task 2 may start only after at least one browser test fails on the current product and the failure is recorded in the debug document.

- [ ] **Step 1: Add Playwright and scripts**

Update `package.json` while preserving existing commands:

```json
{
  "scripts": {
    "test": "node --test",
    "test:browser": "playwright test",
    "test:all": "npm test && npm run test:browser",
    "prepare:icons": "node scripts/materialize-icons.mjs",
    "start": "npm run prepare:icons && npx serve .",
    "prepare:pages": "node scripts/prepare-pages-site.mjs"
  },
  "devDependencies": {
    "@playwright/test": "^1.54.0",
    "serve": "^14.2.4"
  }
}
```

Run:

```bash
npm install
```

Expected: `package-lock.json` records `@playwright/test` and no production dependency is added.

- [ ] **Step 2: Configure one Chromium worker and the existing static server**

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

- [ ] **Step 3: Create a minimal current-module browser fixture**

Create `tests/browser/fixtures/statistics-current.html`:

```html
<!doctype html>
<html lang="ko">
<head><meta charset="utf-8"><title>Statistics current flow</title></head>
<body>
  <aside class="sidebar"><button class="nav-button" data-view="statistics">통계</button></aside>
  <p id="week-label"></p>
  <h1 id="page-title"></h1>
  <section id="statistics-view" class="view hidden"></section>
  <script type="module" src="/src/statistics-offline-rescue.js"></script>
</body>
</html>
```

- [ ] **Step 4: Route Firebase CDN modules to deterministic fakes**

Create `tests/browser/support/fake-firebase-routes.mjs` with this public interface:

```js
export async function installFakeFirebaseRoutes(page, fixture) {
  await page.addInitScript((value) => {
    globalThis.__statisticsFixture = value;
  }, fixture);

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
      export const onAuthStateChanged = (_auth, callback) => { queueMicrotask(() => callback(user)); return () => {}; };
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

- [ ] **Step 5: Write the current monthly-click browser regression**

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

test('현재 월간 통계 클릭은 2초 안에 완료되고 반복 전환 후에도 응답한다', async ({ page }) => {
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

- [ ] **Step 6: Write the stale runtime-cache generation regression**

Create `tests/browser/pwa-cache-generation.spec.mjs`:

```js
import { test, expect } from '@playwright/test';

test('구형 runtime 캐시가 최신 통계 셸 파일보다 먼저 반환되지 않는다', async ({ page, context }) => {
  await page.goto('/');
  await page.evaluate(async () => {
    const registrations = await navigator.serviceWorker.getRegistrations();
    await Promise.all(registrations.map((registration) => registration.unregister()));
    const names = await caches.keys();
    await Promise.all(names.map((name) => caches.delete(name)));
    const runtime = await caches.open('weekly-time-budget-runtime-v1');
    await runtime.put('/src/statistics-offline-rescue.js', new Response('/* stale-statistics-v13 */', {
      headers: { 'Content-Type': 'text/javascript' },
    }));
  });
  await page.reload();
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null);
  const source = await page.evaluate(() => fetch('/src/statistics-offline-rescue.js').then((response) => response.text()));
  expect(source).not.toContain('stale-statistics-v13');
  await context.clearCookies();
});
```

Expected on current `main`: this test must fail if `caches.match()` returns the old runtime entry before the v15 shell entry.

- [ ] **Step 7: Run only the diagnostic browser tests**

Run:

```bash
npx playwright install chromium
npm run test:browser -- tests/browser/statistics-current-flow.spec.mjs tests/browser/pwa-cache-generation.spec.mjs
```

Expected: at least one test FAILS. Save the Playwright trace for the failing test.

- [ ] **Step 8: Record the observed root cause before product changes**

Create `docs/debug/2026-08-01-monthly-statistics-root-cause.md` containing:

```markdown
# 월간 통계 멈춤 브라우저 재현 결과

- 재현 커밋: `<sha>`
- 실패 테스트: `<exact test title>`
- 사용자 동작: 통계 → 월간 통계
- 관찰 결과: `<timeout, repeated render, stale asset, exception 중 실제 결과>`
- 최초 실패 단계: `<data load | state | aggregate | render | observer | service worker>`
- 실행 횟수: `<render / state-save / network counts>`
- 확정 원인: `<증거로 확인한 원인만 기록>`
- 배제한 가설: `<테스트로 배제한 항목>`
```

Do not write a guessed cause. Attach exact console output or trace observation.

- [ ] **Step 9: Commit the diagnostic gate**

```bash
git add package.json package-lock.json playwright.config.mjs tests/browser docs/debug/2026-08-01-monthly-statistics-root-cause.md
git commit -m "test: reproduce monthly statistics browser failure"
```

---

### Task 2: Pure Statistics State and Render-Key Domain

**Files:**
- Create: `src/statistics-state.js`
- Create: `tests/statistics-state.test.js`

**Interfaces:**
- Produces:
  - `createStatisticsState({ now, restored })`
  - `applyStatisticsAction(state, action, context)` → `{ state, changed }`
  - `statisticsRenderKey(state)` → string
- Consumes: `coerceMonthlySelection`, `coerceRecordedPeriodSelection` from `recorded-period-domain.js`.

- [ ] **Step 1: Write failing state tests**

Create `tests/statistics-state.test.js`:

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

test('같은 월간 모드를 다시 선택하면 상태와 렌더 키가 바뀌지 않는다', () => {
  const initial = createStatisticsState({
    now: new Date('2026-08-01T12:00:00'),
    restored: { mode: 'monthly', year: 2026, month: 8 },
  });
  const result = applyStatisticsAction(initial, { type: 'select-mode', mode: 'monthly' }, context);
  assert.equal(result.changed, false);
  assert.equal(statisticsRenderKey(result.state), statisticsRenderKey(initial));
});

test('기록 없는 과거 월은 이전 기록 월로 보정한다', () => {
  const initial = createStatisticsState({ now: new Date('2026-08-01T12:00:00') });
  const result = applyStatisticsAction(initial, {
    type: 'select-month', year: 2026, month: 7,
  }, context);
  assert.deepEqual(
    { year: result.state.year, month: result.state.month },
    { year: 2026, month: 6 },
  );
});

test('dataVersion이 바뀌면 같은 기간도 새 렌더 키를 만든다', () => {
  const initial = { ...createStatisticsState({ now: new Date('2026-08-01T12:00:00') }), dataVersion: 'cache:1' };
  const next = { ...initial, dataVersion: 'server:2' };
  assert.notEqual(statisticsRenderKey(initial), statisticsRenderKey(next));
});
```

- [ ] **Step 2: Run and verify RED**

```bash
node --test tests/statistics-state.test.js
```

Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `statistics-state.js`.

- [ ] **Step 3: Implement the state module**

Create `src/statistics-state.js` with exact state fields:

```js
import {
  coerceMonthlySelection,
  coerceRecordedPeriodSelection,
} from './recorded-period-domain.js';
import { getWeekRange } from './domain.js';

const MODES = new Set(['weekly', 'monthly', 'yearly', 'monthly-comparison', 'yearly-comparison']);

export function createStatisticsState({ now = new Date(), restored = {} } = {}) {
  const currentWeekStart = getWeekRange(now).start;
  return {
    mode: MODES.has(restored.mode) ? restored.mode : 'weekly',
    weekStart: restored.weekStart || currentWeekStart,
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

export function applyStatisticsAction(state, action, context) {
  let next = state;
  if (action.type === 'select-mode' && MODES.has(action.mode)) {
    next = { ...state, mode: action.mode, warning: '', renderError: null };
  } else if (action.type === 'select-week') {
    next = {
      ...state,
      weekStart: coerceRecordedPeriodSelection({
        selected: action.weekStart,
        current: context.currentWeekStart,
        recordedPeriods: context.recordedWeekStarts,
      }),
    };
  } else if (action.type === 'select-month') {
    const selected = coerceMonthlySelection({
      year: action.year,
      month: action.month,
      currentYear: context.currentYear,
      currentMonth: context.currentMonth,
      recordedMonths: context.recordedMonths,
    });
    next = { ...state, ...selected, warning: '', renderError: null };
  } else if (action.type === 'replace-data') {
    next = {
      ...state,
      data: action.data,
      dataVersion: action.dataVersion,
      source: action.source,
      loadStatus: 'ready',
      warning: action.warning || '',
      renderError: null,
    };
  } else if (action.type === 'load-status') {
    next = { ...state, loadStatus: action.status, warning: action.warning || state.warning };
  } else if (action.type === 'render-error') {
    next = { ...state, renderError: action.error };
  }
  return { state: next, changed: statisticsRenderKey(next) !== statisticsRenderKey(state)
    || next.loadStatus !== state.loadStatus
    || next.warning !== state.warning
    || next.renderError !== state.renderError };
}

export function statisticsRenderKey(state) {
  const period = state.mode === 'weekly'
    ? state.weekStart
    : state.mode === 'yearly-comparison'
      ? 'all'
      : state.mode === 'monthly'
        ? `${state.year}-${String(state.month).padStart(2, '0')}`
        : String(state.year);
  return [state.dataVersion, state.mode, period].join('|');
}
```

Before committing, ensure selecting an already active mode returns `changed: false`; use a shallow equality guard if the initial implementation creates a new object with an identical render key.

- [ ] **Step 4: Run tests and commit**

```bash
node --test tests/statistics-state.test.js
git add src/statistics-state.js tests/statistics-state.test.js
git commit -m "feat: add deterministic statistics state"
```

---

### Task 3: Cache-First Statistics Data Source

**Files:**
- Create: `src/statistics-data-source.js`
- Create: `tests/statistics-data-source.test.js`

**Interfaces:**
- Produces `createStatisticsDataSource({ firestore, db, runtimeForUser, timeoutMs, clock })`.
- Returned object exposes:
  - `readCache(userId)` → snapshot or `null`
  - `readServer(userId)` → snapshot
  - `load(userId, { onCache, onServer })` → final snapshot
- Snapshot shape: `{ data, dataVersion, source }`.

- [ ] **Step 1: Write failing data-source tests**

Tests must use fake Firestore documents and a fake runtime store. Include these cases:

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

test('서버 제한시간이 지나도 캐시 결과를 유지한다', async () => {
  const source = createStatisticsDataSource(fixtureDependencies({ serverNeverResolves: true, timeoutMs: 10 }));
  const result = await source.load('u1', { onCache() {}, onServer() {} });
  assert.equal(result.source, 'cache');
  assert.match(result.warning, /서버 응답/);
});

test('다른 사용자 스냅숏을 읽지 않는다', async () => {
  const source = createStatisticsDataSource(fixtureDependencies());
  const result = await source.readCache('u2');
  assert.equal(result, null);
});
```

- [ ] **Step 2: Run and verify RED**

```bash
node --test tests/statistics-data-source.test.js
```

Expected: FAIL because the module does not exist.

- [ ] **Step 3: Implement cache and server normalization**

The production implementation must:

```js
export function createStatisticsDataSource({
  firestore,
  db,
  runtimeForUser,
  timeoutMs = 8000,
  clock = () => Date.now(),
}) { /* ... */ }
```

Use `runtime.store.getSnapshot(userId)`, `runtime.mergedEntries(remoteEntries)`, and `runtime.store.patchSnapshot(userId, { statisticsData: ... })`. Read active categories from `snapshot.statisticsData.activeCategories` or `snapshot.categories`, archived categories from `snapshot.statisticsData.archivedCategories` or `snapshot.archivedCategories`, and weekly budgets from `snapshot.statisticsData.weeklyBudgets` or `snapshot.weeklyBudgets` or `[snapshot.weeklyBudget]`.

Generate versions as:

```js
const dataVersion = `${source}:${Number(updatedAt) || 0}`;
```

For a server snapshot use the injected `clock()` for `updatedAt`. Race the Firestore `Promise.all` against a timeout, but do not let a timed-out request later call `onServer`.

- [ ] **Step 4: Run tests and commit**

```bash
node --test tests/statistics-data-source.test.js
git add src/statistics-data-source.js tests/statistics-data-source.test.js
git commit -m "feat: isolate statistics data loading"
```

---

### Task 4: Pure Statistics View Model and HTML

**Files:**
- Create: `src/statistics-view.js`
- Create: `tests/statistics-view.test.js`
- Modify: `src/statistics-primary.css`

**Interfaces:**
- Produces:
  - `buildStatisticsViewModel(state, { now })`
  - `renderStatisticsHtml(model)`
  - `renderStatisticsFailure({ mode, stage, message })`
- Consumes summary functions from `domain.js` and month/week functions from `recorded-period-domain.js`.

- [ ] **Step 1: Write failing view tests**

Cover exact output contracts:

```js
test('월간 옵션은 기록 월과 이번 달만 활성화한다', () => {
  const model = buildStatisticsViewModel(monthlyState, { now: new Date('2026-08-01T12:00:00') });
  assert.equal(model.monthOptions.find((item) => item.month === 6).disabled, false);
  assert.equal(model.monthOptions.find((item) => item.month === 7).disabled, true);
  assert.equal(model.monthOptions.find((item) => item.month === 8).disabled, false);
  assert.equal(model.monthOptions.find((item) => item.month === 9).disabled, true);
});

test('예산과 기록이 모두 0분이면 처음부터 목표 준수 —를 출력한다', () => {
  const html = renderStatisticsHtml(emptyMonthlyModel);
  assert.match(html, /<p class="muted">목표 준수<\/p><div class="metric">—<\/div>/);
});

test('렌더 오류는 다시 시도 버튼과 실패 단계를 표시한다', () => {
  const html = renderStatisticsFailure({ mode: 'monthly', stage: '월간 집계', message: 'invalid date' });
  assert.match(html, /월간 통계를 표시하지 못했습니다/);
  assert.match(html, /월간 집계/);
  assert.match(html, /data-statistics-retry/);
});
```

- [ ] **Step 2: Run and verify RED**

```bash
node --test tests/statistics-view.test.js
```

- [ ] **Step 3: Implement view-model construction**

`buildStatisticsViewModel` must:

1. Build the period index with `buildRecordedPeriodIndex(state.data.entries, todayKey)`.
2. Build the category list by active category overriding archived category with the same ID.
3. Call exactly one of the five summary/comparison functions based on `state.mode`.
4. Return controls, summary cards, category rows or comparison rows as plain objects.
5. Return `achievementText: '—'` when total budget and actual are both zero; do not patch the DOM afterward.
6. Use `monthOptionStates()` for monthly options and `recordedYearOptions()` for years.

- [ ] **Step 4: Implement pure HTML and merge all statistics CSS**

Move these runtime styles into `src/statistics-primary.css`:

- `.statistics-rescue-banner` and warning/action variants
- `.statistics-rescue-table` desktop and mobile layout
- all rules currently injected by `statistics-mobile-overflow.js`
- disabled month option `.is-unavailable`

Do not keep JavaScript style injection in the new files.

- [ ] **Step 5: Run tests and commit**

```bash
node --test tests/statistics-view.test.js
git add src/statistics-view.js src/statistics-primary.css tests/statistics-view.test.js
git commit -m "feat: render statistics from a pure view model"
```

---

### Task 5: Single Statistics Feature Controller and App View Event

**Files:**
- Create: `src/statistics-feature.js`
- Create: `src/statistics-bootstrap.js`
- Modify: `src/app.js`
- Create/Modify: `tests/browser/statistics-feature.spec.mjs`

**Interfaces:**
- Produces `createStatisticsFeature(options)` with methods `enter()`, `leave()`, `restore(saved)`, `refresh()`, and `destroy()`.
- Options:

```js
{
  root,
  dataSource,
  getCurrentUser,
  saveUiState,
  setHeader,
  now,
  diagnostics,
}
```

- [ ] **Step 1: Write browser tests against an injected fake data source**

`tests/browser/statistics-feature.spec.mjs` must import the real `createStatisticsFeature` inside a fixture page or via `page.evaluate(import(...))`. Use a fake data source that counts cache/server reads.

Required tests:

```js
test('월간 탭은 네트워크 재조회 없이 한 번 렌더한다', async ({ page }) => {
  // enter() 후 cacheReads === 1, serverReads === 1
  // 월간 클릭 후 두 값은 그대로이고 renderCount는 정확히 1 증가
});

test('같은 월간 탭을 다시 클릭하면 렌더와 상태 저장을 생략한다', async ({ page }) => {
  // 두 번째 동일 클릭 후 renderCount와 saveCount 불변
});

test('캐시에서 서버 dataVersion으로 바뀔 때만 한 번 추가 렌더한다', async ({ page }) => {
  // cache:1 렌더 후 server:2 렌더, 총 2회
});
```

- [ ] **Step 2: Run and verify RED**

```bash
npm run test:browser -- tests/browser/statistics-feature.spec.mjs
```

- [ ] **Step 3: Implement the controller without document-level interception**

The controller must attach exactly these listeners:

```js
root.addEventListener('click', onClick);
root.addEventListener('change', onChange);
```

It must not attach a `MutationObserver`, and it must not call `stopImmediatePropagation()` for navigation.

Use these counters when `diagnostics` is supplied:

```js
diagnostics.modeChanges += 1;
diagnostics.aggregateRuns += 1;
diagnostics.renderRuns += 1;
diagnostics.stateSaves += 1;
```

Before rendering, compare `statisticsRenderKey(nextState)` with the last rendered key. Catch and display failures separately for `period-index`, `aggregate`, `html`, and `dom` stages.

- [ ] **Step 4: Add a single app view-change event**

At the end of `switchView()` in `src/app.js`, after classes and title are updated, dispatch:

```js
document.dispatchEvent(new CustomEvent('weekly-time-budget:view-changed', {
  detail: { view: safe },
}));
```

Do not dispatch when the requested view is already active unless `restoreVisibleState()` is explicitly restoring after login; add an option such as `{ save = true, notify = true }` if necessary.

- [ ] **Step 5: Wire production dependencies in `statistics-bootstrap.js`**

The bootstrap may import Firebase CDN modules. It must:

1. Create `dataSource` with `getExistingOfflineRuntime`.
2. Create the feature with `#statistics-view`.
3. Listen for `weekly-time-budget:view-changed` and call `enter()`/`leave()`.
4. Listen for `weekly-time-budget:ui-state-restored` and call `restore()` directly, never click a button.
5. Listen for `weekly-time-budget:data-changed` and call `refresh()` only while the statistics view is visible.
6. Publish `window.__weeklyTimeBudgetDiagnostics.statistics` in non-production-neutral form as counters only; do not include user data.

- [ ] **Step 6: Run focused and full tests, then commit**

```bash
node --test tests/statistics-state.test.js tests/statistics-data-source.test.js tests/statistics-view.test.js
npm run test:browser -- tests/browser/statistics-feature.spec.mjs
git add src/app.js src/statistics-feature.js src/statistics-bootstrap.js tests/browser/statistics-feature.spec.mjs
git commit -m "feat: make statistics a single owned feature"
```

---

### Task 6: Remove Legacy Statistics Ownership and Dead Code

**Files:**
- Modify: `src/recorded-period-navigation.js`
- Modify: `index.html`
- Delete: `src/statistics-offline-rescue.js`
- Delete: `src/statistics-ui.js`
- Delete: `src/statistics-session-state.js`
- Delete: `src/statistics-mobile-overflow.js`
- Delete/replace: legacy statistics structure tests

**Interfaces:**
- `recorded-period-navigation.js` continues to own dashboard recorded-date/week navigation only.
- `statistics-bootstrap.js` is the only loaded statistics script.

- [ ] **Step 1: Write a failing ownership contract test**

Create or replace `tests/statistics-ownership.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

async function missing(path) {
  try { await access(new URL(`../${path}`, import.meta.url)); return false; }
  catch { return true; }
}

test('통계 화면은 새 bootstrap 하나만 로드한다', async () => {
  const html = await read('index.html');
  assert.match(html, /src="\.\/src\/statistics-bootstrap\.js"/);
  assert.doesNotMatch(html, /statistics-offline-rescue|statistics-ui|statistics-session-state|statistics-mobile-overflow/);
});

test('기록 기간 모듈은 통계 DOM을 참조하지 않는다', async () => {
  const source = await read('src/recorded-period-navigation.js');
  assert.doesNotMatch(source, /statistics-view|data-rescue-stat-mode|statistics-rescue-month|patchStatistics/);
});

test('과거 통계 제품 파일은 삭제한다', async () => {
  for (const path of [
    'src/statistics-offline-rescue.js',
    'src/statistics-ui.js',
    'src/statistics-session-state.js',
    'src/statistics-mobile-overflow.js',
  ]) assert.equal(await missing(path), true, path);
});
```

- [ ] **Step 2: Run and verify RED**

```bash
node --test tests/statistics-ownership.test.js
```

- [ ] **Step 3: Remove statistics code from recorded-period navigation**

Delete all of these responsibilities from `src/recorded-period-navigation.js`:

- `statisticsWeekModel`
- `patchZeroAchievement`
- `optionMarkup`
- `replaceSelectOptions`
- `patchMonthlyStatistics`
- `patchStatistics`
- `statisticsWeekClick`
- statistics year/month `change` capture handler
- statistics selectors in `patchUnreadyControls`

Keep `refreshPeriods()` because dashboard navigation still needs the index. The module may listen to data changes but must only patch dashboard controls.

- [ ] **Step 4: Update HTML and delete old product files**

In `index.html`:

```html
<script type="module" src="./src/statistics-bootstrap.js"></script>
```

Remove the four old statistics script references. Add a diagnostic build marker:

```html
<html lang="ko" data-app-build="statistics-v16">
```

Delete the four old files and the three obsolete source-string tests.

- [ ] **Step 5: Run tests and commit**

```bash
node --test tests/statistics-ownership.test.js
npm test
git add -A
git commit -m "refactor: remove legacy statistics ownership"
```

---

### Task 7: Full Monthly Browser Regression, Data Shapes, and Performance

**Files:**
- Modify: `tests/browser/statistics-feature.spec.mjs`
- Create or modify fixture helpers under `tests/browser/support/`

**Interfaces:**
- Consumes `window.__weeklyTimeBudgetDiagnostics.statistics` counters.
- Produces release-blocking browser tests for all supported statistics modes.

- [ ] **Step 1: Add fixture builders**

Create helper functions:

```js
export function emptyStatisticsFixture() { /* empty arrays */ }
export function legacyCategoryFixture() { /* category without createdDate */ }
export function restraintFixture() { /* growth + restraint + archived categories */ }
export function largeStatisticsFixture({ years = 5, entriesPerDay = 20 } = {}) { /* deterministic records */ }
```

The large fixture must create at least 30,000 entries without randomness.

- [ ] **Step 2: Add the release-blocking browser cases**

Required cases:

1. Empty account: monthly view displays within 2 seconds and target compliance is `—`.
2. Existing category without `createdDate`: appears in past monthly statistics.
3. New category with `createdDate`: excluded before creation month/day.
4. Restraint goal: individual negative percentage remains visible and aggregate calculation matches domain output.
5. Archived category: included when the selected period contains its records or budget.
6. Invalid saved month: corrected using previous → next → current order.
7. Recordless and future month options: disabled.
8. Weekly → monthly → weekly repeated 20 times: no console/page errors.
9. All five modes remain selectable after repeated transitions.
10. Large fixture: monthly click visible within 2 seconds and `aggregateRuns` duration below 1 second.

Use browser performance marks around aggregation:

```js
performance.mark('statistics-aggregate-start');
// aggregate
performance.mark('statistics-aggregate-end');
performance.measure('statistics-aggregate', 'statistics-aggregate-start', 'statistics-aggregate-end');
```

Assert the latest measure duration.

- [ ] **Step 3: Run focused tests until GREEN**

```bash
npm run test:browser -- tests/browser/statistics-feature.spec.mjs
```

Expected: all cases PASS with no retries.

- [ ] **Step 4: Commit**

```bash
git add tests/browser
git commit -m "test: cover monthly statistics in a real browser"
```

---

### Task 8: PWA Cache Generation Isolation and Upgrade Safety

**Files:**
- Modify: `service-worker.js`
- Modify: `tests/browser/pwa-cache-generation.spec.mjs`
- Modify: existing service-worker tests

**Interfaces:**
- Same-origin app files are read only from `SHELL_CACHE`.
- Firebase CDN modules are read only from `FIREBASE_RUNTIME_CACHE`.
- Old `weekly-time-budget-*` caches are deleted on activation.

- [ ] **Step 1: Expand the failing PWA browser test**

Prepopulate:

- `weekly-time-budget-runtime-v1` with stale statistics JavaScript.
- `weekly-time-budget-shell-v13`, `v14`, and `v15` with stale HTML/CSS/JS markers.

After installing the new worker assert:

```js
expect(await caches.keys()).toEqual(expect.arrayContaining([
  'weekly-time-budget-shell-v16',
  'weekly-time-budget-firebase-runtime-v2',
]));
expect(await caches.keys()).not.toEqual(expect.arrayContaining([
  'weekly-time-budget-runtime-v1',
  'weekly-time-budget-shell-v13',
  'weekly-time-budget-shell-v14',
  'weekly-time-budget-shell-v15',
]));
```

Fetch `index.html`, `statistics-bootstrap.js`, `statistics-primary.css`, and assert none contains a stale marker.

- [ ] **Step 2: Run and verify RED**

```bash
npm run test:browser -- tests/browser/pwa-cache-generation.spec.mjs
```

- [ ] **Step 3: Implement cache-specific lookup**

In `service-worker.js` use:

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

Never call global `caches.match(request)` for app assets. In `activate`, delete every cache beginning with `weekly-time-budget-` except the two current names.

Update `SHELL_URLS`:

- add `statistics-state.js`, `statistics-data-source.js`, `statistics-view.js`, `statistics-feature.js`, `statistics-bootstrap.js`
- remove all four deleted statistics files

- [ ] **Step 4: Update unit contracts and run PWA browser tests**

```bash
node --test tests/*service-worker*.test.js
npm run test:browser -- tests/browser/pwa-cache-generation.spec.mjs
```

- [ ] **Step 5: Commit**

```bash
git add service-worker.js tests
git commit -m "fix: isolate PWA asset cache generations"
```

---

### Task 9: CI, Pages Artifact, and Final Verification

**Files:**
- Modify: `.github/workflows/ci.yml`
- Modify: Pages/deployment contract tests if present
- Verify: `scripts/prepare-pages-site.mjs`

**Interfaces:**
- CI runs unit and browser suites.
- Pages artifact contains only the new statistics product files.

- [ ] **Step 1: Update CI commands**

Change the workflow test section to:

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

Keep failed-output upload. Add Playwright traces/videos to the failure artifact:

```yaml
path: |
  test-output.txt
  test-results/
  playwright-report/
```

- [ ] **Step 2: Replace obsolete Pages file checks**

The artifact verification must require:

```bash
test -f _site/src/statistics-state.js
test -f _site/src/statistics-data-source.js
test -f _site/src/statistics-view.js
test -f _site/src/statistics-feature.js
test -f _site/src/statistics-bootstrap.js
test -f _site/src/statistics-primary.css
```

And reject old files:

```bash
test ! -f _site/src/statistics-offline-rescue.js
test ! -f _site/src/statistics-ui.js
test ! -f _site/src/statistics-session-state.js
test ! -f _site/src/statistics-mobile-overflow.js
```

- [ ] **Step 3: Run every local verification command from a clean checkout**

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

Then run the same required/forbidden file checks against `_site`.

- [ ] **Step 4: Verify no dead references remain**

```bash
grep -R "statistics-offline-rescue\|statistics-session-state\|statistics-mobile-overflow\|statistics-ui.js" \
  --exclude-dir=.git --exclude='2026-08-01-statistics-subsystem-rebuild-design.md' \
  --exclude='2026-08-01-statistics-subsystem-rebuild.md' .
```

Expected: no product, test, workflow, or service-worker reference. Historical design documents may remain.

- [ ] **Step 5: Compare performance and diagnostics to completion criteria**

Record in the PR body:

- empty account monthly display duration
- large fixture monthly display duration
- large fixture aggregate duration
- 20-switch render count
- cache→server allowed render count
- browser console/page error count
- old cache names removed

- [ ] **Step 6: Final commit**

```bash
git add -A
git commit -m "ci: verify statistics browser stability"
```

- [ ] **Step 7: Request review before merge**

Use the requesting-code-review skill. Review specifically for:

- a second statistics DOM owner
- any `document.body` observer touching statistics
- network calls from mode/year/month handlers
- stale same-origin assets in runtime cache
- mismatch between browser tests and real production bootstrap
- accidental changes to goal calculations or category effective-date semantics

Do not merge until the branch CI passes on the final head and the reviewer findings are resolved.
