# 기록 기간 중심 대시보드·통계 이동 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 과거 날짜·주·월은 실제 기록이 있는 기간만 이동하고, 오늘·이번 주·이번 달은 기록이 없어도 항상 표시되도록 대시보드와 통계의 기간 탐색을 통일한다.

**Architecture:** 새 `src/recorded-period-domain.js`가 서버 기록과 IndexedDB 대기·실패 기록이 병합된 최종 기록 배열에서 날짜·주·월·연도 인덱스를 만든다. 대시보드와 캐시 우선 통계 모듈은 이 순수 로직에서 이전·다음 목적지와 유효한 선택 기간을 받아 렌더링하며, 화면 상태 복원도 같은 보정 결과를 저장한다.

**Tech Stack:** Vanilla ES modules, Node.js `node:test`, Firebase Auth/Firestore, IndexedDB local-first runtime, Service Worker, GitHub Pages.

## Global Constraints

- 과거 기간은 유효한 `YYYY-MM-DD`와 `durationMinutes > 0`을 가진 실제 기록이 있을 때만 이동 대상으로 인정한다.
- 삭제 표시, 유효하지 않은 날짜, 0분·음수 기록은 기간 인덱스에서 제외한다.
- 오늘·이번 주·이번 달은 기록이 없어도 항상 표시하고 선택할 수 있다.
- 예산만 있고 실제 기록이 없는 과거 날짜·주·월은 이동 대상에서 제외한다.
- IndexedDB의 동기화 대기·실패 기록도 서버 기록과 동일하게 기간 인덱스에 포함한다.
- 미래 날짜·주·월은 이동 대상으로 만들지 않는다.
- 이동 대상이 없으면 버튼과 월 옵션을 숨기지 않고 실제 `disabled` 및 `aria-disabled="true"`로 표시한다.
- 기간 예산과 실제 기록이 모두 0이면 달성률은 `—`; 예산이 있고 실제 기록이 0이면 `0%`를 표시한다.
- 새 앱 셸 코드를 아이폰 웹앱에 반영하도록 서비스 워커 셸 캐시 버전을 `weekly-time-budget-shell-v5`로 올린다.

---

## File Map

- Create `src/recorded-period-domain.js`: 유효 기록 필터링, 날짜·주·월·연도 인덱스, 이전·다음 탐색, 선택 기간 보정, 월·연도 옵션 모델.
- Create `tests/recorded-period-domain.test.js`: 공통 기간 로직의 단위 테스트.
- Modify `src/time-budget-domain.js`: 기존 일간 탐색 API를 새 공통 도메인으로 재수출하고 오늘 달력 활성화를 보장.
- Modify `src/time-budget-feature.js`: 대시보드 일간·주간 선택 보정과 기록 주 점프 이동.
- Modify `src/time-budget-ui.js`: 주간 이전·다음 목적지에 따른 비활성 버튼 렌더링.
- Modify `tests/time-budget-domain.test.js`, `tests/time-budget-ui.test.js`: 오늘 활성화와 기록 주 점프 회귀 테스트.
- Modify `src/statistics-offline-rescue.js`: 주별 기록 주 이동, 월간 활성 월·연도 선택, 데이터 변경 후 보정.
- Modify `src/statistics-session-state.js`: 보정된 통계 상태를 복원 대상으로 사용하고 disabled 월을 재선택하지 않음.
- Create `tests/statistics-recorded-period-navigation.test.js`: 통계 제어 HTML·이벤트 연결 계약 테스트.
- Modify `service-worker.js`, `tests/offline-app-integration.test.js`, `tests/statistics-offline-rescue.test.js`: 새 모듈 캐시와 v5 검증.
- Modify `tests/pages-deployment.test.js`: Pages 산출물에 새 모듈 포함 검증.

---

### Task 1: 공통 기록 기간 도메인

**Files:**
- Create: `src/recorded-period-domain.js`
- Create: `tests/recorded-period-domain.test.js`

