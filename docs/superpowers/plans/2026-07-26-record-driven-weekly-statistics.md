# 기록 기반 주별·월간·연간 통계 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 주별 통계를 추가하고, 월간·연간·비교 통계의 예산을 실제 기록이 존재하는 주·달만 기준으로 계산한다.

**Architecture:** `src/domain.js`에 기록 주·기록 달 판별과 주별·기록 기반 월간·연간 요약 함수를 추가한다. `src/statistics-ui.js`는 이 순수 함수만 사용해 주별 탐색과 기존 통계 화면을 렌더링하며, 과거의 DOM 후처리 방식인 `current-month-statistics.js`는 제거한다. 모든 계산은 Node 내장 테스트로 먼저 고정하고, 브라우저 UI는 소스 계약 테스트와 자바스크립트 구문 검사로 검증한다.

**Tech Stack:** Vanilla JavaScript ES modules, Firebase Firestore, HTML/CSS, Node.js built-in test runner

## Global Constraints

- 주간 범위는 월요일부터 주일까지다.
- 주별 통계는 선택한 주의 전체 주간 예산과 실제 기록을 비교한다.
- 월간 통계는 선택한 달에 실제 기록이 존재하는 주들의 월 배정 예산만 합산한다.
- 기록이 전혀 없는 주는 월간 예산에서 제외한다.
- 월 경계 주는 해당 월 날짜 수만큼 주간 예산을 7일 비례 배분한다.
- 연간 통계는 실제 기록이 존재하는 달들의 월간 예산만 합산한다.
- 기록이 전혀 없는 달은 연간 예산에서 제외한다.
- 연간 월평균은 기록이 존재하는 달 수를 기준으로 계산한다.
- 월간 비교는 기록이 존재하는 달만 표시하고, 이전 기록 달과 증감을 비교한다.
- 연도별 비교는 기록이 존재하는 연도만 표시하고, 이전 기록 연도와 증감을 비교한다.
- 미래 주로 이동할 수 없다.
- 기존 예산 대비 달성률, 데스크톱 표, 모바일 카드형 레이아웃을 유지한다.
- 외부 라이브러리를 추가하지 않는다.

---

### Task 1: 기록 주·기록 달 판별과 주 이동 도우미

**Files:**
- Modify: `src/domain.js:1-67`
- Modify: `tests/domain.test.js:1-45`

**Interfaces:**
- Consumes: `toDateKey(date)`, `getWeekRange(date)`, `getMonthRange(year, month)`
- Produces:
  - `recordedWeekKeysForMonth(entries, year, month): string[]`
  - `recordedMonthsForYear(entries, year): number[]`
  - `moveWeekStart(weekStart, offsetWeeks, referenceDate = new Date()): string`

- [ ] **Step 1: 실패하는 도메인 테스트 작성**

`tests/domain.test.js`의 import 목록에 새 함수를 추가하고 다음 테스트를 작성한다.

```js
import {
  moveWeekStart,
  recordedMonthsForYear,
  recordedWeekKeysForMonth,
} from '../src/domain.js';

test('선택 월의 실제 기록을 주 시작일 기준으로 묶는다', () => {
  const entries = [
    { date: '2026-07-01', durationMinutes: 30 },
    { date: '2026-07-05', durationMinutes: 60 },
    { date: '2026-07-06', durationMinutes: 90 },
    { date: '2026-08-01', durationMinutes: 20 },
    { date: '잘못된 날짜', durationMinutes: 20 },
  ];
  assert.deepEqual(recordedWeekKeysForMonth(entries, 2026, 7), [
    '2026-06-29',
    '2026-07-06',
  ]);
});

test('선택 연도의 실제 기록이 존재하는 달만 반환한다', () => {
  const entries = [
    { date: '2026-07-25', durationMinutes: 60 },
    { date: '2026-09-01', durationMinutes: 30 },
    { date: '2026-09-10', durationMinutes: 20 },
    { date: '2025-12-31', durationMinutes: 10 },
  ];
  assert.deepEqual(recordedMonthsForYear(entries, 2026), [7, 9]);
});

test('주 이동은 7일 단위이며 현재 주 이후로 넘어가지 않는다', () => {
  const referenceDate = new Date('2026-07-26T12:00:00+09:00');
  assert.equal(moveWeekStart('2026-07-20', -1, referenceDate), '2026-07-13');
  assert.equal(moveWeekStart('2026-07-13', 1, referenceDate), '2026-07-20');
  assert.equal(moveWeekStart('2026-07-20', 1, referenceDate), '2026-07-20');
});
```

- [ ] **Step 2: 테스트를 실행해 실패 확인**

Run:

```bash
node --test tests/domain.test.js
```

Expected: 새 export가 존재하지 않아 FAIL

- [ ] **Step 3: 날짜 검증과 기록 기간 도우미 구현**

