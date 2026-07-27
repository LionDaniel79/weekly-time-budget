# 기록 기간 중심 대시보드·통계 이동 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 과거 날짜·주·월은 실제 기록이 있는 기간만 이동하고, 오늘·이번 주·이번 달은 기록이 없어도 항상 표시되도록 대시보드와 통계의 기간 탐색을 통일한다.

**Architecture:** 새 `src/recorded-period-domain.js`가 Firestore 기록과 IndexedDB 대기·실패 기록이 병합된 최종 기록 배열에서 날짜·주·월·연도 인덱스를 만든다. 대시보드와 캐시 우선 통계 모듈은 이 순수 로직으로 이전·다음 목적지와 복원된 선택 기간을 보정하며, 보정된 값만 사용자별 UI 상태에 다시 저장한다.

**Tech Stack:** Vanilla ES modules, Node.js `node:test`, Firebase Auth/Firestore, IndexedDB local-first runtime, Service Worker, GitHub Pages.

## Global Constraints

- 과거 기간은 유효한 `YYYY-MM-DD`와 `durationMinutes > 0`을 가진 실제 기록이 있을 때만 이동 대상으로 인정한다.
- 삭제 표시, 유효하지 않은 날짜, 0분·음수 기록은 기간 인덱스에서 제외한다.
- 오늘·이번 주·이번 달은 기록이 없어도 항상 표시하고 선택할 수 있다.
- 예산만 있고 실제 기록이 없는 과거 날짜·주·월은 이동 대상에서 제외한다.
- IndexedDB 동기화 대기·실패 기록도 서버 기록과 동일하게 기간 인덱스에 포함한다.
- 미래 날짜·주·월은 이동 대상으로 만들지 않는다.
- 이동 대상이 없으면 버튼과 월 옵션을 숨기지 않고 `disabled`와 `aria-disabled="true"`를 함께 사용한다.
- 기간 예산과 실제 기록이 모두 0이면 달성률은 `—`; 예산이 있고 실제 기록이 0이면 `0%`를 표시한다.
- 아이폰 웹앱의 오래된 코드를 제거하도록 셸 캐시를 `weekly-time-budget-shell-v5`로 올린다.

---

## File Map

- Create `src/recorded-period-domain.js`: 유효 기록 필터, 기록 날짜·주·월·연도 인덱스, 이전·다음 탐색, 선택 보정, 월·연도 옵션 모델.
- Create `tests/recorded-period-domain.test.js`: 공통 기간 도메인 단위 테스트.
- Modify `src/time-budget-domain.js`, `tests/time-budget-domain.test.js`: 기존 일간 API 호환과 오늘 달력 활성화.
- Modify `src/time-budget-feature.js`, `src/time-budget-ui.js`, `tests/time-budget-ui.test.js`: 대시보드 주간 기록 주 점프.
- Create `tests/time-budget-feature-recorded-navigation.test.js`: 대시보드 통합 계약.
- Modify `src/statistics-offline-rescue.js`, `src/statistics-session-state.js`: 주별·월간 통계 기간 이동과 상태 복원.
- Create `tests/statistics-recorded-period-navigation.test.js`: 통계 통합 계약.
- Modify `service-worker.js`, `tests/offline-app-integration.test.js`, `tests/statistics-offline-rescue.test.js`, `tests/pages-deployment.test.js`: 캐시·배포 회귀 검증.

---

### Task 1: 공통 기록 기간 도메인

**Files:**
- Create: `src/recorded-period-domain.js`
- Create: `tests/recorded-period-domain.test.js`

**Interfaces:**
- `buildRecordedPeriodIndex(entries, currentDateKey)` → `{ dates, weekStarts, months, years }`
- `previousRecordedPeriod(periods, selected)` → `string | null`
- `nextRecordedPeriodOrCurrent(periods, selected, current)` → `string | null`
- `coerceRecordedPeriodSelection({ selected, current, recordedPeriods })` → `string`
- `monthOptionStates({ recordedMonths, year, currentYear, currentMonth })` → `{ month, enabled, current }[]`
- `recordedYearOptions(recordedYears, currentYear)` → `number[]`
- `defaultMonthForYear({ year, currentYear, currentMonth, recordedMonths })` → `number | null`
- `coerceMonthlySelection({ year, month, currentYear, currentMonth, recordedMonths })` → `{ year, month }`