**Interfaces:**
- Produces: `buildRecordedPeriodIndex(entries, currentDateKey)` → `{ dates, weekStarts, months, years }`.
- Produces: `previousRecordedPeriod(periods, selected)` → `string | null`.
- Produces: `nextRecordedPeriodOrCurrent(periods, selected, current)` → `string | null`.
- Produces: `coerceRecordedPeriodSelection({ selected, current, recordedPeriods })` → 유효한 기간 문자열.
- Produces: `monthOptionStates({ recordedMonths, year, currentYear, currentMonth })` → `{ month, enabled, current }[]`.
- Produces: `recordedYearOptions(recordedYears, currentYear)` → 내림차순 숫자 배열.
- Produces: `defaultMonthForYear({ year, currentYear, currentMonth, recordedMonths })` → `number | null`.

- [ ] **Step 1: 실패 단위 테스트 작성**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildRecordedPeriodIndex,
  previousRecordedPeriod,
  nextRecordedPeriodOrCurrent,
  coerceRecordedPeriodSelection,
  monthOptionStates,
  recordedYearOptions,
  defaultMonthForYear,
} from '../src/recorded-period-domain.js';

test('유효한 양수 기록만 날짜·주·월·연도 인덱스에 포함한다', () => {
  const index = buildRecordedPeriodIndex([
    { date: '2026-07-06', durationMinutes: 30 },
    { date: '2026-07-20', durationMinutes: 60, syncStatus: 'pending' },
    { date: '2026-07-21', durationMinutes: 0 },
    { date: 'bad-date', durationMinutes: 20 },
    { date: '2026-08-01', durationMinutes: 20 },
  ], '2026-07-27');
  assert.deepEqual(index.dates, ['2026-07-06', '2026-07-20']);
  assert.deepEqual(index.weekStarts, ['2026-07-06', '2026-07-20']);
  assert.deepEqual(index.months, ['2026-07']);
  assert.deepEqual(index.years, [2026]);
});

test('주간 이동은 기록 없는 중간 주를 건너뛰고 마지막에는 이번 주로 간다', () => {
  const weeks = ['2026-07-06', '2026-07-20'];
  assert.equal(previousRecordedPeriod(weeks, '2026-07-27'), '2026-07-20');
  assert.equal(nextRecordedPeriodOrCurrent(weeks, '2026-07-06', '2026-07-27'), '2026-07-20');
  assert.equal(nextRecordedPeriodOrCurrent(weeks, '2026-07-20', '2026-07-27'), '2026-07-27');
  assert.equal(nextRecordedPeriodOrCurrent(weeks, '2026-07-27', '2026-07-27'), null);
});

test('무효한 과거 선택은 이전, 이후, 현재 순으로 보정한다', () => {
  assert.equal(coerceRecordedPeriodSelection({
    selected: '2026-07-13', current: '2026-07-27', recordedPeriods: ['2026-07-06', '2026-07-20'],
  }), '2026-07-06');
  assert.equal(coerceRecordedPeriodSelection({
    selected: '2026-07-01', current: '2026-07-27', recordedPeriods: ['2026-07-06'],
  }), '2026-07-06');
  assert.equal(coerceRecordedPeriodSelection({
    selected: '2026-08-03', current: '2026-07-27', recordedPeriods: ['2026-07-06'],
  }), '2026-07-27');
});

test('월 옵션은 기록 월과 이번 달만 활성화한다', () => {
  const options = monthOptionStates({
    recordedMonths: ['2026-03', '2026-05'], year: 2026, currentYear: 2026, currentMonth: 7,
  });
  assert.equal(options.find((item) => item.month === 3).enabled, true);
  assert.equal(options.find((item) => item.month === 4).enabled, false);
  assert.deepEqual(options.find((item) => item.month === 7), { month: 7, enabled: true, current: true });
  assert.equal(options.find((item) => item.month === 8).enabled, false);
  assert.deepEqual(recordedYearOptions([2024, 2026], 2026), [2026, 2024]);
  assert.equal(defaultMonthForYear({ year: 2026, currentYear: 2026, currentMonth: 7, recordedMonths: ['2026-03'] }), 7);
  assert.equal(defaultMonthForYear({ year: 2024, currentYear: 2026, currentMonth: 7, recordedMonths: ['2024-03', '2024-11'] }), 11);
});
```

- [ ] **Step 2: 실패 확인**

Run: `node --test tests/recorded-period-domain.test.js`

Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `src/recorded-period-domain.js`.

- [ ] **Step 3: 최소 순수 구현 작성**

```js
import { getWeekRange } from './domain.js';

