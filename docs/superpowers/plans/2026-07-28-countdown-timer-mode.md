# Countdown Timer Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 기존 카운트업 타이머를 보존하면서 오늘 예산 기반 카운트다운을 기본 화면 방식으로 추가한다.

**Architecture:** 카운트다운 계산은 새 순수 도메인 모듈로 분리한다. 사용자 화면은 새 타이머를 시작할 때 항상 `mode: 'countdown'` 또는 `mode: 'countup'`을 명시하고, 저수준 타이머 컨트롤러는 `mode`가 없는 기존 호출과 저장 데이터를 `countup`으로 보존한다.

**Tech Stack:** ES modules, Firebase 11.10.0 Auth/Firestore, localStorage, IndexedDB local-first runtime, Node.js `node:test`, GitHub Pages PWA.

## Global Constraints

- 화면 순서와 값 순서는 `countdown | countup`이다.
- 활성 타이머가 없을 때 화면 기본 선택은 `countdown`이다.
- `mode`가 없는 기존 활성 타이머와 저수준 시작 호출은 `countup`으로 호환한다.
- 화면은 새 타이머 시작 시 선택한 `mode`를 반드시 명시한다.
- 카운트업의 기존 계산, 일시정지, 저장, 복구, 버튼 문구를 유지한다.
- 카운트다운은 `00:00:00` 다음에 알람·진동·선택창 없이 `-00:00:01`로 진행한다.
- 카운트다운 실행 중 대분류 선택은 잠그고, 멈춘 뒤 변경하면 기존 실행을 자동 저장한다.
- 자정이 지나도 시작 날짜 기준으로 저장한다.
- 새 기록에는 `timerMode: 'countdown' | 'countup'`을 저장한다.
- 서비스 워커 셸 캐시는 `weekly-time-budget-shell-v8`로 올린다.
- 새 외부 의존성을 추가하지 않는다.

---

### Task 1: 카운트다운 계산 도메인

**Files:**
- Create: `src/countdown-timer-domain.js`
- Create: `tests/countdown-timer-domain.test.js`

**Interfaces:**
- Produces: `buildCountdownBaseline(input)`, `timerDisplayMilliseconds(timer, elapsedMs)`, `formatSignedTimerMilliseconds(value)`.

- [ ] **Step 1: 실패 테스트 작성**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildCountdownBaseline,
  timerDisplayMilliseconds,
  formatSignedTimerMilliseconds,
} from '../src/countdown-timer-domain.js';

test('예산 120분과 기록 45분은 75분을 남긴다', () => {
  assert.deepEqual(buildCountdownBaseline({ budgetMinutes: 120, recordedMinutes: 45 }), {
    initialBudgetMinutes: 120,
    priorRecordedMinutes: 45,
    initialRemainingMs: 75 * 60_000,
  });
});

test('0을 지나 음수로 계속 표시한다', () => {
  const timer = { mode: 'countdown', initialRemainingMs: 2_000 };
  assert.equal(formatSignedTimerMilliseconds(timerDisplayMilliseconds(timer, 1_000)), '00:00:01');
  assert.equal(formatSignedTimerMilliseconds(timerDisplayMilliseconds(timer, 2_000)), '00:00:00');
  assert.equal(formatSignedTimerMilliseconds(timerDisplayMilliseconds(timer, 3_000)), '-00:00:01');
});
```

- [ ] **Step 2: 실패 확인**

Run: `node --test tests/countdown-timer-domain.test.js`

Expected: FAIL with `ERR_MODULE_NOT_FOUND`.

- [ ] **Step 3: 최소 구현**

```js
const minutes = (value) => Math.max(0, Math.round(Number(value) || 0));

export function buildCountdownBaseline({ budgetMinutes, recordedMinutes }) {
  const initialBudgetMinutes = minutes(budgetMinutes);
  const priorRecordedMinutes = minutes(recordedMinutes);
  return {
    initialBudgetMinutes,
    priorRecordedMinutes,
    initialRemainingMs: (initialBudgetMinutes - priorRecordedMinutes) * 60_000,
  };
}