`src/domain.js`에 다음 구현을 추가한다.

```js
function isDateKey(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || ''));
}

export function recordedWeekKeysForMonth(entries, year, month) {
  const { start, end } = getMonthRange(year, month);
  const keys = new Set();
  (entries || []).forEach((entry) => {
    if (!isDateKey(entry.date) || entry.date < start || entry.date > end) return;
    keys.add(getBudgetWeekKey(fromDateKey(entry.date)));
  });
  return [...keys].sort();
}

export function recordedMonthsForYear(entries, year) {
  const prefix = `${Number(year)}-`;
  const months = new Set();
  (entries || []).forEach((entry) => {
    if (!isDateKey(entry.date) || !entry.date.startsWith(prefix)) return;
    months.add(Number(entry.date.slice(5, 7)));
  });
  return [...months].sort((a, b) => a - b);
}

export function moveWeekStart(weekStart, offsetWeeks, referenceDate = new Date()) {
  const currentWeekStart = getWeekRange(referenceDate).start;
  const candidate = toDateKey(addDays(weekStart, Number(offsetWeeks) * 7));
  return candidate > currentWeekStart ? currentWeekStart : candidate;
}
```

- [ ] **Step 4: 테스트 실행**

Run:

```bash
node --test tests/domain.test.js
```

Expected: 새 기간 판별·주 이동 테스트 PASS

- [ ] **Step 5: 커밋**

```bash
git add src/domain.js tests/domain.test.js
git commit -m "feat: add recorded period helpers"
```

---

### Task 2: 주별 전체 예산과 기록 기반 월간 예산 계산

**Files:**
- Modify: `src/domain.js:163-260`
- Modify: `tests/domain.test.js:109-230`

**Interfaces:**
- Consumes: `recordedWeekKeysForMonth()`, `effectiveWeeklyBudget()`, `summarizeBudgetPeriod()`의 기존 반환 구조
- Produces:
  - `summarizeWeeklyBudgetPeriod(entries, categories, weeklyBudgets, weekStart): BudgetSummary`
  - `summarizeRecordedMonthlyBudgetPeriod(entries, categories, weeklyBudgets, year, month): BudgetSummary & { recordWeekCount: number }`

- [ ] **Step 1: 실패하는 주별 통계 테스트 작성**

```js
import {
  summarizeRecordedMonthlyBudgetPeriod,
  summarizeWeeklyBudgetPeriod,
} from '../src/domain.js';

test('주별 통계는 선택한 주의 전체 예산과 실제 기록을 비교한다', () => {
  const categories = [{ id: 'reading', name: '독서', defaultBudgetMinutes: 420 }];
  const weeklyBudgets = [
    { weekStart: '2026-07-20', budgets: { reading: 600 } },
  ];
  const entries = [
    { categoryId: 'reading', date: '2026-07-25', durationMinutes: 120 },
  ];
  const result = summarizeWeeklyBudgetPeriod(
    entries,
    categories,
    weeklyBudgets,
    '2026-07-20',
  );
  assert.equal(result.totalBudgetMinutes, 600);
  assert.equal(result.totalActualMinutes, 120);
  assert.equal(result.percentage, 20);
  assert.equal(result.recordDays, 1);
  assert.equal(result.categorySummaries[0].budgetMinutes, 600);
});

test('기록이 없는 주도 주간 전체 예산과 실제 0시간을 반환한다', () => {
  const result = summarizeWeeklyBudgetPeriod(
    [],
    [{ id: 'reading', name: '독서', defaultBudgetMinutes: 420 }],
    [],
    '2026-07-20',
  );
  assert.equal(result.totalBudgetMinutes, 420);
  assert.equal(result.totalActualMinutes, 0);
  assert.equal(result.recordDays, 0);
});
```

- [ ] **Step 2: 실패하는 기록 기반 월간 테스트 작성**