const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/;
const uniqueSorted = (values) => [...new Set(values)].sort();

function validEntry(entry, currentDateKey) {
  return DATE_KEY.test(String(entry?.date || ''))
    && entry.date <= currentDateKey
    && Number(entry.durationMinutes) > 0
    && entry.deleted !== true;
}

export function buildRecordedPeriodIndex(entries = [], currentDateKey) {
  const valid = entries.filter((entry) => validEntry(entry, currentDateKey));
  const dates = uniqueSorted(valid.map((entry) => entry.date));
  const weekStarts = uniqueSorted(dates.map((date) => getWeekRange(new Date(`${date}T12:00:00`)).start));
  const months = uniqueSorted(dates.map((date) => date.slice(0, 7)));
  const years = [...new Set(months.map((month) => Number(month.slice(0, 4))))].sort((a, b) => a - b);
  return { dates, weekStarts, months, years };
}

export const previousRecordedPeriod = (periods, selected) => [...periods].reverse().find((item) => item < selected) || null;

export function nextRecordedPeriodOrCurrent(periods, selected, current) {
  if (selected >= current) return null;
  return periods.find((item) => item > selected) || current;
}

export function coerceRecordedPeriodSelection({ selected, current, recordedPeriods }) {
  if (!selected || selected > current) return current;
  if (selected === current || recordedPeriods.includes(selected)) return selected;
  return previousRecordedPeriod(recordedPeriods, selected)
    || recordedPeriods.find((item) => item > selected)
    || current;
}
```

Add the month/year helpers with the exact signatures above. For past years, only months in `recordedMonths` are enabled; for the current year, the current month is additionally enabled and all later months are disabled.

- [ ] **Step 4: 단위 테스트 통과 확인**

Run: `node --test tests/recorded-period-domain.test.js`

Expected: all tests PASS.

- [ ] **Step 5: 커밋**

```bash
git add src/recorded-period-domain.js tests/recorded-period-domain.test.js
git commit -m "feat: add recorded period navigation domain"
```

---

### Task 2: 일간 호환 API와 오늘 달력 활성화

**Files:**
- Modify: `src/time-budget-domain.js:126-158`
- Modify: `tests/time-budget-domain.test.js:64-81`

**Interfaces:**
- Consumes: Task 1의 `buildRecordedPeriodIndex`, `previousRecordedPeriod`, `nextRecordedPeriodOrCurrent`.
- Preserves: 기존 호출부용 `recordedDateKeys`, `previousRecordedDate`, `nextRecordedDateOrToday` 함수명.

- [ ] **Step 1: 기존 테스트를 새 규칙으로 수정**

```js
test('전날과 다음날은 양수 기록 날짜와 오늘 사이에서 이동한다', () => {
  const dates = recordedDateKeys([
    { date: '2026-07-20', durationMinutes: 30 },
    { date: '2026-07-24', durationMinutes: 0 },
    { date: '2026-07-26', durationMinutes: 15 },
  ], '2026-07-27');
  assert.deepEqual(dates, ['2026-07-20', '2026-07-26']);
  assert.equal(previousRecordedDate(dates, '2026-07-27'), '2026-07-26');
  assert.equal(nextRecordedDateOrToday(dates, '2026-07-26', '2026-07-27'), '2026-07-27');
});