- [ ] **Step 1: 실패 테스트 작성**

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
  coerceMonthlySelection,
} from '../src/recorded-period-domain.js';

test('양수 유효 기록만 날짜·주·월·연도 인덱스에 포함한다', () => {
  const result = buildRecordedPeriodIndex([
    { date: '2026-07-06', durationMinutes: 30 },
    { date: '2026-07-20', durationMinutes: 60, syncStatus: 'pending' },
    { date: '2026-07-21', durationMinutes: 0 },
    { date: '2026-02-30', durationMinutes: 20 },
    { date: '2026-08-01', durationMinutes: 20 },
  ], '2026-07-27');
  assert.deepEqual(result, {
    dates: ['2026-07-06', '2026-07-20'],
    weekStarts: ['2026-07-06', '2026-07-20'],
    months: ['2026-07'],
    years: [2026],
  });
});

test('기록 없는 중간 주를 건너뛰고 마지막에는 이번 주로 이동한다', () => {
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

test('월간 선택은 기록 월과 이번 달만 허용한다', () => {
  const options = monthOptionStates({
    recordedMonths: ['2026-03', '2026-05'], year: 2026, currentYear: 2026, currentMonth: 7,
  });
  assert.equal(options.find(({ month }) => month === 3).enabled, true);
  assert.equal(options.find(({ month }) => month === 4).enabled, false);
  assert.deepEqual(options.find(({ month }) => month === 7), { month: 7, enabled: true, current: true });
  assert.equal(options.find(({ month }) => month === 8).enabled, false);
  assert.deepEqual(recordedYearOptions([2024, 2026], 2026), [2026, 2024]);
  assert.equal(defaultMonthForYear({ year: 2024, currentYear: 2026, currentMonth: 7, recordedMonths: ['2024-03', '2024-11'] }), 11);
  assert.deepEqual(coerceMonthlySelection({
    year: 2026, month: 4, currentYear: 2026, currentMonth: 7, recordedMonths: ['2026-03', '2026-05'],
  }), { year: 2026, month: 3 });
  assert.deepEqual(coerceMonthlySelection({
    year: 2025, month: 4, currentYear: 2026, currentMonth: 7, recordedMonths: [],
  }), { year: 2026, month: 7 });
});
```

- [ ] **Step 2: 실패 확인**

Run: `node --test tests/recorded-period-domain.test.js`

Expected: FAIL with `ERR_MODULE_NOT_FOUND`.

- [ ] **Step 3: 최소 구현 작성**

```js
import { getWeekRange, toDateKey } from './domain.js';

const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/;
const uniqueSorted = (values) => [...new Set(values)].sort();
const monthKey = (year, month) => `${year}-${String(month).padStart(2, '0')}`;

function validDateKey(value) {
  if (!DATE_KEY.test(String(value || ''))) return false;
  const parsed = new Date(`${value}T12:00:00`);
  return !Number.isNaN(parsed.getTime()) && toDateKey(parsed) === value;
}

function validEntry(entry, currentDateKey) {
  return validDateKey(entry?.date)
    && entry.date <= currentDateKey
    && Number(entry.durationMinutes) > 0
    && entry.deleted !== true;
}

export function buildRecordedPeriodIndex(entries = [], currentDateKey) {
  const dates = uniqueSorted(entries.filter((entry) => validEntry(entry, currentDateKey)).map((entry) => entry.date));
  const weekStarts = uniqueSorted(dates.map((date) => getWeekRange(new Date(`${date}T12:00:00`)).start));
  const months = uniqueSorted(dates.map((date) => date.slice(0, 7)));
  const years = [...new Set(months.map((value) => Number(value.slice(0, 4))))].sort((a, b) => a - b);
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

export function monthOptionStates({ recordedMonths, year, currentYear, currentMonth }) {
  const recorded = new Set(recordedMonths);
  return Array.from({ length: 12 }, (_, index) => {
    const month = index + 1;
    const current = year === currentYear && month === currentMonth;
    const future = year > currentYear || (year === currentYear && month > currentMonth);
    return { month, enabled: !future && (current || recorded.has(monthKey(year, month))), current };
  });
}

export const recordedYearOptions = (recordedYears, currentYear) => [...new Set([currentYear, ...recordedYears])].sort((a, b) => b - a);

export function defaultMonthForYear({ year, currentYear, currentMonth, recordedMonths }) {
  if (year === currentYear) return currentMonth;
  const values = recordedMonths.filter((value) => Number(value.slice(0, 4)) === year).map((value) => Number(value.slice(5, 7)));
  return values.length ? Math.max(...values) : null;
}

export function coerceMonthlySelection({ year, month, currentYear, currentMonth, recordedMonths }) {
  if (year > currentYear) return { year: currentYear, month: currentMonth };
  const options = monthOptionStates({ recordedMonths, year, currentYear, currentMonth });
  if (options.some((item) => item.month === month && item.enabled)) return { year, month };
  const enabled = options.filter((item) => item.enabled).map((item) => item.month);
  const previous = [...enabled].reverse().find((value) => value < month);
  const next = enabled.find((value) => value > month);
  if (previous || next) return { year, month: previous || next };
  return { year: currentYear, month: currentMonth };
}
```

- [ ] **Step 4: 통과 확인**

Run: `node --test tests/recorded-period-domain.test.js`

Expected: PASS.

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
- Consumes Task 1의 `buildRecordedPeriodIndex`, `previousRecordedPeriod`, `nextRecordedPeriodOrCurrent`.
- Preserves `recordedDateKeys`, `previousRecordedDate`, `nextRecordedDateOrToday` names.

- [ ] **Step 1: 실패 테스트 교체**

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
  assert.equal(cells.find(({ date }) => date === '2026-07-20').disabled, false);
  assert.equal(cells.find(({ date }) => date === '2026-07-21').disabled, true);
  assert.equal(cells.find(({ date }) => date === '2026-07-26').disabled, false);
  assert.equal(cells.find(({ date }) => date === '2026-07-27').disabled, true);
});
```

- [ ] **Step 2: 실패 확인**

Run: `node --test tests/time-budget-domain.test.js`

Expected: FAIL because 0-minute entries are currently accepted and today is not automatically active.

- [ ] **Step 3: 호환 래퍼 구현**

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

Replace `calendarMonthCells` activation with:

```js
const isActive = date <= today && (active.has(date) || date === today);
```

- [ ] **Step 4: 통과 확인**

Run: `node --test tests/time-budget-domain.test.js tests/recorded-period-domain.test.js`

Expected: PASS.

- [ ] **Step 5: 커밋**

```bash
git add src/time-budget-domain.js tests/time-budget-domain.test.js
git commit -m "fix: keep today selectable in date navigation"
```

---

### Task 3: 대시보드 주간 기록 주 점프

**Files:**
- Modify: `src/time-budget-feature.js:3-24, 65-87, 219-295, 459-474`
- Modify: `src/time-budget-ui.js:195-203`
- Modify: `tests/time-budget-ui.test.js:73-79`
- Create: `tests/time-budget-feature-recorded-navigation.test.js`

**Interfaces:**
- Consumes Task 1의 인덱스·탐색·보정 함수.
- Passes `previousWeekStart` and `nextWeekStart` to `renderDashboardHtml`.

- [ ] **Step 1: 실패 UI 테스트 작성**

```js
test('주간 버튼은 실제 목적지가 있을 때만 활성화된다', () => {
  const html = renderDashboardHtml({
    mode: 'weekly', selectedWeekStart: '2026-07-20', currentWeekStart: '2026-07-27',
    previousWeekStart: '2026-07-06', nextWeekStart: '2026-07-27',
    weekRangeLabel: '2026-07-20 — 2026-07-26',
    weeklySummary: { totalBudgetMinutes: 420, totalActualMinutes: 210, percentage: 50, categorySummaries: [] },
  });
  assert.doesNotMatch(html, /data-week-direction="prev" disabled/);
  assert.doesNotMatch(html, /data-week-direction="next" disabled/);
});

test('목적지가 없으면 주간 버튼을 비활성화한다', () => {
  const html = renderDashboardHtml({
    mode: 'weekly', selectedWeekStart: '2026-07-27', currentWeekStart: '2026-07-27',
    previousWeekStart: null, nextWeekStart: null, weekRangeLabel: '2026-07-27 — 2026-08-02',
    weeklySummary: { totalBudgetMinutes: 0, totalActualMinutes: 0, percentage: null, categorySummaries: [] },
  });
  assert.match(html, /data-week-direction="prev" disabled aria-disabled="true"/);
  assert.match(html, /data-week-direction="next" disabled aria-disabled="true"/);
});
```

Create the integration contract test:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('대시보드는 공통 기록 기간 인덱스로 주간 목적지를 계산한다', async () => {
  const source = await read('src/time-budget-feature.js');
  for (const token of ['buildRecordedPeriodIndex', 'previousRecordedPeriod', 'nextRecordedPeriodOrCurrent', 'coerceRecordedPeriodSelection']) {
    assert.ok(source.includes(token), token);
  }
  assert.doesNotMatch(source, /moveWeekStart/);
  assert.ok(source.includes('normalizeDashboardSelections'));
});
```

- [ ] **Step 2: 실패 확인**

Run: `node --test tests/time-budget-ui.test.js tests/time-budget-feature-recorded-navigation.test.js`

Expected: FAIL.

- [ ] **Step 3: 대시보드 기간 모델 구현**

Remove `moveWeekStart` from imports. Add:

```js
import {
  buildRecordedPeriodIndex,
  previousRecordedPeriod,
  nextRecordedPeriodOrCurrent,
  coerceRecordedPeriodSelection,
} from './recorded-period-domain.js';

function normalizeDashboardSelections() {
  const periods = buildRecordedPeriodIndex(state.entries, state.dashboard.today);
  const before = `${state.dashboard.selectedDate}|${state.dashboard.selectedWeekStart}`;
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
  return { periods, changed: before !== `${state.dashboard.selectedDate}|${state.dashboard.selectedWeekStart}` };
}
```

Call this after restored state application, after `loadData()` has merged entries, in `weekly-time-budget:entries-changed`, and in `weekly-time-budget:data-changed`. When `changed` is true, call `saveFeatureUiState({ dashboard: { ...state.dashboard } })` once.

Before weekly rendering:

```js
const { periods } = normalizeDashboardSelections();
const previousWeekStart = previousRecordedPeriod(periods.weekStarts, state.dashboard.selectedWeekStart);
const nextWeekStart = nextRecordedPeriodOrCurrent(periods.weekStarts, state.dashboard.selectedWeekStart, state.dashboard.currentWeekStart);
```

Pass both values to the UI. Replace `onWeekMove` with:

```js
onWeekMove: (direction) => {
  const target = direction === 'prev' ? previousWeekStart : nextWeekStart;
  if (!target) return;
  state.dashboard.selectedWeekStart = target;
  saveFeatureUiState({ dashboard: { ...state.dashboard } });
  renderDashboard();
  updateHeader('dashboard');
},
```

- [ ] **Step 4: UI disabled 속성 구현**

```js
const prevAttrs = model.previousWeekStart ? '' : 'disabled aria-disabled="true"';
const nextAttrs = model.nextWeekStart ? '' : 'disabled aria-disabled="true"';
```

Use `prevAttrs` and `nextAttrs` on the existing buttons without hiding them.

- [ ] **Step 5: 통과 확인 및 커밋**

Run: `node --test tests/time-budget-ui.test.js tests/time-budget-feature-recorded-navigation.test.js tests/recorded-period-domain.test.js`

Expected: PASS.

```bash
git add src/time-budget-feature.js src/time-budget-ui.js tests/time-budget-ui.test.js tests/time-budget-feature-recorded-navigation.test.js
git commit -m "feat: jump dashboard weeks by recorded periods"
```

---

### Task 4: 통계 주별 기록 주 이동과 빈 현재 주 표시

**Files:**
- Modify: `src/statistics-offline-rescue.js:3-14, 24-35, 147-170, 216-236, 177-203`
- Create: `tests/statistics-recorded-period-navigation.test.js`

**Interfaces:**
- Adds internal `statisticsPeriods()`, `normalizeStatisticsSelection()`, `weeklyNavigationModel()`.

- [ ] **Step 1: 실패 계약 테스트 작성**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('주별 통계는 기록 주 목적지를 사용한다', async () => {
  const source = await read('src/statistics-offline-rescue.js');
  for (const token of ['buildRecordedPeriodIndex', 'previousRecordedPeriod', 'nextRecordedPeriodOrCurrent', 'coerceRecordedPeriodSelection', 'weeklyNavigationModel']) {
    assert.ok(source.includes(token), token);
  }
  assert.doesNotMatch(source, /state\.weekStart = moveWeekStart/);
  assert.ok(source.includes('aria-disabled="true"'));
});

test('예산과 기록이 모두 0이면 달성률 대시를 표시한다', async () => {
  const source = await read('src/statistics-offline-rescue.js');
  assert.match(source, /totalBudgetMinutes <= 0 && summary\.totalActualMinutes <= 0\) return '—'/);
});
```

- [ ] **Step 2: 실패 확인**

Run: `node --test tests/statistics-recorded-period-navigation.test.js`

Expected: FAIL.

- [ ] **Step 3: 주별 기간 모델 구현**

Import `toDateKey` from `domain.js`, remove `moveWeekStart`, and import the four Task 1 helpers. Add:

```js
function statisticsPeriods() {
  return buildRecordedPeriodIndex(state.data?.entries || [], toDateKey(now));
}

function normalizeStatisticsSelection() {
  const periods = statisticsPeriods();
  const before = state.weekStart;
  state.weekStart = coerceRecordedPeriodSelection({
    selected: state.weekStart,
    current: currentWeekStart,
    recordedPeriods: periods.weekStarts,
  });
  return { periods, changed: before !== state.weekStart };
}

function weeklyNavigationModel() {
  const { periods } = normalizeStatisticsSelection();
  return {
    previousWeekStart: previousRecordedPeriod(periods.weekStarts, state.weekStart),
    nextWeekStart: nextRecordedPeriodOrCurrent(periods.weekStarts, state.weekStart, currentWeekStart),
  };
}
```

In weekly `controlsHtml()`:

```js
const { previousWeekStart, nextWeekStart } = weeklyNavigationModel();
const prevAttrs = previousWeekStart ? '' : 'disabled aria-disabled="true"';
const nextAttrs = nextWeekStart ? '' : 'disabled aria-disabled="true"';
```

In the click handler:

```js
const navigation = weeklyNavigationModel();
const target = Number(weekButton.dataset.rescueWeek) < 0
  ? navigation.previousWeekStart
  : navigation.nextWeekStart;
if (!target) return;
state.weekStart = target;
persistState();
renderStatistics();
```

Call `normalizeStatisticsSelection()` after cached data assignment, after server assignment, after restored UI state, and before render.

- [ ] **Step 4: 달성률 표시 수정**

```js
function overallAchievement(summary) {
  if (summary.totalBudgetMinutes <= 0 && summary.totalActualMinutes <= 0) return '—';
  if (summary.totalBudgetMinutes <= 0 && summary.totalActualMinutes > 0) return '예산 미설정';
  return `${summary.percentage ?? 0}%`;
}
```

- [ ] **Step 5: 통과 확인 및 커밋**

Run: `node --test tests/statistics-recorded-period-navigation.test.js tests/statistics-offline-rescue.test.js`

Expected: PASS.

```bash
git add src/statistics-offline-rescue.js tests/statistics-recorded-period-navigation.test.js
git commit -m "feat: navigate weekly statistics by recorded weeks"
```

---

### Task 5: 월간 통계 활성 월·연도와 상태 복원 보정

**Files:**
- Modify: `src/statistics-offline-rescue.js:220-236, 213-227, 235-249`
- Modify: `src/statistics-session-state.js:16-34, 108-150`
- Extend: `tests/statistics-recorded-period-navigation.test.js`
- Modify: `tests/statistics-navigation-unlock.test.js`

**Interfaces:**
- Consumes `monthOptionStates`, `recordedYearOptions`, `defaultMonthForYear`, `coerceMonthlySelection`.
- Emits `weekly-time-budget:statistics-state-normalized` with only `{ mode, weekStart, year, month }`.

- [ ] **Step 1: 월간 실패 테스트 추가**

```js
test('월간 통계는 기록 월과 이번 달만 활성화한다', async () => {
  const source = await read('src/statistics-offline-rescue.js');
  for (const token of ['monthOptionStates', 'recordedYearOptions', 'defaultMonthForYear', 'coerceMonthlySelection']) {
    assert.ok(source.includes(token), token);
  }
  assert.ok(source.includes('disabled aria-disabled="true"'));
  assert.ok(source.includes('weekly-time-budget:statistics-state-normalized'));
});

test('상태 복원은 비활성 월을 다시 선택하지 않는다', async () => {
  const source = await read('src/statistics-session-state.js');
  assert.match(source, /option && !option\.disabled/);
  assert.ok(source.includes('weekly-time-budget:statistics-state-normalized'));
});
```

- [ ] **Step 2: 실패 확인**

Run: `node --test tests/statistics-recorded-period-navigation.test.js tests/statistics-navigation-unlock.test.js`

Expected: FAIL.

- [ ] **Step 3: 월·연도 모델 구현**

Extend `normalizeStatisticsSelection()`:

```js
const monthly = coerceMonthlySelection({
  year: state.year,
  month: state.month,
  currentYear: now.getFullYear(),
  currentMonth: now.getMonth() + 1,
  recordedMonths: periods.months,
});
state.year = monthly.year;
state.month = monthly.month;
```

In non-weekly controls:

```js
const years = recordedYearOptions(periods.years, now.getFullYear());
const monthOptions = monthOptionStates({
  recordedMonths: periods.months,
  year: state.year,
  currentYear: now.getFullYear(),
  currentMonth: now.getMonth() + 1,
});
const monthHtml = monthOptions.map(({ month, enabled }) =>
  `<option value="${month}" ${month === state.month ? 'selected' : ''} ${enabled ? '' : 'disabled aria-disabled="true" class="is-unavailable"'}>${month}월</option>`,
).join('');
```

Year change handler:

```js
state.year = Number(event.target.value);
state.month = defaultMonthForYear({
  year: state.year,
  currentYear: now.getFullYear(),
  currentMonth: now.getMonth() + 1,
  recordedMonths: statisticsPeriods().months,
}) || now.getMonth() + 1;
normalizeStatisticsSelection();
persistState();
renderStatistics();
```

- [ ] **Step 4: 보정 상태 이벤트와 복원 안전장치 구현**

When normalization changed any field, dispatch exactly:

```js
document.dispatchEvent(new CustomEvent('weekly-time-budget:statistics-state-normalized', {
  detail: { mode: state.mode, weekStart: state.weekStart, year: state.year, month: state.month },
}));
```

In `statistics-session-state.js`, restore the month only when enabled:

```js
const option = [...monthSelect.options].find((item) => item.value === String(saved.month));
if (option && !option.disabled && monthSelect.value !== option.value) {
  restoring = true;
  monthSelect.value = option.value;
  monthSelect.dispatchEvent(new Event('change', { bubbles: true }));
  setTimeout(() => { restoring = false; scheduleRestore(); }, 0);
  return;
}
```

Listen for normalized state:

```js
document.addEventListener('weekly-time-budget:statistics-state-normalized', (event) => {
  desiredState = { ...(desiredState || {}), activeView: 'statistics', statistics: event.detail };
});
```

Keep the existing `.nav-button[data-view]` handler that cancels restoration when another menu is clicked.

- [ ] **Step 5: 통과 확인 및 커밋**

Run: `node --test tests/statistics-recorded-period-navigation.test.js tests/statistics-navigation-unlock.test.js tests/statistics-offline-rescue.test.js`

Expected: PASS.

```bash
git add src/statistics-offline-rescue.js src/statistics-session-state.js tests/statistics-recorded-period-navigation.test.js tests/statistics-navigation-unlock.test.js
git commit -m "feat: disable empty months in monthly statistics"
```

---

### Task 6: 기록 변경과 오프라인 기록 직후 재보정

**Files:**
- Modify: `src/time-budget-feature.js:459-474`
- Modify: `src/statistics-offline-rescue.js:229-233`
- Extend: `tests/time-budget-feature-recorded-navigation.test.js`
- Extend: `tests/statistics-recorded-period-navigation.test.js`

**Interfaces:**
- Uses existing `weekly-time-budget:entries-changed` and `weekly-time-budget:data-changed` events.
- Period indexing must use merged `state.entries` or `state.data.entries`, never a new Firestore-only query.

- [ ] **Step 1: 실패 계약 테스트 추가**

```js
test('기록 변경 후 대시보드 선택 기간을 다시 보정한다', async () => {
  const source = await read('src/time-budget-feature.js');
  assert.match(source, /weekly-time-budget:entries-changed[\s\S]*normalizeDashboardSelections/);
  assert.match(source, /weekly-time-budget:data-changed[\s\S]*normalizeDashboardSelections/);
  assert.match(source, /buildRecordedPeriodIndex\(state\.entries/);
});

test('통계 데이터 변경은 병합 기록으로 기간을 다시 보정한다', async () => {
  const source = await read('src/statistics-offline-rescue.js');
  assert.match(source, /weekly-time-budget:data-changed[\s\S]*loadStatistics/);
  assert.match(source, /buildRecordedPeriodIndex\(state\.data\?\.entries/);
});
```

- [ ] **Step 2: 실패 확인**

Run: `node --test tests/time-budget-feature-recorded-navigation.test.js tests/statistics-recorded-period-navigation.test.js`

Expected: FAIL until the event paths call normalization.

- [ ] **Step 3: 대시보드 이벤트 경로 구현**

After merged entries are assigned in both dashboard event handlers:

```js
const { changed } = normalizeDashboardSelections();
if (changed) saveFeatureUiState({ dashboard: { ...state.dashboard } });
if (!document.querySelector('#dashboard-view')?.classList.contains('hidden')) {
  renderDashboard();
  updateHeader('dashboard');
}
```

- [ ] **Step 4: 통계 이벤트 경로 구현**

Keep `loadStatistics({ keepCurrent: true })`; inside `loadStatistics`, call `normalizeStatisticsSelection()` immediately after cache/server assignment and before every `renderStatistics()`. If normalization changed values, call `persistState()` once. Current day/week/month remain unchanged when their final record disappears; past invalid periods follow previous → next → current through the Task 1 functions.

- [ ] **Step 5: 통과 확인 및 커밋**

Run: `node --test tests/time-budget-feature-recorded-navigation.test.js tests/statistics-recorded-period-navigation.test.js tests/recorded-period-domain.test.js`

Expected: PASS.

```bash
git add src/time-budget-feature.js src/statistics-offline-rescue.js tests/time-budget-feature-recorded-navigation.test.js tests/statistics-recorded-period-navigation.test.js
git commit -m "fix: revalidate periods after entry changes"
```

---

### Task 7: 서비스 워커·Pages 산출물·전체 회귀 검증

**Files:**
- Modify: `service-worker.js:5, 10-46`
- Modify: `tests/offline-app-integration.test.js:11-30, 115-130`
- Modify: `tests/statistics-offline-rescue.test.js:39-50`
- Modify: `tests/pages-deployment.test.js:77-120`

**Interfaces:**
- Deploys `src/recorded-period-domain.js` in the app shell.
- Uses exact cache version `weekly-time-budget-shell-v5`.

- [ ] **Step 1: 배포 실패 테스트 작성**

In service-worker assertions require both:

```js
'weekly-time-budget-shell-v5'
'./src/recorded-period-domain.js'
```

In `tests/pages-deployment.test.js`, create the fixture file:

```js
await writeFile(path.join(rootDir, 'src', 'recorded-period-domain.js'), 'export {};');
```

Add `'src/recorded-period-domain.js'` to the expected deployed paths.

- [ ] **Step 2: 실패 확인**

Run: `node --test tests/offline-app-integration.test.js tests/statistics-offline-rescue.test.js tests/pages-deployment.test.js`

Expected: FAIL because v4 and the old shell list are still present.

- [ ] **Step 3: 서비스 워커 갱신**

```js
const SHELL_CACHE = 'weekly-time-budget-shell-v5';
```

Add this exact item to `SHELL_URLS`:

```js
'./src/recorded-period-domain.js',
```

Keep Auth/Firestore API responses network-only and leave `RUNTIME_CACHE` unchanged.

- [ ] **Step 4: 문법 검사 목록 갱신**

Add this exact path to the `node --check` loop in `tests/offline-app-integration.test.js`:

```js
'../src/recorded-period-domain.js',
```

- [ ] **Step 5: 전체 자동 테스트**

Run: `npm test`

Expected: all tests PASS.

- [ ] **Step 6: Pages 산출물 생성 및 검사**

```bash
FIREBASE_API_KEY=test-api-key \
FIREBASE_AUTH_DOMAIN=test-project.firebaseapp.com \
FIREBASE_PROJECT_ID=test-project \
FIREBASE_STORAGE_BUCKET=test-project.firebasestorage.app \
FIREBASE_MESSAGING_SENDER_ID=123456789 \
FIREBASE_APP_ID=1:123456789:web:abcdef \
npm run prepare:pages

test -f _site/src/recorded-period-domain.js
grep -F "weekly-time-budget-shell-v5" _site/service-worker.js
grep -F "./src/recorded-period-domain.js" _site/service-worker.js
```

Expected: all commands exit 0.

- [ ] **Step 7: 수동 모바일 회귀 검증**

1. 기록 없음: 오늘·이번 주·이번 달은 표시되고 모든 과거·미래 이동 버튼은 비활성.
2. 기록 주가 2026-07-06과 2026-07-20, 이번 주가 2026-07-27: 이번 주 → 전주는 07-20, 07-20 → 전주는 07-06, 07-06 → 다음은 07-20, 07-20 → 다음은 이번 주.
3. 기록 월이 3월·5월이고 이번 달이 7월: 3·5·7월만 활성, 나머지 과거 기록 없는 월과 미래 월은 비활성.
4. 보고 있던 과거 주·월의 마지막 기록 삭제: 이전 → 이후 → 현재 순으로 보정.
5. 오프라인 대기 기록 저장: 재연결 전에도 해당 주·월 활성; 동기화 후 중복 없음.
6. 통계 열기 후 대시보드·시간 기록·시간 예산 이동: 통계로 자동 복귀하지 않음.

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
- [ ] Dashboard daily calendar enables today without a record.
- [ ] Dashboard weekly and statistics weekly skip empty past weeks and disable missing directions.
- [ ] Monthly statistics enables only recorded past months plus the current month.
- [ ] Current day/week/month remain visible after all current-period records are deleted.
- [ ] Invalid restored periods are corrected and corrected state is persisted.
- [ ] Pending/failed local records affect navigation immediately without duplication after sync.
- [ ] Other side menus remain usable after opening statistics.
