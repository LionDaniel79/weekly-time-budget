# Countdown Timer Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 기존 카운트업 타이머를 보존하면서 오늘 예산 기반 카운트다운을 기본 방식으로 추가하고, 음수 초과 표시·일시정지·자동 저장·복구를 지원한다.

**Architecture:** 카운트다운 계산과 서명된 시간 표시를 새 순수 도메인 모듈로 분리하고, 기존 `persistent-timer.js` 컨트롤러는 방식과 기준값을 저장하도록 확장한다. `persistent-timer-ui.js`는 기존 오프라인 스냅숏과 Firestore의 예산·기록 자료를 읽어 시작 기준값을 만들고, 현재의 local-first 기록 저장 경로를 그대로 재사용한다.

**Tech Stack:** ES modules, browser DOM APIs, Firebase 11.10.0 Auth/Firestore, localStorage, IndexedDB local-first runtime, Node.js `node:test`, GitHub Pages PWA/service worker.

## Global Constraints

- 화면과 데이터 방식 순서는 정확히 `countdown | countup`이다.
- 활성 타이머가 없을 때 새 타이머 기본 방식은 `countdown`이다.
- `mode`가 없는 기존 활성 타이머는 `countup`으로 복원한다.
- 기존 카운트업의 계산, 일시정지, 저장, 복구와 버튼 문구를 유지한다.
- 카운트다운은 알람, 진동, 시스템 알림, 0 도달 선택창을 사용하지 않는다.
- 카운트다운은 `00:00:00` 다음에 `-00:00:01`로 중단 없이 진행한다.
- 카운트다운 실행 중에는 대분류를 변경할 수 없고, 멈춘 뒤 변경하면 기존 실행을 자동 저장한다.
- 자정이 지나도 시작 날짜의 예산과 기록으로 저장한다.
- 새 타이머 기록에는 `timerMode: 'countdown' | 'countup'`을 저장한다.
- 서비스 워커 셸 캐시는 `weekly-time-budget-shell-v8`로 올린다.
- 새 외부 의존성을 추가하지 않는다.

---

## File Structure

- Create: `src/countdown-timer-domain.js` — 방식 정규화, 카운트다운 기준값, 표시 밀리초와 서명 시간 문자열을 계산하는 순수 함수.
- Modify: `src/persistent-timer.js` — 새 타이머 기본 `countdown`, 기존 스냅숏 기본 `countup`, 카운트다운 전용 필드 보존, 공통 표시값 API.
- Modify: `src/time-budget-domain.js` — 일간 예산과 해당 날짜·대분류 기록 합계로 카운트다운 기준값 생성.
- Modify: `src/persistent-timer-ui.js` — 예산 자료 로딩, 방식 탭, 미실행 미리보기, 시작·멈춤·저장·취소, 멈춘 타이머의 대분류 전환 자동 저장.
- Modify: `src/mobile-compact.css` — 카운트다운·카운트업 분할 탭과 음수 표시의 모바일 레이아웃.
- Modify: `service-worker.js` — v8 캐시와 새 모듈 포함.
- Test: `tests/countdown-timer-domain.test.js` — 순수 계산과 표시 경계.
- Test: `tests/time-budget-domain.test.js` — 오늘 예산·기록 기준값.
- Test: `tests/persistent-timer.test.js` — 새 기본값과 기존 데이터 호환, 일시정지·복구.
- Test: `tests/countdown-timer-ui.test.js` — 탭 순서, 버튼 문구, 잠금, 자동 저장 계약.
- Modify: `tests/offline-app-integration.test.js`, `tests/recorded-period-pages.test.js` — 새 모듈·v8 앱 셸 검증.

---

### Task 1: 카운트다운 순수 도메인

**Files:**
- Create: `src/countdown-timer-domain.js`
- Create: `tests/countdown-timer-domain.test.js`

**Interfaces:**
- Produces: `TIMER_MODES`, `normalizeStoredTimerMode(mode)`, `normalizeNewTimerMode(mode)`, `buildCountdownBaseline(input)`, `timerDisplayMilliseconds(timer, elapsedMs)`, `formatSignedTimerMilliseconds(value)`.
- Consumes: 숫자형 예산·기록·경과시간만 사용하며 브라우저 또는 Firebase에 의존하지 않는다.