```js
test('월간 예산은 기록이 있는 주의 변동 예산만 합산한다', () => {
  const categories = [{ id: 'reading', name: '독서', defaultBudgetMinutes: 420 }];
  const weeklyBudgets = [
    { weekStart: '2026-07-06', budgets: { reading: 420 } },
    { weekStart: '2026-07-13', budgets: { reading: 700 } },
    { weekStart: '2026-07-27', budgets: { reading: 840 } },
  ];
  const entries = [
    { categoryId: 'reading', date: '2026-07-07', durationMinutes: 60 },
    { categoryId: 'reading', date: '2026-07-30', durationMinutes: 120 },
  ];
  const result = summarizeRecordedMonthlyBudgetPeriod(
    entries,
    categories,
    weeklyBudgets,
    2026,
    7,
  );
  assert.equal(result.recordWeekCount, 2);
  assert.equal(result.totalBudgetMinutes, 1020); // 420 + 840 × 5/7
  assert.equal(result.totalActualMinutes, 180);
  assert.equal(result.categorySummaries[0].budgetMinutes, 1020);
});

test('월 경계 주는 해당 월에 기록이 있을 때만 그 달 날짜 수만큼 배분한다', () => {
  const categories = [{ id: 'reading', name: '독서', defaultBudgetMinutes: 420 }];
  const weeklyBudgets = [
    { weekStart: '2026-07-27', budgets: { reading: 700 } },
  ];
  const julyOnly = [
    { categoryId: 'reading', date: '2026-07-30', durationMinutes: 60 },
  ];
  const augustOnly = [
    { categoryId: 'reading', date: '2026-08-01', durationMinutes: 60 },
  ];
  assert.equal(
    summarizeRecordedMonthlyBudgetPeriod(julyOnly, categories, weeklyBudgets, 2026, 7).totalBudgetMinutes,
    500,
  );
  assert.equal(
    summarizeRecordedMonthlyBudgetPeriod(julyOnly, categories, weeklyBudgets, 2026, 8).totalBudgetMinutes,
    0,
  );
  assert.equal(
    summarizeRecordedMonthlyBudgetPeriod(augustOnly, categories, weeklyBudgets, 2026, 8).totalBudgetMinutes,
    200,
  );
});
```

- [ ] **Step 3: 테스트를 실행해 실패 확인**

Run:

```bash
node --test tests/domain.test.js
```

Expected: 새 요약 함수가 없어 FAIL

- [ ] **Step 4: 공통 예산 요약 함수로 현재 로직 분리**

`src/domain.js`에서 현재 `summarizeBudgetPeriod()`의 본문을 다음 private 함수로 옮긴다.

```js
function summarizeBudgetRange(entries, categories, weeklyBudgets, start, end, includedWeekKeys = null) {
  const categoryList = [...(categories || [])]
    .sort((a, b) => (Number(a.order) || 999999) - (Number(b.order) || 999999)
      || String(a.name).localeCompare(String(b.name), 'ko'));
  const categoryById = new Map(categoryList.map((category) => [category.id, category]));
  const weeks = weeklyBudgetMap(weeklyBudgets);
  const budgetById = new Map(categoryList.map((category) => [category.id, 0]));

  dateKeys(start, end).forEach((dateKey) => {
    const weekKey = getBudgetWeekKey(fromDateKey(dateKey));
    if (includedWeekKeys && !includedWeekKeys.has(weekKey)) return;
    const week = weeks.get(weekKey);
    categoryList.forEach((category) => {
      const weeklyMinutes = effectiveWeeklyBudget(category, week, dateKey);
      budgetById.set(category.id, (budgetById.get(category.id) || 0) + weeklyMinutes / 7);
    });
  });

  return finalizeBudgetSummary(entries, categoryList, categoryById, budgetById, start, end);
}

export function summarizeBudgetPeriod(entries, categories, weeklyBudgets, start, end) {
  return summarizeBudgetRange(entries, categories, weeklyBudgets, start, end);
}
```

현재 함수의 실제 기록 필터, 삭제된 대분류 추가, 총합·달성률·기록 일수 계산을 `finalizeBudgetSummary()`로 그대로 옮긴다. 반환 필드 이름은 변경하지 않는다.

- [ ] **Step 5: 주별·월간 전용 함수 구현**

```js
export function summarizeWeeklyBudgetPeriod(entries, categories, weeklyBudgets, weekStart) {
  const start = getWeekRange(fromDateKey(weekStart)).start;
  const end = toDateKey(addDays(start, 6));
  return summarizeBudgetRange(entries, categories, weeklyBudgets, start, end);
}

export function summarizeRecordedMonthlyBudgetPeriod(entries, categories, weeklyBudgets, year, month) {
  const range = getMonthRange(year, month);
  const weekKeys = recordedWeekKeysForMonth(entries, year, month);
  const summary = summarizeBudgetRange(
    entries,
    categories,
    weeklyBudgets,
    range.start,
    range.end,
    new Set(weekKeys),
  );
  return { ...summary, recordWeekCount: weekKeys.length };
}
```

- [ ] **Step 6: 전체 도메인 테스트 실행**

Run:

```bash
node --test tests/domain.test.js
```

Expected: 기존 예산 통계 테스트와 새 주별·월간 테스트 모두 PASS

- [ ] **Step 7: 커밋**

```bash
git add src/domain.js tests/domain.test.js
git commit -m "feat: calculate weekly and recorded monthly budgets"
```

---

### Task 3: 기록 달 기반 연간 통계와 기록 기간 비교

**Files:**
- Modify: `src/domain.js:260-380`
- Modify: `tests/domain.test.js:185-310`