test('달력은 기록 날짜와 오늘을 활성화하고 기록 없는 과거·미래를 막는다', () => {
  const cells = calendarMonthCells(2026, 7, ['2026-07-20'], '2026-07-26');
  assert.equal(cells.find((cell) => cell.date === '2026-07-20').disabled, false);
  assert.equal(cells.find((cell) => cell.date === '2026-07-21').disabled, true);
  assert.equal(cells.find((cell) => cell.date === '2026-07-26').disabled, false);
  assert.equal(cells.find((cell) => cell.date === '2026-07-27').disabled, true);
});
```

- [ ] **Step 2: 실패 확인**

Run: `node --test tests/time-budget-domain.test.js`

Expected: FAIL because the current implementation accepts 0-minute entries and does not activate today unless recorded.

- [ ] **Step 3: 호환 래퍼와 달력 규칙 구현**

```js
import {
  buildRecordedPeriodIndex,
  previousRecordedPeriod,
  nextRecordedPeriodOrCurrent,
} from './recorded-period-domain.js';

export function recordedDateKeys(entries, today) {
  return buildRecordedPeriodIndex(entries, today).dates;
}
export const previousRecordedDate = previousRecordedPeriod;
export const nextRecordedDateOrToday = nextRecordedPeriodOrCurrent;
```

In `calendarMonthCells`, set `isActive` to:

```js
const isActive = date <= today && (active.has(date) || date === today);
```

- [ ] **Step 4: 관련 테스트 통과 확인**

Run: `node --test tests/time-budget-domain.test.js tests/recorded-period-domain.test.js`

Expected: PASS.

- [ ] **Step 5: 커밋**

```bash
git add src/time-budget-domain.js tests/time-budget-domain.test.js
git commit -m "fix: keep today selectable in recorded date navigation"
```

---

### Task 3: 대시보드 주간 기록 주 점프

**Files:**
- Modify: `src/time-budget-feature.js:65-87, 219-295`
- Modify: `src/time-budget-ui.js:195-203`
- Modify: `tests/time-budget-ui.test.js:73-79`
- Create: `tests/time-budget-feature-recorded-navigation.test.js`

**Interfaces:**
- Consumes: `buildRecordedPeriodIndex`, `previousRecordedPeriod`, `nextRecordedPeriodOrCurrent`, `coerceRecordedPeriodSelection`.
- Passes to UI: `previousWeekStart: string | null`, `nextWeekStart: string | null`.

- [ ] **Step 1: UI 실패 테스트 작성**

```js
test('주간 버튼은 실제 이전·다음 기록 주가 있을 때만 활성화된다', () => {
  const html = renderDashboardHtml({
    mode: 'weekly',
    selectedWeekStart: '2026-07-20',
    currentWeekStart: '2026-07-27',
    previousWeekStart: '2026-07-06',
    nextWeekStart: '2026-07-27',
    weekRangeLabel: '2026-07-20 — 2026-07-26',
    weeklySummary: { totalBudgetMinutes: 420, totalActualMinutes: 210, percentage: 50, categorySummaries: [] },
  });
  assert.doesNotMatch(html, /data-week-direction="prev" disabled/);
  assert.doesNotMatch(html, /data-week-direction="next" disabled/);
});

test('이번 주에 기록 주가 없으면 양쪽 버튼을 비활성화한다', () => {
  const html = renderDashboardHtml({
    mode: 'weekly', selectedWeekStart: '2026-07-27', currentWeekStart: '2026-07-27',
    previousWeekStart: null, nextWeekStart: null, weekRangeLabel: '2026-07-27 — 2026-08-02',
    weeklySummary: { totalBudgetMinutes: 0, totalActualMinutes: 0, percentage: null, categorySummaries: [] },
  });
  assert.match(html, /data-week-direction="prev" disabled aria-disabled="true"/);
  assert.match(html, /data-week-direction="next" disabled aria-disabled="true"/);
});
```

Add a source-contract test in `tests/time-budget-feature-recorded-navigation.test.js` asserting that `time-budget-feature.js` imports the four Task 1 functions and does not call `moveWeekStart` inside the `onWeekMove` callback.

- [ ] **Step 2: 실패 확인**

Run: `node --test tests/time-budget-ui.test.js tests/time-budget-feature-recorded-navigation.test.js`

Expected: FAIL because the weekly UI only compares against the current week and the feature moves by exactly seven days.

- [ ] **Step 3: 대시보드 기간 모델 구현**

Add helpers in `time-budget-feature.js`:

```js
function recordedPeriods() {
  return buildRecordedPeriodIndex(state.entries, state.dashboard.today);
}