- [ ] **Step 1: 방식 기본값과 표시 계산의 실패 테스트 작성**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildCountdownBaseline,
  formatSignedTimerMilliseconds,
  normalizeNewTimerMode,
  normalizeStoredTimerMode,
  timerDisplayMilliseconds,
} from '../src/countdown-timer-domain.js';

test('새 타이머 기본은 countdown이고 mode 없는 저장 타이머는 countup이다', () => {
  assert.equal(normalizeNewTimerMode(), 'countdown');
  assert.equal(normalizeStoredTimerMode(), 'countup');
  assert.equal(normalizeStoredTimerMode('countdown'), 'countdown');
  assert.equal(normalizeStoredTimerMode('unknown'), 'countup');
});

test('예산과 기존 기록으로 시작 기준값을 만든다', () => {
  assert.deepEqual(buildCountdownBaseline({ budgetMinutes: 120, recordedMinutes: 45 }), {
    initialBudgetMinutes: 120,
    priorRecordedMinutes: 45,
    initialRemainingMs: 75 * 60_000,
  });
  assert.equal(buildCountdownBaseline({ budgetMinutes: 120, recordedMinutes: 145 }).initialRemainingMs, -25 * 60_000);
});

test('0을 지나 음수로 연속 표시한다', () => {
  const timer = { mode: 'countdown', initialRemainingMs: 2_000 };
  assert.equal(formatSignedTimerMilliseconds(timerDisplayMilliseconds(timer, 1_000)), '00:00:01');
  assert.equal(formatSignedTimerMilliseconds(timerDisplayMilliseconds(timer, 2_000)), '00:00:00');
  assert.equal(formatSignedTimerMilliseconds(timerDisplayMilliseconds(timer, 3_000)), '-00:00:01');
});
```

- [ ] **Step 2: 실패 확인**

Run: `node --test tests/countdown-timer-domain.test.js`

Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `src/countdown-timer-domain.js`.

- [ ] **Step 3: 최소 순수 도메인 구현**

```js
export const TIMER_MODES = Object.freeze(['countdown', 'countup']);

export const normalizeStoredTimerMode = (mode) => mode === 'countdown' ? 'countdown' : 'countup';
export const normalizeNewTimerMode = (mode) => mode === 'countup' ? 'countup' : 'countdown';

const wholeMinutes = (value) => Math.max(0, Math.round(Number(value) || 0));

export function buildCountdownBaseline({ budgetMinutes, recordedMinutes }) {
  const initialBudgetMinutes = wholeMinutes(budgetMinutes);
  const priorRecordedMinutes = wholeMinutes(recordedMinutes);
  return {
    initialBudgetMinutes,
    priorRecordedMinutes,
    initialRemainingMs: (initialBudgetMinutes - priorRecordedMinutes) * 60_000,
  };
}

export function timerDisplayMilliseconds(timer, elapsedMs = 0) {
  const elapsed = Math.max(0, Number(elapsedMs) || 0);
  return normalizeStoredTimerMode(timer?.mode) === 'countdown'
    ? Number(timer?.initialRemainingMs || 0) - elapsed
    : elapsed;
}