**Interfaces:**
- Consumes: `summarizeRecordedMonthlyBudgetPeriod()`, `recordedMonthsForYear()`, `calculatePeriodChange()`
- Produces:
  - `summarizeRecordedYearlyBudgetPeriod(entries, categories, weeklyBudgets, year): BudgetSummary & { recordMonthCount: number }`
  - `calculateRecordedMonthAverage(totalMinutes, recordMonthCount): number`
  - 갱신된 `detailedMonthlyBudgetComparison()`
  - 갱신된 `detailedYearlyBudgetComparison()`

- [ ] **Step 1: 실패하는 연간 통계 테스트 작성**

```js
import {
  calculateRecordedMonthAverage,
  summarizeRecordedYearlyBudgetPeriod,
} from '../src/domain.js';

test('연간 예산은 기록이 있는 달들의 월간 예산만 합산한다', () => {
  const categories = [{ id: 'reading', name: '독서', defaultBudgetMinutes: 420 }];
  const weeklyBudgets = [
    { weekStart: '2026-07-20', budgets: { reading: 560 } },
    { weekStart: '2026-08-03', budgets: { reading: 700 } },
    { weekStart: '2026-09-07', budgets: { reading: 840 } },
  ];
  const entries = [
    { categoryId: 'reading', date: '2026-07-25', durationMinutes: 120 },
    { categoryId: 'reading', date: '2026-09-10', durationMinutes: 180 },
  ];
  const result = summarizeRecordedYearlyBudgetPeriod(
    entries,
    categories,
    weeklyBudgets,
    2026,
  );
  assert.equal(result.recordMonthCount, 2);
  assert.equal(result.totalBudgetMinutes, 1400); // 7월 560 + 9월 840, 8월 제외
  assert.equal(result.totalActualMinutes, 300);
  assert.equal(result.recordDays, 2);
  assert.equal(calculateRecordedMonthAverage(result.totalActualMinutes, result.recordMonthCount), 150);
});
```

- [ ] **Step 2: 실패하는 비교 통계 테스트로 기존 기대값 교체**

기존 `12개월 전체`와 `주간 예산만 있는 연도 포함` 기대를 제거하고 다음 테스트로 교체한다.

```js
test('월간 비교는 기록이 있는 달만 반환하고 이전 기록 달과 비교한다', () => {
  const entries = [
    { categoryId: 'reading', durationMinutes: 120, date: '2026-07-02' },
    { categoryId: 'reading', durationMinutes: 180, date: '2026-09-03' },
  ];
  const categories = [{ id: 'reading', name: '독서', defaultBudgetMinutes: 420 }];
  const result = detailedMonthlyBudgetComparison(entries, categories, [], 2026);
  assert.deepEqual(result.map((item) => item.month), [7, 9]);
  assert.equal(result[0].changeMinutes, null);
  assert.equal(result[1].changeMinutes, 60);
  assert.equal(result[1].changePercentage, 50);
});

test('연도별 비교는 실제 기록이 있는 연도만 반환한다', () => {
  const entries = [
    { categoryId: 'reading', durationMinutes: 120, date: '2025-12-31' },
    { categoryId: 'reading', durationMinutes: 240, date: '2027-01-02' },
  ];
  const categories = [{ id: 'reading', name: '독서', defaultBudgetMinutes: 420 }];
  const weeklyBudgets = [
    { weekStart: '2026-07-20', budgets: { reading: 1000 } },
  ];
  const result = detailedYearlyBudgetComparison(entries, categories, weeklyBudgets);
  assert.deepEqual(result.map((item) => item.year), [2025, 2027]);
  assert.equal(result[1].changeMinutes, 120);
  assert.equal(result[1].changePercentage, 100);
});
```

- [ ] **Step 3: 테스트를 실행해 실패 확인**

Run:

```bash
node --test tests/domain.test.js
```

Expected: 연간 요약 함수가 없고 기존 비교 함수가 빈 달·예산 연도를 포함해 FAIL

- [ ] **Step 4: 월간 요약 합산 함수 구현**

```js
function combineBudgetSummaries(summaries, categories) {
  const categoryList = [...(categories || [])]
    .sort((a, b) => (Number(a.order) || 999999) - (Number(b.order) || 999999));
  const totals = new Map(categoryList.map((category) => [category.id, {
    id: category.id,
    name: category.name,
    budgetMinutes: 0,
    actualMinutes: 0,
  }]));

  summaries.forEach((summary) => {
    summary.categorySummaries.forEach((item) => {
      const current = totals.get(item.id) || {
        id: item.id,
        name: item.name,
        budgetMinutes: 0,
        actualMinutes: 0,
      };
      current.budgetMinutes += item.budgetMinutes;
      current.actualMinutes += item.actualMinutes;
      totals.set(item.id, current);
    });
  });

  const categorySummaries = [...totals.values()].map((item) => ({
    ...item,
    ...calculateBudgetAchievement(item.budgetMinutes, item.actualMinutes),
  }));
  const totalBudgetMinutes = categorySummaries.reduce((sum, item) => sum + item.budgetMinutes, 0);
  const totalActualMinutes = categorySummaries.reduce((sum, item) => sum + item.actualMinutes, 0);
  const dates = new Set();
  summaries.forEach((summary) => (summary.recordDates || []).forEach((date) => dates.add(date)));
  const achievement = calculateBudgetAchievement(totalBudgetMinutes, totalActualMinutes);
  return {
    totalBudgetMinutes,
    totalActualMinutes,
    ...achievement,
    recordDays: dates.size,
    dailyAverageMinutes: dates.size ? Math.round(totalActualMinutes / dates.size) : 0,
    categorySummaries,
    recordDates: [...dates],
  };
}
```