export function timerDisplayMilliseconds(timer, elapsedMs = 0) {
  const elapsed = Math.max(0, Number(elapsedMs) || 0);
  return timer?.mode === 'countdown'
    ? Number(timer.initialRemainingMs || 0) - elapsed
    : elapsed;
}

export function formatSignedTimerMilliseconds(value) {
  const number = Number(value) || 0;
  const sign = number < 0 ? '-' : '';
  const seconds = Math.floor(Math.abs(number) / 1000);
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return `${sign}${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}
```

- [ ] **Step 4: 경계 테스트 추가**

```js
test('예산 초과와 100시간 이상을 표시한다', () => {
  assert.equal(buildCountdownBaseline({ budgetMinutes: 120, recordedMinutes: 145 }).initialRemainingMs, -25 * 60_000);
  assert.equal(formatSignedTimerMilliseconds(101 * 3_600_000), '101:00:00');
  assert.equal(formatSignedTimerMilliseconds(-101 * 3_600_000), '-101:00:00');
});
```

- [ ] **Step 5: 테스트와 커밋**

Run: `node --test tests/countdown-timer-domain.test.js`

Expected: PASS.

```bash
git add src/countdown-timer-domain.js tests/countdown-timer-domain.test.js
git commit -m "feat: add countdown timer calculations"
```

---

### Task 2: 오늘 예산과 누적 기록 기준값

**Files:**
- Modify: `src/time-budget-domain.js`
- Modify: `tests/time-budget-domain.test.js`

**Interfaces:**
- Produces: `resolveCountdownBudgetBaseline({ category, date, entries, weekDocument, dailyDocument, defaultDayWeights })`.
- Consumes: existing `resolveDailyBudget(...)` and `buildCountdownBaseline(...)`.

- [ ] **Step 1: 실패 테스트 작성**

```js
test('직접 일간 예산에서 오늘 기록만 차감한다', () => {
  const result = resolveCountdownBudgetBaseline({
    category: { id: 'reading', defaultBudgetMinutes: 300 },
    date: '2026-07-28',
    entries: [
      { categoryId: 'reading', date: '2026-07-28', durationMinutes: 30 },
      { categoryId: 'reading', date: '2026-07-28', durationMinutes: 15 },
      { categoryId: 'reading', date: '2026-07-27', durationMinutes: 90 },
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

Run: `node --test tests/time-budget-domain.test.js --test-name-pattern="직접 일간 예산"`

Expected: FAIL because the export does not exist.

- [ ] **Step 3: 구현**

```js
import { buildCountdownBaseline } from './countdown-timer-domain.js';

export function resolveCountdownBudgetBaseline({
  category, date, entries = [], weekDocument, dailyDocument,
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

- [ ] **Step 4: 주간 배분·0분·음수 테스트 추가**

Add assertions for direct override absence, zero budget, pending local records, and recorded time larger than budget.

- [ ] **Step 5: 테스트와 커밋**

Run: `node --test tests/time-budget-domain.test.js tests/countdown-timer-domain.test.js`

Expected: PASS.

```bash
git add src/time-budget-domain.js tests/time-budget-domain.test.js
git commit -m "feat: resolve countdown budget baseline"
```

---

### Task 3: 영속 타이머 방식 저장과 호환

**Files:**
- Modify: `src/persistent-timer.js`
- Modify: `tests/persistent-timer.test.js`

**Interfaces:**
- Produces: normalized `mode`, preserved countdown fields, `controller.displayMilliseconds()`.
- Consumes: `timerDisplayMilliseconds(...)`.

- [ ] **Step 1: 호환 실패 테스트 작성**

```js
test('mode 없는 기존 타이머는 countup이다', () => {
  const legacy = normalizeTimerSnapshot({ userId: 'u1', categoryId: 'legacy', startedAt: 1_000 });
  assert.equal(legacy.mode, 'countup');
});

test('mode 없는 저수준 새 타이머 호출도 countup으로 보존한다', () => {
  const timer = createTimerSnapshot({ userId: 'u1', categoryId: 'reading', startedAt: 1_000 });
  assert.equal(timer.mode, 'countup');
});

test('명시한 countdown 기준값을 저장한다', () => {
  const timer = createTimerSnapshot({
    userId: 'u1', categoryId: 'reading', startedAt: 1_000,
    mode: 'countdown', budgetDate: '2026-07-28',
    initialBudgetMinutes: 120, priorRecordedMinutes: 45,
    initialRemainingMs: 75 * 60_000,
  });
  assert.equal(timer.mode, 'countdown');
  assert.equal(timer.initialRemainingMs, 75 * 60_000);
});
```

- [ ] **Step 2: 실패 확인**

Run: `node --test tests/persistent-timer.test.js --test-name-pattern="mode 없는|명시한 countdown"`

Expected: FAIL because `mode` is not normalized or stored.

- [ ] **Step 3: 정규화와 생성 구현**

```js
const normalizeMode = (mode) => mode === 'countdown' ? 'countdown' : 'countup';

export function normalizeTimerSnapshot(timer) {
  if (!timer) return null;
  const mode = normalizeMode(timer.mode);
  return {
    ...timer,
    mode,
    ...(mode === 'countdown' ? {
      budgetDate: timer.budgetDate || timer.startedDate,
      initialBudgetMinutes: Number(timer.initialBudgetMinutes),
      priorRecordedMinutes: Number(timer.priorRecordedMinutes),
      initialRemainingMs: Number(timer.initialRemainingMs),
    } : {}),
    // preserve existing pause normalization
  };
}

export function createTimerSnapshot(input) {
  const mode = normalizeMode(input.mode);
  if (mode === 'countdown' && !Number.isFinite(Number(input.initialRemainingMs))) {
    throw new Error('카운트다운 시작 시간이 올바르지 않습니다.');
  }
  return {
    // preserve existing fields
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

- [ ] **Step 4: 표시 API와 일시정지 테스트**

```js
test('countdown은 멈춘 동안 고정되고 계속 후 음수로 진행한다', async () => {
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
  clock = 182_000;
  assert.equal(controller.displayMilliseconds(), -1_000);
});
```

Add to the controller:

```js
displayMilliseconds() {
  return timerDisplayMilliseconds(active, elapsedMilliseconds(active, now()));
}
```

- [ ] **Step 5: 기존 카운트업 전체 회귀 테스트 실행**

Run: `node --test tests/persistent-timer.test.js tests/persistent-timer-cross-device.test.js`

Expected: PASS without changing legacy countup semantics.

- [ ] **Step 6: 커밋**

```bash
git add src/persistent-timer.js tests/persistent-timer.test.js
git commit -m "feat: persist timer modes with countup compatibility"
```

---

### Task 4: 카운트다운 기본 화면과 예산 자료 로딩

**Files:**
- Modify: `src/persistent-timer-ui.js`
- Create: `tests/countdown-timer-ui.test.js`

**Interfaces:**
- Consumes: `resolveCountdownBudgetBaseline`, `formatSignedTimerMilliseconds`, controller `displayMilliseconds()`.
- Produces: countdown-first tabs, preview, explicit mode start, mode-aware buttons.

- [ ] **Step 1: UI 실패 테스트 작성**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../src/persistent-timer-ui.js', import.meta.url), 'utf8');

test('카운트 다운 탭이 카운트 업보다 먼저다', () => {
  const down = source.indexOf('data-timer-mode="countdown"');
  const up = source.indexOf('data-timer-mode="countup"');
  assert.ok(down >= 0 && up > down);
});

test('새 화면 기본값과 시작 mode를 명시한다', () => {
  assert.ok(source.includes("selectedMode: 'countdown'"));
  assert.ok(source.includes('mode: state.selectedMode'));
});

test('알람과 0 도달 선택창을 만들지 않는다', () => {
  assert.doesNotMatch(source, /AudioContext|new Audio|vibrate|Notification|중단하고 저장|계속할지/);
});
```

- [ ] **Step 2: 실패 확인**

Run: `node --test tests/countdown-timer-ui.test.js`

Expected: FAIL because mode tabs do not exist.

- [ ] **Step 3: UI 상태와 데이터 로더 추가**

Extend state:

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

Create one named loader used by initial load, data-change refresh, and category auto-save:

```js
async function refreshTimerData() {
  const cached = await state.runtime.store.getSnapshot(state.user.uid);
  state.entries = await state.runtime.mergedEntries(Array.isArray(cached?.entries) ? cached.entries : []);
  state.weekly = Array.isArray(cached?.weeklyBudgets) ? cached.weeklyBudgets : [];
  state.daily = Array.isArray(cached?.dailyBudgets) ? cached.dailyBudgets : [];
  state.defaultDayWeights = effectiveDayWeights(null, cached?.defaultDayWeights || EQUAL_DAY_WEIGHTS);
  // fetch remote entries, weeklyBudgets, dailyBudgets, settings/timeBudget;
  // patch the same snapshot keys used by time-budget-feature.js;
  state.budgetReady = true;
}
```

- [ ] **Step 4: 기준값 계산 함수 추가**

```js
function countdownBaselineFor(categoryId, date = localDateKey(new Date())) {
  const category = state.categories.find((item) => item.id === categoryId);
  if (!category || !state.budgetReady) return null;
  const weekStart = getWeekRange(new Date(`${date}T12:00:00`)).start;
  return resolveCountdownBudgetBaseline({
    category,
    date,
    entries: state.entries,
    weekDocument: state.weekly.find((item) => (item.weekStart || item.id) === weekStart) || null,
    dailyDocument: state.daily.find((item) => (item.date || item.id) === date) || null,
    defaultDayWeights: state.defaultDayWeights,
  });
}
```

- [ ] **Step 5: 방식 탭과 표시 구현**

```html
<div class="timer-mode-tabs" role="tablist" aria-label="타이머 방식">
  <button type="button" data-timer-mode="countdown" role="tab">카운트 다운</button>
  <button type="button" data-timer-mode="countup" role="tab">카운트 업</button>
</div>
```

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

- [ ] **Step 6: 시작 시 mode와 기준값 명시**

```js
const startedDate = localDateKey(new Date());
const baseline = state.selectedMode === 'countdown'
  ? countdownBaselineFor(categoryId, startedDate)
  : null;

await state.controller.start({
  userId: state.user.uid,
  categoryId,
  note,
  startedDate,
  mode: state.selectedMode,
  ...(baseline ? { budgetDate: startedDate, ...baseline } : {}),
});
```

When countdown data is loading, display `예산 계산 중` and disable start. Countup start remains available without budget data.

- [ ] **Step 7: 저장 기록에 방식 추가**

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

- [ ] **Step 8: 테스트와 커밋**

Run: `node --test tests/countdown-timer-ui.test.js tests/persistent-timer-pause-ui.test.js tests/statistics-monthly-timer-resume-regression.test.js`

Expected: PASS.

```bash
git add src/persistent-timer-ui.js tests/countdown-timer-ui.test.js
git commit -m "feat: add countdown-first timer interface"
```

---

### Task 5: 멈춘 카운트다운의 대분류 전환 자동 저장

**Files:**
- Modify: `src/persistent-timer-ui.js`
- Modify: `tests/countdown-timer-ui.test.js`
- Modify: `tests/persistent-timer.test.js`

**Interfaces:**
- Produces: `saveActiveTimer()` and `handleCountdownCategoryChange(nextCategoryId)`.

- [ ] **Step 1: UI 계약 실패 테스트 작성**

```js
test('실행 중 대분류를 잠그고 멈춘 카운트다운 변경을 자동 저장한다', () => {
  assert.ok(source.includes('handleCountdownCategoryChange'));
  assert.ok(source.includes('await saveActiveTimer()'));
  assert.match(source, /timer\.mode === 'countdown'[\s\S]*timer\.running !== false[\s\S]*disabled/);
});
```

- [ ] **Step 2: 기존 저장 코드를 공통 함수로 추출**

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

- [ ] **Step 3: 대분류 변경 구현**

```js
async function handleCountdownCategoryChange(nextCategoryId) {
  const timer = state.controller?.active;
  if (!timer || timer.mode !== 'countdown' || timer.running !== false) return;
  try {
    await saveActiveTimer();
    await refreshTimerData();
    state.selectedCategoryId = nextCategoryId;
    state.previewBaseline = countdownBaselineFor(nextCategoryId);
    renderTimer();
  } catch (error) {
    renderTimer();
    showToast({ type: 'error', title: '기존 카운트다운을 저장하지 못했습니다.', message: error.message });
  }
}
```

Rules:

- active countup: category select disabled;
- running countdown: category select disabled;
- paused countdown: category select enabled;
- save failure: controller remains paused and rerender restores its category;
- save success: refresh merged records before calculating the next category.

- [ ] **Step 4: 저장 실패와 20분 자동 저장 테스트 추가**

Use fake clocks and `complete` callbacks to assert `durationMinutes`, `timerMode: 'countdown'`, active timer clearing only after success, and paused timer preservation after failure.

- [ ] **Step 5: 테스트와 커밋**

Run: `node --test tests/countdown-timer-ui.test.js tests/persistent-timer.test.js tests/offline-entry-repository.test.js`

Expected: PASS.

```bash
git add src/persistent-timer-ui.js tests/countdown-timer-ui.test.js tests/persistent-timer.test.js
git commit -m "feat: auto-save paused countdown on category change"
```

---

### Task 6: 스타일, PWA 캐시, 전체 검증

**Files:**
- Modify: `src/mobile-compact.css`
- Modify: `service-worker.js`
- Modify: `tests/offline-app-integration.test.js`
- Modify: `tests/recorded-period-pages.test.js`

**Interfaces:**
- Consumes: `.timer-mode-tabs`, `[data-timer-mode]`, `.timer.is-negative`.
- Produces: responsive tabs and v8 deployment artifact.

- [ ] **Step 1: 스타일·캐시 실패 테스트 작성**

```js
test('분할 탭과 v8 카운트다운 모듈을 배포한다', async () => {
  const [css, worker] = await Promise.all([
    read('src/mobile-compact.css'), read('service-worker.js'),
  ]);
  assert.ok(css.includes('.timer-mode-tabs'));
  assert.ok(css.includes('grid-template-columns: repeat(2, minmax(0, 1fr))'));
  assert.ok(worker.includes('weekly-time-budget-shell-v8'));
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
.timer-mode-tabs [data-timer-mode] { min-width: 0; white-space: nowrap; }
.timer-mode-tabs [aria-selected="true"] { background: #173b33; color: #fff; }
.timer.is-negative { font-variant-numeric: tabular-nums; }
```

- [ ] **Step 3: 서비스 워커 갱신**

```js
const SHELL_CACHE = 'weekly-time-budget-shell-v8';
```

Add `./src/countdown-timer-domain.js` to `SHELL_URLS`.

- [ ] **Step 4: Pages 검증 갱신**

```js
await access(path.join(outputDir, 'src', 'countdown-timer-domain.js'));
assert.ok(serviceWorker.includes('weekly-time-budget-shell-v8'));
assert.ok(serviceWorker.includes('./src/countdown-timer-domain.js'));
```

- [ ] **Step 5: 전체 테스트**

Run: `npm test`

Expected: all existing and new tests PASS.

- [ ] **Step 6: 문법과 Pages 산출물 검증**

```bash
node --check src/countdown-timer-domain.js
node --check src/persistent-timer.js
node --check src/persistent-timer-ui.js
node --check src/time-budget-domain.js
node --check service-worker.js
npm run prepare:pages
```

Expected: all commands exit 0 and `_site/src/countdown-timer-domain.js` exists.

- [ ] **Step 7: 최종 요구사항 검사**

Verify in the final diff:

- UI default and first tab are countdown;
- UI start always passes `mode: state.selectedMode`;
- missing stored/controller mode remains countup;
- countup keeps `종료하고 저장`;
- countdown uses `저장`;
- 0-reached alarm, vibration, notification, dialog code does not exist;
- service worker uses v8 only;
- no unrelated refactor is included.

- [ ] **Step 8: 커밋과 PR 준비**

```bash
git add -A
git commit -m "feat: add budget countdown timer mode"
```

PR body must list the two different defaults explicitly:

```markdown
- 사용자 화면의 새 타이머 기본값: countdown
- mode 없는 기존 활성 타이머 및 저수준 호출: countup
```