export function formatSignedTimerMilliseconds(value) {
  const milliseconds = Number(value) || 0;
  const sign = milliseconds < 0 ? '-' : '';
  const totalSeconds = Math.floor(Math.abs(milliseconds) / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return `${sign}${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}
```

- [ ] **Step 4: 경계 테스트 추가**

```js
test('100시간 이상과 0분 예산을 표시한다', () => {
  assert.equal(formatSignedTimerMilliseconds(101 * 3_600_000), '101:00:00');
  assert.equal(formatSignedTimerMilliseconds(-101 * 3_600_000), '-101:00:00');
  assert.equal(buildCountdownBaseline({ budgetMinutes: 0, recordedMinutes: 0 }).initialRemainingMs, 0);
  assert.equal(buildCountdownBaseline({ budgetMinutes: 0, recordedMinutes: 25 }).initialRemainingMs, -25 * 60_000);
});
```

- [ ] **Step 5: 테스트 통과 확인 및 커밋**

Run: `node --test tests/countdown-timer-domain.test.js`

Expected: PASS.

```bash
git add src/countdown-timer-domain.js tests/countdown-timer-domain.test.js
git commit -m "feat: add countdown timer domain"
```

---

### Task 2: 오늘 예산과 기록 기준값 계산

**Files:**
- Modify: `src/time-budget-domain.js`
- Modify: `tests/time-budget-domain.test.js`

**Interfaces:**
- Consumes: 기존 `resolveDailyBudget(...)`, `buildCountdownBaseline(...)`.
- Produces: `resolveCountdownBudgetBaseline({ category, date, entries, weekDocument, dailyDocument, defaultDayWeights })`.

- [ ] **Step 1: 실패 테스트 작성**

```js
import { resolveCountdownBudgetBaseline } from '../src/time-budget-domain.js';

test('카운트다운 기준값은 직접 일간 예산과 오늘 기록을 사용한다', () => {
  const result = resolveCountdownBudgetBaseline({
    category: { id: 'reading', defaultBudgetMinutes: 300 },
    date: '2026-07-28',
    entries: [
      { categoryId: 'reading', date: '2026-07-28', durationMinutes: 30 },
      { categoryId: 'reading', date: '2026-07-28', durationMinutes: 15 },
      { categoryId: 'reading', date: '2026-07-27', durationMinutes: 90 },
      { categoryId: 'other', date: '2026-07-28', durationMinutes: 60 },
    ],
    weekDocument: { budgets: { reading: 210 } },
    dailyDocument: { overrides: { reading: 120 } },
  });
  assert.equal(result.initialBudgetMinutes, 120);
  assert.equal(result.priorRecordedMinutes, 45);
  assert.equal(result.initialRemainingMs, 75 * 60_000);
  assert.equal(result.budgetSource, 'direct');
});
```

- [ ] **Step 2: 실패 확인**

Run: `node --test tests/time-budget-domain.test.js --test-name-pattern="카운트다운 기준값"`

Expected: FAIL because `resolveCountdownBudgetBaseline` is not exported.

- [ ] **Step 3: 구현**

```js
import { buildCountdownBaseline } from './countdown-timer-domain.js';

export function resolveCountdownBudgetBaseline({
  category,
  date,
  entries = [],
  weekDocument,
  dailyDocument,
  defaultDayWeights = EQUAL_DAY_WEIGHTS,
}) {
  const budget = resolveDailyBudget({ category, date, weekDocument, dailyDocument, defaultDayWeights });
  const recordedMinutes = entries
    .filter((entry) => entry.date === date && entry.categoryId === category.id)
    .reduce((sum, entry) => sum + Math.max(0, Number(entry.durationMinutes) || 0), 0);
  return {
    ...buildCountdownBaseline({ budgetMinutes: budget.minutes, recordedMinutes }),
    budgetSource: budget.source,
  };
}
```

- [ ] **Step 4: 주간 배분·음수·동기화 대기 병합 입력 테스트 추가**

```js
test('직접 예산이 없으면 주간 요일 배분을 쓰고 초과는 음수다', () => {
  const result = resolveCountdownBudgetBaseline({
    category: { id: 'reading', defaultBudgetMinutes: 70 },
    date: '2026-07-27',
    entries: [{ categoryId: 'reading', date: '2026-07-27', durationMinutes: 25, syncStatus: 'pending' }],
    weekDocument: { budgets: { reading: 140 }, dayWeights: { mon: 1, tue: 0, wed: 0, thu: 0, fri: 0, sat: 0, sun: 0 } },
    dailyDocument: null,
  });
  assert.equal(result.initialBudgetMinutes, 140);
  assert.equal(result.priorRecordedMinutes, 25);
  assert.equal(result.initialRemainingMs, 115 * 60_000);
});
```

- [ ] **Step 5: 테스트와 커밋**

Run: `node --test tests/time-budget-domain.test.js tests/countdown-timer-domain.test.js`

Expected: PASS.

```bash
git add src/time-budget-domain.js tests/time-budget-domain.test.js
git commit -m "feat: resolve countdown budget baseline"
```

---

### Task 3: 영속 타이머 방식과 기존 데이터 호환

**Files:**
- Modify: `src/persistent-timer.js`
- Modify: `tests/persistent-timer.test.js`

**Interfaces:**
- Consumes: `normalizeNewTimerMode`, `normalizeStoredTimerMode`, `timerDisplayMilliseconds`.
- Produces: `createTimerSnapshot(input)` with `mode`; `controller.displayMilliseconds()`; normalized countdown fields.

- [ ] **Step 1: 새 기본값과 기존 저장 데이터 호환 실패 테스트 작성**

```js
test('새 타이머는 countdown이고 mode 없는 기존 타이머는 countup이다', () => {
  const created = createTimerSnapshot({
    userId: 'u1', categoryId: 'reading', startedAt: 1_000,
    initialBudgetMinutes: 120, priorRecordedMinutes: 45, initialRemainingMs: 75 * 60_000,
  });
  assert.equal(created.mode, 'countdown');
  assert.equal(normalizeTimerSnapshot({ userId: 'u1', categoryId: 'legacy', startedAt: 1_000 }).mode, 'countup');
});

test('저장된 countup과 countdown을 각각 복원한다', () => {
  assert.equal(normalizeTimerSnapshot({ startedAt: 1_000, mode: 'countup' }).mode, 'countup');
  const countdown = normalizeTimerSnapshot({ startedAt: 1_000, mode: 'countdown', initialRemainingMs: 60_000 });
  assert.equal(countdown.mode, 'countdown');
  assert.equal(countdown.initialRemainingMs, 60_000);
});
```

- [ ] **Step 2: 실패 확인**

Run: `node --test tests/persistent-timer.test.js --test-name-pattern="새 타이머|저장된 countup"`

Expected: FAIL because mode is not persisted.

- [ ] **Step 3: 스냅숏 생성·정규화 구현**

```js
import {
  normalizeNewTimerMode,
  normalizeStoredTimerMode,
  timerDisplayMilliseconds,
} from './countdown-timer-domain.js';

export function normalizeTimerSnapshot(timer) {
  if (!timer) return null;
  // existing timestamp and pause normalization remains
  const mode = normalizeStoredTimerMode(timer.mode);
  return {
    ...timer,
    mode,
    initialRemainingMs: mode === 'countdown' ? Number(timer.initialRemainingMs) : undefined,
    // existing normalized fields
  };
}

export function createTimerSnapshot(input) {
  const mode = normalizeNewTimerMode(input.mode);
  if (mode === 'countdown' && !Number.isFinite(Number(input.initialRemainingMs))) {
    throw new Error('카운트다운 시작 시간이 올바르지 않습니다.');
  }
  return {
    // existing fields
    mode,
    ...(mode === 'countdown' ? {
      budgetDate: input.budgetDate || input.startedDate,
      initialBudgetMinutes: Number(input.initialBudgetMinutes),
      priorRecordedMinutes: Number(input.priorRecordedMinutes),
      initialRemainingMs: Number(input.initialRemainingMs),
    } : {}),
  };
}
```

- [ ] **Step 4: 컨트롤러 표시 API와 일시정지 테스트 추가**

```js
test('countdown은 멈춘 동안 표시값이 고정되고 계속 후 다시 감소한다', async () => {
  let clock = 1_000;
  const controller = createPersistentTimerController({ remote: remoteStore(), storage: memoryStorage(), storageKey: 'timer', now: () => clock });
  await controller.start({
    userId: 'u1', categoryId: 'reading', mode: 'countdown',
    initialBudgetMinutes: 2, priorRecordedMinutes: 0, initialRemainingMs: 120_000,
  });
  clock = 61_000;
  assert.equal(controller.displayMilliseconds(), 60_000);
  await controller.pause();
  clock = 121_000;
  assert.equal(controller.displayMilliseconds(), 60_000);
  await controller.resume();
  clock = 181_000;
  assert.equal(controller.displayMilliseconds(), 0);
  clock = 182_000;
  assert.equal(controller.displayMilliseconds(), -1_000);
});
```

Implement in the controller:

```js
displayMilliseconds() {
  return timerDisplayMilliseconds(active, elapsedMilliseconds(active, now()));
}
```

- [ ] **Step 5: 기존 카운트업 회귀 테스트 보강**

```js
test('mode 없는 기존 활성 타이머의 표시와 저장은 기존 countup이다', async () => {
  let clock = 61_000;
  const storage = memoryStorage();
  storage.setItem('timer', JSON.stringify({ userId: 'u1', categoryId: 'legacy', startedAt: 1_000, resumedAt: 1_000, running: true }));
  const controller = createPersistentTimerController({ remote: remoteStore(null), storage, storageKey: 'timer', now: () => clock });
  await controller.recover();
  assert.equal(controller.active.mode, 'countup');
  assert.equal(controller.displayMilliseconds(), 60_000);
});
```

- [ ] **Step 6: 테스트와 커밋**

Run: `node --test tests/persistent-timer.test.js tests/countdown-timer-domain.test.js`

Expected: PASS with all existing persistent timer tests unchanged.

```bash
git add src/persistent-timer.js tests/persistent-timer.test.js
git commit -m "feat: persist countdown and countup timer modes"
```

---

### Task 4: 예산 자료 로딩과 카운트다운 화면

**Files:**
- Modify: `src/persistent-timer-ui.js`
- Create: `tests/countdown-timer-ui.test.js`

**Interfaces:**
- Consumes: `resolveCountdownBudgetBaseline`, `formatSignedTimerMilliseconds`, controller `displayMilliseconds()`.
- Produces: countdown-first mode tabs, baseline preview, mode-aware start and button labels.

- [ ] **Step 1: UI 정적 계약 실패 테스트 작성**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../src/persistent-timer-ui.js', import.meta.url), 'utf8');

test('타이머 방식 탭은 카운트 다운, 카운트 업 순서다', () => {
  const countdown = source.indexOf('data-timer-mode="countdown"');
  const countup = source.indexOf('data-timer-mode="countup"');
  assert.ok(countdown >= 0 && countup > countdown);
  assert.ok(source.includes('카운트 다운'));
  assert.ok(source.includes('카운트 업'));
});

test('카운트다운은 저장, 카운트업은 종료하고 저장을 사용한다', () => {
  assert.ok(source.includes("timer.mode === 'countdown' ? '저장' : '종료하고 저장'"));
});

test('알람과 0 도달 선택창을 만들지 않는다', () => {
  assert.doesNotMatch(source, /AudioContext|new Audio|vibrate|Notification|중단하고 저장|계속할지/);
});
```

- [ ] **Step 2: 실패 확인**

Run: `node --test tests/countdown-timer-ui.test.js`

Expected: FAIL because mode tabs do not exist.

- [ ] **Step 3: UI 상태와 예산 자료 로딩 추가**

Extend state with:

```js
selectedMode: 'countdown',
selectedCategoryId: '',
entries: [],
weekly: [],
daily: [],
defaultDayWeights: { ...EQUAL_DAY_WEIGHTS },
budgetReady: false,
previewBaseline: null,
```

Extend category/data loading to read the current offline snapshot first, then Firestore:

```js
const cached = await state.runtime.store.getSnapshot(state.user.uid);
state.entries = await state.runtime.mergedEntries(Array.isArray(cached?.entries) ? cached.entries : []);
state.weekly = Array.isArray(cached?.weeklyBudgets) ? cached.weeklyBudgets : [];
state.daily = Array.isArray(cached?.dailyBudgets) ? cached.dailyBudgets : [];
state.defaultDayWeights = effectiveDayWeights(null, cached?.defaultDayWeights || EQUAL_DAY_WEIGHTS);
```

Remote load must fetch `entries`, `weeklyBudgets`, `dailyBudgets`, and `settings/timeBudget`, then patch the same snapshot keys used by `time-budget-feature.js`.

- [ ] **Step 4: 선택 대분류 기준값 계산 함수 추가**

```js
function countdownBaselineFor(categoryId, date = localDateKey(new Date())) {
  const category = state.categories.find((item) => item.id === categoryId);
  if (!category || !state.budgetReady) return null;
  const weekStart = getWeekRange(new Date(`${date}T12:00:00`)).start;
  const weekDocument = state.weekly.find((item) => (item.weekStart || item.id) === weekStart) || null;
  const dailyDocument = state.daily.find((item) => (item.date || item.id) === date) || null;
  return resolveCountdownBudgetBaseline({
    category, date, entries: state.entries, weekDocument, dailyDocument,
    defaultDayWeights: state.defaultDayWeights,
  });
}
```

- [ ] **Step 5: 모드 탭과 미리보기 렌더링 구현**

Required HTML contract:

```html
<div class="timer-mode-tabs" role="tablist" aria-label="타이머 방식">
  <button type="button" data-timer-mode="countdown" role="tab">카운트 다운</button>
  <button type="button" data-timer-mode="countup" role="tab">카운트 업</button>
</div>
```

Rules:

```js
const mode = timer?.mode || state.selectedMode;
const displayMs = timer
  ? state.controller.displayMilliseconds()
  : mode === 'countdown' && state.previewBaseline
    ? state.previewBaseline.initialRemainingMs
    : 0;
const displayText = formatSignedTimerMilliseconds(displayMs);
const saveLabel = timer?.mode === 'countdown' ? '저장' : '종료하고 저장';
```

When an active timer exists, both mode buttons remain visible, the active one has `aria-selected="true"`, and the other is disabled.

- [ ] **Step 6: 모드 선택·대분류 선택 이벤트 구현**

```js
if (modeButton) {
  if (state.controller?.active) return;
  state.selectedMode = modeButton.dataset.timerMode;
  state.previewBaseline = state.selectedMode === 'countdown'
    ? countdownBaselineFor(state.selectedCategoryId)
    : null;
  renderTimer();
}
```

For an inactive countdown, category change updates `selectedCategoryId`, calculates `previewBaseline`, and rerenders. While `budgetReady === false`, show `예산 계산 중` and disable start.

- [ ] **Step 7: 모드별 시작 데이터와 저장 기록 구현**

Countdown start input:

```js
const baseline = countdownBaselineFor(categoryId, startedDate);
await state.controller.start({
  userId: state.user.uid,
  categoryId,
  note,
  startedDate,
  mode: state.selectedMode,
  ...(state.selectedMode === 'countdown' ? {
    budgetDate: startedDate,
    ...baseline,
  } : {}),
});
```

Saved entry:

```js
{
  categoryId: timer.categoryId,
  note: timer.note,
  date: timer.startedDate,
  durationMinutes,
  startTime: new Date(timer.startedAt).toTimeString().slice(0, 5),
  endTime: new Date(endedAt).toTimeString().slice(0, 5),
  source: 'timer',
  timerMode: timer.mode,
}
```

- [ ] **Step 8: UI 테스트와 기존 타이머 UI 테스트 실행**

Run: `node --test tests/countdown-timer-ui.test.js tests/persistent-timer-pause-ui.test.js tests/statistics-monthly-timer-resume-regression.test.js`

Expected: PASS.

- [ ] **Step 9: 커밋**

```bash
git add src/persistent-timer-ui.js tests/countdown-timer-ui.test.js
git commit -m "feat: add countdown-first timer interface"
```

---

### Task 5: 멈춘 카운트다운 대분류 전환 자동 저장

**Files:**
- Modify: `src/persistent-timer-ui.js`
- Modify: `tests/countdown-timer-ui.test.js`
- Modify: `tests/persistent-timer.test.js`

**Interfaces:**
- Consumes: existing `controller.stop(buildEntry)` local-first completion path.
- Produces: `saveActiveTimer()` and `handleCountdownCategoryChange(nextCategoryId)`.

- [ ] **Step 1: 실행 중 잠금과 멈춤 후 전환 계약 테스트 작성**

```js
test('카운트다운 실행 중에는 대분류를 잠그고 멈춘 상태에서는 변경을 처리한다', () => {
  assert.match(source, /timer\.mode === 'countdown'[\s\S]*timer\.running !== false[\s\S]*disabled/);
  assert.ok(source.includes('handleCountdownCategoryChange'));
  assert.ok(source.includes('await saveActiveTimer'));
});
```

- [ ] **Step 2: 저장 경로를 공통 함수로 추출**

```js
async function saveActiveTimer() {
  const result = await state.controller.stop((timer, { endedAt, durationMinutes }) => ({
    categoryId: timer.categoryId,
    note: timer.note,
    date: timer.startedDate,
    durationMinutes,
    startTime: new Date(timer.startedAt).toTimeString().slice(0, 5),
    endTime: new Date(endedAt).toTimeString().slice(0, 5),
    source: 'timer',
    timerMode: timer.mode,
  }));
  showEntrySaveResult(result.completion);
  dispatchEntryChange();
  return result;
}
```

The existing main save button must call this function without changing countup behavior.

- [ ] **Step 3: paused countdown category transition 구현**

```js
async function handleCountdownCategoryChange(nextCategoryId) {
  const timer = state.controller?.active;
  if (!timer || timer.mode !== 'countdown' || timer.running !== false) return;
  const previousCategoryId = timer.categoryId;
  try {
    await saveActiveTimer();
    await refreshTimerData();
    state.selectedCategoryId = nextCategoryId;
    state.previewBaseline = countdownBaselineFor(nextCategoryId);
    renderTimer();
  } catch (error) {
    state.selectedCategoryId = previousCategoryId;
    renderTimer();
    showToast({ type: 'error', title: '기존 카운트다운을 저장하지 못했습니다.', message: error.message });
  }
}
```

The select is disabled for countup active timers and running countdown timers, but enabled for paused countdown timers.

- [ ] **Step 4: 자동 저장 후 최신 기록을 반영하는 테스트 추가**

Use a controller test with a fake `complete` function and assert:

```js
assert.equal(savedEntry.timerMode, 'countdown');
assert.equal(savedEntry.durationMinutes, 20);
assert.equal(controller.active, null);
```

UI contract must assert `weekly-time-budget:entries-changed` is dispatched before recomputing the next baseline.

- [ ] **Step 5: 실패 롤백 테스트 추가**

```js
test('자동 저장 실패 시 활성 타이머를 유지한다', async () => {
  // controller.stop complete throws
  await assert.rejects(() => controller.stop(() => ({})), /save failed/);
  assert.equal(controller.active.categoryId, 'reading');
  assert.equal(controller.active.running, false);
});
```

- [ ] **Step 6: 관련 테스트와 커밋**

Run: `node --test tests/countdown-timer-ui.test.js tests/persistent-timer.test.js tests/offline-entry-repository.test.js`

Expected: PASS.

```bash
git add src/persistent-timer-ui.js tests/countdown-timer-ui.test.js tests/persistent-timer.test.js
git commit -m "feat: auto-save paused countdown on category change"
```

---

### Task 6: 분할 탭 스타일과 PWA 캐시

**Files:**
- Modify: `src/mobile-compact.css`
- Modify: `service-worker.js`
- Modify: `tests/offline-app-integration.test.js`
- Modify: `tests/recorded-period-pages.test.js`

**Interfaces:**
- Consumes: `.timer-mode-tabs`, `[data-timer-mode]`, `.timer.is-negative` classes.
- Produces: responsive two-column tabs and v8 cached deployment.

- [ ] **Step 1: 스타일·캐시 실패 테스트 추가**

```js
test('카운트다운 모듈과 v8 셸 캐시를 배포한다', async () => {
  const [html, css, worker] = await Promise.all([
    read('index.html'), read('src/mobile-compact.css'), read('service-worker.js'),
  ]);
  assert.ok(css.includes('.timer-mode-tabs'));
  assert.ok(css.includes('grid-template-columns: repeat(2, minmax(0, 1fr))'));
  assert.ok(worker.includes("weekly-time-budget-shell-v8"));
  assert.ok(worker.includes('./src/countdown-timer-domain.js'));
});
```

- [ ] **Step 2: CSS 구현**

```css
.timer-mode-tabs {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 4px;
  margin-bottom: 16px;
  padding: 4px;
  border-radius: 12px;
  background: #eef2ef;
}

.timer-mode-tabs [data-timer-mode] {
  min-width: 0;
  white-space: nowrap;
}

.timer-mode-tabs [aria-selected="true"] {
  background: #173b33;
  color: #fff;
}

.timer.is-negative {
  font-variant-numeric: tabular-nums;
}
```

Do not specify alarm or flashing animation styles.

- [ ] **Step 3: 서비스 워커 갱신**

```js
const SHELL_CACHE = 'weekly-time-budget-shell-v8';
```

Add `./src/countdown-timer-domain.js` to `SHELL_URLS`.

- [ ] **Step 4: Pages 산출물 검증 갱신**

`tests/recorded-period-pages.test.js` must verify:

```js
await access(path.join(outputDir, 'src', 'countdown-timer-domain.js'));
assert.ok(serviceWorker.includes('weekly-time-budget-shell-v8'));
assert.ok(serviceWorker.includes('./src/countdown-timer-domain.js'));
```

- [ ] **Step 5: 통합 테스트와 커밋**

Run: `node --test tests/offline-app-integration.test.js tests/recorded-period-pages.test.js tests/countdown-timer-ui.test.js`

Expected: PASS.

```bash
git add src/mobile-compact.css service-worker.js tests/offline-app-integration.test.js tests/recorded-period-pages.test.js
git commit -m "feat: style and cache countdown timer mode"
```

---

### Task 7: 전체 회귀 검증과 PR 준비

**Files:**
- Modify only files required by failed tests; do not add unrelated refactors.

**Interfaces:**
- Consumes: all prior task outputs.
- Produces: a merge-ready PR with green CI and Pages artifact.

- [ ] **Step 1: 전체 테스트 실행**

Run: `npm test`

Expected: all tests PASS, including all existing countup, offline, statistics, recorded-period and Pages tests.

- [ ] **Step 2: 자바스크립트 문법 검사**

Run:

```bash
node --check src/countdown-timer-domain.js
node --check src/persistent-timer.js
node --check src/persistent-timer-ui.js
node --check src/time-budget-domain.js
node --check service-worker.js
```

Expected: exit code 0 for every file.

- [ ] **Step 3: Pages 산출물 생성**

Run: `npm run prepare:pages`

Expected: `_site/src/countdown-timer-domain.js` exists and `_site/service-worker.js` contains `weekly-time-budget-shell-v8`.

- [ ] **Step 4: 요구사항 정적 확인**

Run:

```bash
grep -n "data-timer-mode=\"countdown\"\|data-timer-mode=\"countup\"" src/persistent-timer-ui.js
grep -n "timerMode" src/persistent-timer-ui.js
grep -n "weekly-time-budget-shell-v8" service-worker.js
```

Expected:

- `countdown` markup appears before `countup`.
- saved entry contains `timerMode`.
- service worker uses exactly v8.

- [ ] **Step 5: 최종 diff 검토**

Run: `git diff main...HEAD --stat && git diff main...HEAD`

Verify:

- no alarm, vibration, notification or 0-reached dialog code exists;
- missing stored `mode` normalizes to `countup`;
- new UI defaults to `countdown`;
- countup button text remains `종료하고 저장`;
- countdown button text is `저장`;
- no unrelated UI or data migration changes are present.

- [ ] **Step 6: 최종 커밋과 PR 설명 갱신**

```bash
git add -A
git commit -m "test: verify countdown timer integration"
```

Create or update a draft PR with:

```markdown
## 구현
- 카운트다운·카운트업 분할 탭, countdown 기본
- 기존 mode 없는 활성 타이머는 countup 호환
- 오늘 예산과 오늘 누적 기록 기반 시작값
- 0 이후 무음 음수 카운트다운
- 일시정지·저장·취소와 대분류 전환 자동 저장
- 자정 통과 시작 날짜 유지
- PWA 셸 캐시 v8

## 검증
- npm test
- npm run prepare:pages
- countdown domain, legacy countup, offline, Pages 회귀 테스트
```