`finalizeBudgetSummary()`의 반환값에 내부 합산용 `recordDates: [...days]`를 추가한다. UI는 이 필드를 표시하지 않는다.

- [ ] **Step 5: 기록 기반 연간 요약과 월평균 구현**

```js
export function summarizeRecordedYearlyBudgetPeriod(entries, categories, weeklyBudgets, year) {
  const months = recordedMonthsForYear(entries, year);
  const summaries = months.map((month) => summarizeRecordedMonthlyBudgetPeriod(
    entries,
    categories,
    weeklyBudgets,
    year,
    month,
  ));
  return { ...combineBudgetSummaries(summaries, categories), recordMonthCount: months.length };
}

export function calculateRecordedMonthAverage(totalMinutes, recordMonthCount) {
  const divisor = Number(recordMonthCount) || 0;
  return divisor ? Math.round((Number(totalMinutes) || 0) / divisor) : 0;
}
```

- [ ] **Step 6: 비교 함수 갱신**

```js
export function detailedMonthlyBudgetComparison(entries, categories, weeklyBudgets, year) {
  const rows = recordedMonthsForYear(entries, year).map((month) => ({
    month,
    ...summarizeRecordedMonthlyBudgetPeriod(entries, categories, weeklyBudgets, year, month),
  }));
  return rows.map((row, index) => {
    const change = index
      ? calculatePeriodChange(row.totalActualMinutes, rows[index - 1].totalActualMinutes)
      : { minutes: null, percentage: null };
    return { ...row, changeMinutes: change.minutes, changePercentage: change.percentage };
  });
}

export function detailedYearlyBudgetComparison(entries, categories, weeklyBudgets) {
  const years = [...new Set((entries || [])
    .filter((entry) => /^\d{4}-\d{2}-\d{2}$/.test(String(entry.date || '')))
    .map((entry) => Number(entry.date.slice(0, 4))))]
    .sort((a, b) => a - b);
  const rows = years.map((year) => ({
    year,
    ...summarizeRecordedYearlyBudgetPeriod(entries, categories, weeklyBudgets, year),
  }));
  return rows.map((row, index) => {
    const change = index
      ? calculatePeriodChange(row.totalActualMinutes, rows[index - 1].totalActualMinutes)
      : { minutes: null, percentage: null };
    return { ...row, changeMinutes: change.minutes, changePercentage: change.percentage };
  });
}
```

- [ ] **Step 7: 도메인 테스트 실행**

Run:

```bash
node --test tests/domain.test.js
```

Expected: 기록 기반 연간·비교 통계 테스트 PASS

- [ ] **Step 8: 커밋**

```bash
git add src/domain.js tests/domain.test.js
git commit -m "feat: aggregate recorded yearly statistics"
```

---

### Task 4: 주별 통계 탭과 이전 주·다음 주 탐색 UI

**Files:**
- Modify: `src/statistics-ui.js:1-422`
- Modify: `tests/ui-contract.test.js:1-58`
- Modify: `tests/mobile-statistics-layout.test.js`

**Interfaces:**
- Consumes:
  - `moveWeekStart()`
  - `summarizeWeeklyBudgetPeriod()`
  - `summarizeRecordedMonthlyBudgetPeriod()`
  - `summarizeRecordedYearlyBudgetPeriod()`
  - `calculateRecordedMonthAverage()`
- Produces: 주별 통계 탭, 선택 주 상태, 이전·다음 주 탐색, 기록 기반 월간·연간 화면

- [ ] **Step 1: 실패하는 UI 계약 테스트 작성**

`tests/ui-contract.test.js`에 다음 테스트를 추가한다.