function normalizeDashboardSelections() {
  const periods = recordedPeriods();
  state.dashboard.selectedDate = coerceRecordedPeriodSelection({
    selected: state.dashboard.selectedDate,
    current: state.dashboard.today,
    recordedPeriods: periods.dates,
  });
  state.dashboard.selectedWeekStart = coerceRecordedPeriodSelection({
    selected: state.dashboard.selectedWeekStart,
    current: state.dashboard.currentWeekStart,
    recordedPeriods: periods.weekStarts,
  });
  return periods;
}
```

Call `normalizeDashboardSelections()` after cached/server data loading, after restored UI state is applied, and before `renderDashboard()` computes the model.

For weekly rendering:

```js
const periods = normalizeDashboardSelections();
const previousWeekStart = previousRecordedPeriod(periods.weekStarts, state.dashboard.selectedWeekStart);
const nextWeekStart = nextRecordedPeriodOrCurrent(
  periods.weekStarts,
  state.dashboard.selectedWeekStart,
  state.dashboard.currentWeekStart,
);
```

Pass both destinations to `renderDashboardHtml`. In `onWeekMove`, assign the precomputed destination rather than `moveWeekStart(...)`, save corrected state, and rerender.

- [ ] **Step 4: UI에서 목적지 유무로 disabled 렌더링**

```js
const previousDisabled = !model.previousWeekStart;
const nextDisabled = !model.nextWeekStart;
```

Render both `disabled` and `aria-disabled="true"` when disabled. Do not hide buttons.

- [ ] **Step 5: 테스트 통과 확인**

Run: `node --test tests/time-budget-ui.test.js tests/time-budget-feature-recorded-navigation.test.js tests/recorded-period-domain.test.js`

Expected: PASS.

- [ ] **Step 6: 커밋**

```bash
git add src/time-budget-feature.js src/time-budget-ui.js tests/time-budget-ui.test.js tests/time-budget-feature-recorded-navigation.test.js
git commit -m "feat: jump dashboard weeks by recorded periods"
```

---

### Task 4: 통계 주별 기록 주 이동

**Files:**
- Modify: `src/statistics-offline-rescue.js:24-35, 216-236, 239-249, 177-203`
- Create: `tests/statistics-recorded-period-navigation.test.js`

**Interfaces:**
- Consumes: Task 1의 공통 기간 함수.
- Produces internally: `statisticsPeriods()`, `normalizeStatisticsSelection()`, `weeklyNavigationModel()`.

- [ ] **Step 1: 실패 계약 테스트 작성**

```js
test('주별 통계는 기록 주 목적지로 이동하고 목적지가 없으면 비활성화한다', async () => {
  const source = await read('src/statistics-offline-rescue.js');
  for (const token of [
    'buildRecordedPeriodIndex',
    'previousRecordedPeriod',
    'nextRecordedPeriodOrCurrent',
    'coerceRecordedPeriodSelection',
    'previousWeekStart',
    'nextWeekStart',
  ]) assert.ok(source.includes(token), token);
  assert.doesNotMatch(source, /state\.weekStart = moveWeekStart\(state\.weekStart/);
  assert.match(source, /data-rescue-week="-1"[^>]*disabled[^>]*aria-disabled="true"/);
});
```

- [ ] **Step 2: 실패 확인**

Run: `node --test tests/statistics-recorded-period-navigation.test.js`

Expected: FAIL because statistics currently moves exactly one week using `moveWeekStart`.

- [ ] **Step 3: 주별 통계 기간 보정 구현**

```js
function statisticsPeriods() {
  return buildRecordedPeriodIndex(state.data?.entries || [], toDateKey(now));
}

function normalizeStatisticsSelection() {
  const periods = statisticsPeriods();
  state.weekStart = coerceRecordedPeriodSelection({
    selected: state.weekStart,
    current: currentWeekStart,
    recordedPeriods: periods.weekStarts,
  });
  return periods;
}
```

Call this after cached data assignment, after server data assignment, after UI state restoration, and before rendering.

`controlsHtml()` weekly branch must compute:

```js
const previousWeekStart = previousRecordedPeriod(periods.weekStarts, state.weekStart);
const nextWeekStart = nextRecordedPeriodOrCurrent(periods.weekStarts, state.weekStart, currentWeekStart);
```

Buttons use these destinations for disabled state. The click handler reads the direction and assigns the already calculated target; it must not call `moveWeekStart`.

- [ ] **Step 4: 현재 주 빈 통계 표시 검증 추가**

Add a test asserting the source keeps `summarizeWeeklyBudgetPeriod(...)` for the current week and that the renderer prints `—` when both total values are zero. Update `overallAchievement`:

```js
if (summary.totalBudgetMinutes <= 0 && summary.totalActualMinutes <= 0) return '—';
if (summary.totalBudgetMinutes <= 0 && summary.totalActualMinutes > 0) return '예산 미설정';
return `${summary.percentage ?? 0}%`;
```

- [ ] **Step 5: 통계 관련 테스트 통과 확인**

Run: `node --test tests/statistics-recorded-period-navigation.test.js tests/statistics-offline-rescue.test.js`

Expected: PASS.

- [ ] **Step 6: 커밋**

```bash
git add src/statistics-offline-rescue.js tests/statistics-recorded-period-navigation.test.js
git commit -m "feat: navigate weekly statistics by recorded weeks"
```

---

### Task 5: 월간 통계 활성 월·연도와 상태 복원 보정

**Files:**
- Modify: `src/statistics-offline-rescue.js:220-236, 213-227, 235-249`
- Modify: `src/statistics-session-state.js:16-34, 108-127, 132-150`
- Extend: `tests/statistics-recorded-period-navigation.test.js`
- Modify: `tests/statistics-navigation-unlock.test.js`

**Interfaces:**
- Consumes: `monthOptionStates`, `recordedYearOptions`, `defaultMonthForYear`.
- Emits: `weekly-time-budget:statistics-state-normalized` with `{ mode, weekStart, year, month }`.

- [ ] **Step 1: 월 옵션 실패 테스트 작성**

```js
test('월간 통계는 기록 월과 이번 달만 활성화한다', async () => {
  const source = await read('src/statistics-offline-rescue.js');
  for (const token of ['monthOptionStates', 'recordedYearOptions', 'defaultMonthForYear']) {
    assert.ok(source.includes(token), token);
  }
  assert.match(source, /<option[^>]*disabled[^>]*aria-disabled="true"/);
  assert.ok(source.includes('weekly-time-budget:statistics-state-normalized'));
});
```

- [ ] **Step 2: 실패 확인**

Run: `node --test tests/statistics-recorded-period-navigation.test.js`

Expected: FAIL because all 12 months are currently selectable.

- [ ] **Step 3: 월·연도 모델 구현**

Before rendering monthly controls:

```js
const periods = normalizeStatisticsSelection();
const years = recordedYearOptions(periods.years, now.getFullYear());
const monthOptions = monthOptionStates({
  recordedMonths: periods.months,
  year: state.year,
  currentYear: now.getFullYear(),
  currentMonth: now.getMonth() + 1,
});
```

Normalize monthly state as follows:

- Current year: current month is always valid.
- Past year: only recorded months are valid.
- Invalid restored past month: nearest previous recorded month, then next recorded month; if none, current year/current month.
- Year change to current year: set current month.
- Year change to past year: set that year's latest recorded month.

Render all 12 month options, adding `disabled aria-disabled="true"` to unavailable months and a class such as `is-unavailable` for muted styling.

- [ ] **Step 4: 통계 상태 복원 충돌 방지**

In `statistics-session-state.js`:

```js
function selectedMode() {
  return statisticsView()?.querySelector('[data-rescue-stat-mode].active, [data-stat-mode].active')?.dataset.rescueStatMode
    || statisticsView()?.querySelector('[data-stat-mode].active')?.dataset.statMode
    || 'weekly';
}
```

When restoring a month, only dispatch `change` if the matching option exists and is not disabled. Listen for `weekly-time-budget:statistics-state-normalized` and replace `desiredState.statistics` with the corrected values so `MutationObserver` does not keep trying an invalid month. Preserve the PR #28 rule that clicking another side menu cancels statistics restoration.

- [ ] **Step 5: 보정된 상태 저장**

After normalization changes any period, call `persistState()` and dispatch:

```js
document.dispatchEvent(new CustomEvent('weekly-time-budget:statistics-state-normalized', {
  detail: { ...state },
}));
```

Do not dispatch repeatedly when values did not change.

- [ ] **Step 6: 테스트 통과 확인**

Run: `node --test tests/statistics-recorded-period-navigation.test.js tests/statistics-navigation-unlock.test.js tests/statistics-offline-rescue.test.js`

Expected: PASS.

- [ ] **Step 7: 커밋**

```bash
git add src/statistics-offline-rescue.js src/statistics-session-state.js tests/statistics-recorded-period-navigation.test.js tests/statistics-navigation-unlock.test.js
git commit -m "feat: disable empty months in monthly statistics"
```

---

### Task 6: 기록 변경·오프라인 데이터 직후 재보정

**Files:**
- Modify: `src/time-budget-feature.js`
- Modify: `src/statistics-offline-rescue.js`
- Extend: `tests/time-budget-feature-recorded-navigation.test.js`
- Extend: `tests/statistics-recorded-period-navigation.test.js`

**Interfaces:**
- Consumes existing event: `weekly-time-budget:data-changed`.
- Requirement: merged local-first entries remain the sole source passed to `buildRecordedPeriodIndex`.

- [ ] **Step 1: 데이터 변경 계약 테스트 작성**

Assert that both feature modules call their normalization helper after data reload/change and before rerender. Also assert that neither module reads Firestore entries directly for period indexing; they must use `state.entries` or `state.data.entries`, which already include pending/failed local records.

```js
assert.match(dashboardSource, /weekly-time-budget:data-changed[\s\S]*normalizeDashboardSelections/);
assert.match(statisticsSource, /weekly-time-budget:data-changed[\s\S]*normalizeStatisticsSelection/);
```

- [ ] **Step 2: 실패 확인**

Run: `node --test tests/time-budget-feature-recorded-navigation.test.js tests/statistics-recorded-period-navigation.test.js`

Expected: FAIL until normalization is explicitly wired into data-change handling.

- [ ] **Step 3: 데이터 변경 후 보정 구현**

- Dashboard: after `loadData()` updates merged entries, call `normalizeDashboardSelections()`, save corrected dashboard state only if changed, then render.
- Statistics: when `weekly-time-budget:data-changed` fires, load with `keepCurrent: true`; after cache/server assignment call `normalizeStatisticsSelection()` before render.
- If a viewed past period loses its last record, selection order is previous → next → current.
- If current period loses all records, keep the current period.

- [ ] **Step 4: 테스트 통과 확인**

Run: `node --test tests/time-budget-feature-recorded-navigation.test.js tests/statistics-recorded-period-navigation.test.js tests/recorded-period-domain.test.js`

Expected: PASS.

- [ ] **Step 5: 커밋**

```bash
git add src/time-budget-feature.js src/statistics-offline-rescue.js tests/time-budget-feature-recorded-navigation.test.js tests/statistics-recorded-period-navigation.test.js
git commit -m "fix: revalidate selected periods after entry changes"
```

---

### Task 7: 서비스 워커·Pages 산출물·전체 회귀 검증

**Files:**
- Modify: `service-worker.js:5, 10-46`
- Modify: `tests/offline-app-integration.test.js:11-30, 115-130`
- Modify: `tests/statistics-offline-rescue.test.js:39-50`
- Modify: `tests/pages-deployment.test.js:77-120`

**Interfaces:**
- Deploys: `src/recorded-period-domain.js` in the app shell.
- Cache version: exactly `weekly-time-budget-shell-v5`.

- [ ] **Step 1: 배포 실패 테스트 작성**

Update service-worker assertions to require:

```js
'weekly-time-budget-shell-v5'
'./src/recorded-period-domain.js'
```

In the temporary Pages fixture, create `src/recorded-period-domain.js` and assert `_site/src/recorded-period-domain.js` exists after `preparePagesSite()`.

- [ ] **Step 2: 실패 확인**

Run: `node --test tests/offline-app-integration.test.js tests/statistics-offline-rescue.test.js tests/pages-deployment.test.js`

Expected: FAIL because the new module is not yet cached and v4 is still expected.

- [ ] **Step 3: 서비스 워커 갱신**

```js
const SHELL_CACHE = 'weekly-time-budget-shell-v5';
```

Add `./src/recorded-period-domain.js` to `SHELL_URLS`. Keep Auth/Firestore API requests network-only and do not change `RUNTIME_CACHE`.

- [ ] **Step 4: 자바스크립트 문법 검사 목록 갱신**

Add `../src/recorded-period-domain.js` to the `node --check` loop in `tests/offline-app-integration.test.js`.

- [ ] **Step 5: 전체 자동 테스트**

Run: `npm test`

Expected: all tests PASS with no skipped or failing tests.

- [ ] **Step 6: 실제 Pages 산출물 생성**

Run:

```bash
FIREBASE_API_KEY=test-api-key \
FIREBASE_AUTH_DOMAIN=test-project.firebaseapp.com \
FIREBASE_PROJECT_ID=test-project \
FIREBASE_STORAGE_BUCKET=test-project.firebasestorage.app \
FIREBASE_MESSAGING_SENDER_ID=123456789 \
FIREBASE_APP_ID=1:123456789:web:abcdef \
npm run prepare:pages
```

Expected: `Prepared GitHub Pages artifact: .../_site`.

Verify:

```bash
test -f _site/src/recorded-period-domain.js
grep -F "weekly-time-budget-shell-v5" _site/service-worker.js
grep -F "./src/recorded-period-domain.js" _site/service-worker.js
```

Expected: all commands exit 0.

- [ ] **Step 7: 모바일 수동 회귀 시나리오 기록**

Run the local app and verify these exact scenarios:

1. No records: today/current week/current month display; all backward/forward controls disabled.
2. Records only in weeks 2026-07-06 and 2026-07-20, current week 2026-07-27: current → previous goes to 07-20; 07-20 → previous goes to 07-06; 07-06 → next goes to 07-20; 07-20 → next goes to current.
3. Monthly records only in March and May, current month July: March, May, July enabled; January, February, April, June, August–December disabled.
4. Delete the only record in a viewed past week/month: selection moves previous → next → current and remains navigable.
5. Save a pending offline entry: its week/month becomes available before reconnecting; after sync it remains a single period.
6. Open statistics, then navigate to dashboard and time entry: no automatic return to statistics.

- [ ] **Step 8: 최종 커밋**

```bash
git add service-worker.js tests/offline-app-integration.test.js tests/statistics-offline-rescue.test.js tests/pages-deployment.test.js
git commit -m "test: verify recorded period navigation deployment"
```

---

## Final Verification Checklist

- [ ] `npm test` succeeds on the final commit.
- [ ] `npm run prepare:pages` succeeds with the exact test Firebase environment above.
- [ ] `_site/src/recorded-period-domain.js` exists.
- [ ] `_site/service-worker.js` contains `weekly-time-budget-shell-v5`.
- [ ] Dashboard daily calendar enables today even with no record.
- [ ] Dashboard weekly and statistics weekly skip empty past weeks and disable missing directions.
- [ ] Monthly statistics enables only recorded past months plus the current month.
- [ ] Current day/week/month stay visible after their records are deleted.
- [ ] Invalid restored periods are corrected and the corrected state is persisted.
- [ ] Pending/failed local records affect period navigation immediately without duplication after sync.
- [ ] Other side menus remain usable after opening statistics.