```js
test('통계 화면은 주별 통계를 첫 탭으로 제공하고 주를 화살표로 이동한다', async () => {
  const source = await read('src/statistics-ui.js');
  assert.match(source, /mode:\s*['"]weekly['"]/);
  assert.match(source, /weekStart:\s*getWeekRange\(now\)\.start/);
  assert.match(source, /주별 통계/);
  assert.match(source, /이전 주/);
  assert.match(source, /다음 주/);
  assert.match(source, /data-week-direction/);
  assert.match(source, /moveWeekStart/);
  assert.match(source, /summarizeWeeklyBudgetPeriod/);
});

test('월간과 연간 통계는 기록 기반 요약 함수를 사용한다', async () => {
  const source = await read('src/statistics-ui.js');
  assert.match(source, /summarizeRecordedMonthlyBudgetPeriod/);
  assert.match(source, /summarizeRecordedYearlyBudgetPeriod/);
  assert.match(source, /calculateRecordedMonthAverage/);
  assert.doesNotMatch(source, /calculateYearMonthlyAverage/);
});
```

`tests/mobile-statistics-layout.test.js`에는 주 탐색이 모바일에서 한 줄을 넘겨도 깨지지 않는 계약을 추가한다.

```js
test('주별 통계 탐색은 모바일에서 줄바꿈 가능한 반응형 레이아웃을 사용한다', async () => {
  const code = await source();
  assert.match(code, /\.week-statistics-navigation\s*\{[^}]*display\s*:\s*flex/s);
  assert.match(code, /@media\(max-width:800px\)[\s\S]*\.week-statistics-navigation/s);
  assert.match(code, /flex-wrap\s*:\s*wrap/);
});
```

- [ ] **Step 2: 테스트 실행해 실패 확인**

Run:

```bash
node --test tests/ui-contract.test.js tests/mobile-statistics-layout.test.js
```

Expected: 주별 상태·탐색·기록 기반 함수 사용 계약이 없어 FAIL

- [ ] **Step 3: import와 상태 갱신**

`src/statistics-ui.js`의 import를 다음처럼 변경한다.

```js
import {
  calculateRecordedMonthAverage,
  detailedMonthlyBudgetComparison,
  detailedYearlyBudgetComparison,
  formatMinutes,
  getMonthRange,
  getWeekRange,
  moveWeekStart,
  summarizeRecordedMonthlyBudgetPeriod,
  summarizeRecordedYearlyBudgetPeriod,
  summarizeWeeklyBudgetPeriod,
} from './domain.js';
```

상태 기본값을 주별 통계로 바꾼다.

```js
const statisticsState = {
  mode: 'weekly',
  weekStart: getWeekRange(now).start,
  year: now.getFullYear(),
  month: now.getMonth() + 1,
  entries: [],
  activeCategories: [],
  archivedCategories: [],
  weeklyBudgets: [],
};
```

- [ ] **Step 4: 주별 헤더와 탐색 마크업 구현**

```js
function selectedWeekRange() {
  return getWeekRange(new Date(`${statisticsState.weekStart}T12:00:00`));
}

function statisticsHeaderText() {
  if (statisticsState.mode === 'weekly') {
    const range = selectedWeekRange();
    return `${range.start} — ${range.end} · 주별 예산 대비 통계`;
  }
  if (statisticsState.mode === 'monthly') return `${statisticsState.year}년 ${statisticsState.month}월 · 예산 대비 통계`;
  if (statisticsState.mode === 'yearly') return `${statisticsState.year}년 · 예산 대비 통계`;
  if (statisticsState.mode === 'monthly-comparison') return `${statisticsState.year}년 기록 월 비교 · 예산 대비 통계`;
  return '기록 연도 비교 · 예산 대비 통계';
}

function weeklyNavigationHtml() {
  const range = selectedWeekRange();
  const currentWeekStart = getWeekRange(now).start;
  return `<div class="week-statistics-navigation">
    <button class="secondary-button" data-week-direction="-1">← 이전 주</button>
    <strong>${range.start} ~ ${range.end}</strong>
    <button class="secondary-button" data-week-direction="1" ${statisticsState.weekStart >= currentWeekStart ? 'disabled' : ''}>다음 주 →</button>
  </div>`;
}
```

- [ ] **Step 5: 주별·월간·연간 HTML 생성 함수 교체**

```js
function weeklyStatisticsHtml() {
  const summary = summarizeWeeklyBudgetPeriod(
    statisticsState.entries,
    allCategories(),
    statisticsState.weeklyBudgets,
    statisticsState.weekStart,
  );
  return `${weeklyNavigationHtml()}${summaryCards(summary)}${categoryAchievementTable(summary, '대분류별 주간 예산 달성')}`;
}

function monthlyStatisticsHtml() {
  const summary = summarizeRecordedMonthlyBudgetPeriod(
    statisticsState.entries,
    allCategories(),
    statisticsState.weeklyBudgets,
    statisticsState.year,
    statisticsState.month,
  );
  return `${summaryCards(summary)}${categoryAchievementTable(summary, '대분류별 월간 예산 달성')}`;
}

function yearlyStatisticsHtml() {
  const summary = summarizeRecordedYearlyBudgetPeriod(
    statisticsState.entries,
    allCategories(),
    statisticsState.weeklyBudgets,
    statisticsState.year,
  );
  return `${summaryCards(summary, true)}${categoryAchievementTable(summary, '대분류별 연간 예산 달성')}`;
}
```

`summaryCards(summary, yearly)`의 월평균 계산을 교체한다.

```js
const monthlyAverage = yearly
  ? calculateRecordedMonthAverage(summary.totalActualMinutes, summary.recordMonthCount)
  : null;
```

연간 월평균 안내 문구는 `${summary.recordMonthCount}개 기록 월 기준`으로 표시한다.

- [ ] **Step 6: 렌더 분기와 이벤트 연결**

통계 탭 배열을 다음 순서로 바꾼다.

```js
[
  ['weekly', '주별 통계'],
  ['monthly', '월간 통계'],
  ['yearly', '연간 통계'],
  ['monthly-comparison', '월간 비교'],
  ['yearly-comparison', '연도별 비교'],
]
```

본문 분기를 다음처럼 바꾼다.

```js
const body = mode === 'weekly'
  ? weeklyStatisticsHtml()
  : mode === 'monthly'
    ? monthlyStatisticsHtml()
    : mode === 'yearly'
      ? yearlyStatisticsHtml()
      : mode === 'monthly-comparison'
        ? monthlyComparisonHtml()
        : yearlyComparisonHtml();
```

연도 컨트롤은 `weekly`, `yearly-comparison`에서 숨기고, 주 이동 버튼 이벤트를 연결한다.

```js
view.querySelectorAll('[data-week-direction]').forEach((button) => {
  button.onclick = () => {
    statisticsState.weekStart = moveWeekStart(
      statisticsState.weekStart,
      Number(button.dataset.weekDirection),
      now,
    );
    updateStatisticsHeader();
    renderStatistics();
  };
});
```

- [ ] **Step 7: 주 탐색 스타일 추가**

`injectStyles()`에 다음 CSS를 추가한다.

```css
.week-statistics-navigation{
  display:flex;
  align-items:center;
  justify-content:space-between;
  gap:12px;
  flex-wrap:wrap;
  margin-bottom:18px;
}
.week-statistics-navigation strong{flex:1;text-align:center}
.week-statistics-navigation button:disabled{opacity:.45;cursor:not-allowed}
@media(max-width:800px){
  .week-statistics-navigation{display:flex;flex-wrap:wrap}
  .week-statistics-navigation strong{order:-1;flex-basis:100%}
  .week-statistics-navigation button{flex:1}
}
```

- [ ] **Step 8: UI 테스트 실행**

Run:

```bash
node --test tests/ui-contract.test.js tests/mobile-statistics-layout.test.js
node --check src/statistics-ui.js
```

Expected: 모든 주별 UI 계약과 구문 검사 PASS

- [ ] **Step 9: 커밋**

```bash
git add src/statistics-ui.js tests/ui-contract.test.js tests/mobile-statistics-layout.test.js
git commit -m "feat: add navigable weekly statistics"
```

---

### Task 5: 기록 월 비교로 전환하고 기존 미래 월 DOM 패치 제거

**Files:**
- Modify: `index.html:67-72`
- Delete: `src/current-month-statistics.js`
- Delete: `src/statistics-period.js`
- Delete: `tests/future-months.test.js`
- Modify: `tests/ui-contract.test.js`
- Modify: `src/statistics-ui.js`

**Interfaces:**
- Consumes: 기록이 있는 달만 반환하는 `detailedMonthlyBudgetComparison()`
- Produces: DOM 후처리 없이 처음부터 정확한 행만 렌더링하는 월간 비교 화면

- [ ] **Step 1: 기존 후처리 제거 계약 테스트 작성**

`tests/ui-contract.test.js`에 다음 테스트를 추가한다.

```js
test('월간 비교는 별도 MutationObserver 후처리 없이 기록 월만 직접 렌더링한다', async () => {
  const [indexHtml, statisticsSource] = await Promise.all([
    read('index.html'),
    read('src/statistics-ui.js'),
  ]);
  assert.doesNotMatch(indexHtml, /current-month-statistics\.js/);
  assert.match(statisticsSource, /기록 월 비교/);
  assert.doesNotMatch(statisticsSource, /1월~12월 비교/);
});
```

- [ ] **Step 2: 월간 비교 빈 상태 처리 추가**

`monthlyComparisonHtml()`을 다음처럼 바꾼다.

```js
function monthlyComparisonHtml() {
  const items = detailedMonthlyBudgetComparison(
    statisticsState.entries,
    allCategories(),
    statisticsState.weeklyBudgets,
    statisticsState.year,
  );
  if (!items.length) {
    return '<div class="card"><div class="empty-statistics">이 연도에는 비교할 실제 기록이 없습니다.</div></div>';
  }
  return `${comparisonChart(items, 'month', (month) => `${month}월`, '이전 기록 월 대비')}
    ${comparisonDetailTable(items, 'month', (month) => `${month}월`, '이전 기록 월 대비')}
    ${categoryBudgetMatrix(items, 'month', (month) => `${month}월`, '기록 월별 대분류 예산·실제')}`;
}
```

`yearlyComparisonHtml()`의 비교 문구도 `이전 기록 연도 대비`로 바꾼다.

- [ ] **Step 3: 오래된 스크립트와 테스트 제거**

```bash
git rm src/current-month-statistics.js src/statistics-period.js tests/future-months.test.js
```

`index.html`에서 다음 줄을 삭제한다.

```html
<script type="module" src="./src/current-month-statistics.js"></script>
```

- [ ] **Step 4: UI 계약과 전체 테스트 실행**

Run:

```bash
node --test tests/ui-contract.test.js
npm test
```

Expected: 현재 월 후처리 없이 기록 월 비교가 직접 렌더링되고 0 failures

- [ ] **Step 5: 커밋**

```bash
git add index.html src/statistics-ui.js tests/ui-contract.test.js
git commit -m "refactor: render recorded comparison periods directly"
```

---

### Task 6: 빈 기간 안내, 문구 정리, 전체 회귀 검증

**Files:**
- Modify: `src/statistics-ui.js`
- Verify: `src/domain.js`
- Verify: `tests/domain.test.js`
- Verify: `tests/ui-contract.test.js`
- Verify: `tests/mobile-statistics-layout.test.js`
- Verify: `index.html`

**Interfaces:**
- Consumes: Task 1~5의 계산 함수와 UI
- Produces: 병합 가능한 검증된 기능 브랜치

- [ ] **Step 1: 기록 기반 계산 설명 문구 갱신**

`categoryAchievementTable()`에 전달하는 설명을 화면별로 구분할 수 있도록 세 번째 인자를 추가한다.

```js
function categoryAchievementTable(summary, title, explanation) {
  // 기존 표 마크업 유지
}
```

주별 설명:

```text
선택한 주의 월요일부터 주일까지 전체 주간 예산과 실제 기록을 비교합니다.
```

월간 설명:

```text
이 달에 실제 기록이 있는 주들의 예산만 합산합니다. 월 경계 주는 해당 월 날짜 수만큼 7일 비례 배분합니다.
```

연간 설명:

```text
이 연도에 실제 기록이 있는 달들의 월간 예산만 합산합니다.
```

- [ ] **Step 2: 기록 없는 월·연간 안내 추가**

`monthlyStatisticsHtml()`과 `yearlyStatisticsHtml()`에서 기록 수가 0이면 요약 카드 위에 다음 안내를 표시한다.

```js
const emptyNotice = summary.recordDays === 0
  ? '<div class="statistics-note">이 기간에는 실제 기록이 없어 예산도 통계 계산에서 제외됩니다.</div>'
  : '';
```

주별 통계는 기록이 없어도 전체 예산을 보여주므로 이 안내를 사용하지 않는다.

- [ ] **Step 3: 자바스크립트 구문 검사**

Run:

```bash
node --check src/domain.js
node --check src/statistics-ui.js
```

Expected: 출력 없이 exit 0

- [ ] **Step 4: 전체 테스트 실행**

Run:

```bash
npm test
```

Expected: 모든 도메인·UI·모바일 회귀 테스트 0 failures

- [ ] **Step 5: 요구사항 소스 검토**

Run:

```bash
grep -n "summarizeWeeklyBudgetPeriod\|summarizeRecordedMonthlyBudgetPeriod\|summarizeRecordedYearlyBudgetPeriod" src/domain.js src/statistics-ui.js
grep -n "주별 통계\|이전 주\|다음 주\|기록 월 비교" src/statistics-ui.js
grep -n "current-month-statistics\|statistics-period" index.html src/*.js tests/*.js || true
```

Expected:
- 주별·기록 기반 월간·연간 함수가 도메인과 UI에 존재
- 주별 탭과 양방향 주 탐색 문구 존재
- 제거한 현재 월 후처리 모듈 참조가 없음

- [ ] **Step 6: 최종 커밋**

```bash
git add src/domain.js src/statistics-ui.js index.html tests
git commit -m "test: verify record-driven statistics workflow"
```

- [ ] **Step 7: PR 생성 및 CI 확인**

```bash
git push -u origin agent/record-driven-weekly-statistics
```

PR 기준:

```text
Base: agent/build-mvp
Head: agent/record-driven-weekly-statistics
Title: feat: add record-driven weekly statistics
```

Expected: GitHub Actions CI success

- [ ] **Step 8: 사용자 선택에 따라 병합**

CI 성공 후 `agent/build-mvp` 병합 여부를 사용자에게 확인하고 선택에 따라 처리한다.
