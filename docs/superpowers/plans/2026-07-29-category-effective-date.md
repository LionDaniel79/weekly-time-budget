# Category Effective Date Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 새 대분류를 추가한 현지 날짜부터만 대시보드·예산·기록·통계에 반영하고, 기존 대분류는 과거·오늘·미래에 계속 활성 상태로 유지한다.

**Architecture:** 날짜 정규화·대분류 활성 여부·기록 유효 여부를 `src/category-effective-date.js`의 순수 함수로 분리한다. 일간·주간·월간·연간 집계는 이 공통 함수를 날짜별로 적용하고, 입력 UI는 목록 필터와 저장 직전 검증을 모두 수행한다. `createdDate`는 새 대분류 생성 시 한 번 저장하며 수정·일괄 저장·보관·복원에서는 원래 값을 보존한다.

**Tech Stack:** ES modules, Firebase 11.10.0 Auth/Firestore, IndexedDB local-first runtime, Node.js `node:test`, GitHub Pages PWA.

## Global Constraints

- 새 대분류 문서만 `createdDate: YYYY-MM-DD`를 가진다.
- `createdDate`는 사용자 현지 날짜를 `toDateKey(new Date())`로 저장한다.
- `createdDate`가 없거나 유효하지 않은 기존 대분류는 모든 날짜에서 활성이다.
- 유효한 `createdDate`가 있는 대분류는 그 날짜부터 활성이고 이전 날짜에는 존재하지 않았던 항목처럼 처리한다.
- 성장 목표와 절제 목표에 같은 생성일 규칙을 적용한다.
- 생성일 이전에는 대분류 행, 예산, 실제 기록, 분야 수, 달성률, 목표 준수 점수의 분자·분모에서 모두 제외한다.
- 주중 추가 시 기존 요일 배분 중 생성일부터 일요일까지의 몫만 합산하고 남은 날짜에 주간 예산 전체를 재분배하지 않는다.
- 수동 입력은 생성일 이전 날짜의 대분류 선택을 숨기고 저장 직전에도 차단한다.
- 타이머는 시작일 현재 활성인 대분류만 새로 시작할 수 있다.
- 시작 당시 유효한 활성 타이머의 복구·일시정지·저장 동작은 변경하지 않는다.
- 생성일 이전에 비정상적으로 저장된 기록은 대시보드·통계·기록 내역에서 숨긴다.
- 수정·순서 변경·일괄 저장은 `createdDate`를 덮어쓰지 않는다.
- 보관과 복원은 최초 `createdDate`를 그대로 보존한다.
- 온라인·오프라인 렌더러가 같은 기간 요약 함수를 사용한다.
- 기록 기반 날짜·주·월 이동 규칙은 변경하지 않는다.
- 새 외부 의존성을 추가하지 않는다.
- 서비스 워커 셸 캐시는 `weekly-time-budget-shell-v10`으로 올린다.

## File Structure

- Create `src/category-effective-date.js`: 날짜 정규화, 날짜·기간 활성 여부, 기록 유효 여부, 날짜별 필터.
- Modify `src/app.js`: 새 대분류 생성일 저장, 기본 대시보드, 수동 입력·기존 타이머 검증.
- Modify `src/category-ui-patch.js`: 보관·복원 생성일 보존, 기록 내역 방어 필터.
- Verify `src/category-bulk-editor.js`: 이름·예산·순서만 병합하여 생성일 보존.
- Modify `src/time-budget-domain.js`: 일간 예산·카운트다운 기준·일간 요약.
- Modify `src/domain.js`: 주간·월간·연간 날짜별 예산과 기록 집계.
- Modify `src/time-budget-feature.js`: 기간 대분류 선택, 현재 예산 편집 목록, 주간 대시보드.
- Verify `src/time-budget-ui.js`: 전달받은 모델만 렌더링.
- Modify `src/persistent-timer-ui.js`: 현재 활성 대분류만 새 타이머에 제공하고 시작 직전 재검증.
- Modify `src/statistics-ui.js`: 기간 요약에 없는 행을 다시 생성하지 않고 비교 표의 생성 전 칸은 `—` 표시.
- Verify `src/statistics-offline-rescue.js`: 오프라인에서도 공통 기간 요약 사용.
- Modify `service-worker.js`, `.github/workflows/ci.yml`: 새 모듈 캐시와 Pages 산출물 검사.

---

### Task 1: 생성일 순수 도메인

**Files:**
- Create: `src/category-effective-date.js`
- Create: `tests/category-effective-date.test.js`

**Interfaces:**
- Produces: `normalizeDateKey(value): string | null`
- Produces: `normalizeCategoryCreatedDate(category): string | null`
- Produces: `isCategoryActiveOnDate(category, dateKey): boolean`
- Produces: `isCategoryActiveInRange(category, startDate, endDate): boolean`
- Produces: `isEntryWithinCategoryEffectiveDate(entry, category): boolean`
- Produces: `filterCategoriesActiveOnDate(categories, dateKey): Category[]`

- [ ] **Step 1: 실패 테스트 작성**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  filterCategoriesActiveOnDate,
  isCategoryActiveInRange,
  isCategoryActiveOnDate,
  isEntryWithinCategoryEffectiveDate,
  normalizeCategoryCreatedDate,
  normalizeDateKey,
} from '../src/category-effective-date.js';

test('유효한 날짜 키만 정규화한다', () => {
  assert.equal(normalizeDateKey('2026-07-29'), '2026-07-29');
  assert.equal(normalizeDateKey('2026-02-30'), null);
  assert.equal(normalizeDateKey('invalid'), null);
});

test('생성일이 없는 기존 대분류는 과거 오늘 미래에 모두 활성이다', () => {
  const category = { id: 'legacy' };
  assert.equal(isCategoryActiveOnDate(category, '2020-01-01'), true);
  assert.equal(isCategoryActiveOnDate(category, '2026-07-29'), true);
  assert.equal(isCategoryActiveOnDate(category, '2030-12-31'), true);
});

test('새 대분류는 생성일부터 활성이다', () => {
  const category = { id: 'phone', createdDate: '2026-07-29' };
  assert.equal(isCategoryActiveOnDate(category, '2026-07-28'), false);
  assert.equal(isCategoryActiveOnDate(category, '2026-07-29'), true);
  assert.equal(isCategoryActiveOnDate(category, '2026-07-30'), true);
});

test('잘못된 생성일은 기존 데이터 보호를 위해 제한 없음으로 처리한다', () => {
  const category = { createdDate: '2026-02-30' };
  assert.equal(normalizeCategoryCreatedDate(category), null);
  assert.equal(isCategoryActiveOnDate(category, '2026-01-01'), true);
});

test('기간 종료일보다 늦게 생성된 대분류는 기간에서 제외한다', () => {
  const category = { createdDate: '2026-07-29' };
  assert.equal(isCategoryActiveInRange(category, '2026-07-01', '2026-07-28'), false);
  assert.equal(isCategoryActiveInRange(category, '2026-07-01', '2026-07-31'), true);
});

test('생성일 이전 비정상 기록만 제외한다', () => {
  const category = { createdDate: '2026-07-29' };
  assert.equal(isEntryWithinCategoryEffectiveDate({ date: '2026-07-28' }, category), false);
  assert.equal(isEntryWithinCategoryEffectiveDate({ date: '2026-07-29' }, category), true);
  assert.equal(isEntryWithinCategoryEffectiveDate({ date: '2020-01-01' }, null), true);
});

test('날짜별 필터는 원래 순서를 유지한다', () => {
  const categories = [
    { id: 'legacy' },
    { id: 'future', createdDate: '2026-07-30' },
    { id: 'today', createdDate: '2026-07-29' },
  ];
  assert.deepEqual(
    filterCategoriesActiveOnDate(categories, '2026-07-29').map((item) => item.id),
    ['legacy', 'today'],
  );
});
```

- [ ] **Step 2: 실패 확인**

Run: `node --test tests/category-effective-date.test.js`

Expected: FAIL with `ERR_MODULE_NOT_FOUND`.

- [ ] **Step 3: 최소 구현 작성**

```js
const DATE_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const pad = (value) => String(value).padStart(2, '0');
const localDateKey = (date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;

export function normalizeDateKey(value) {
  const text = String(value ?? '').slice(0, 10);
  if (!DATE_KEY_PATTERN.test(text)) return null;
  const [year, month, day] = text.split('-').map(Number);
  const date = new Date(year, month - 1, day, 12, 0, 0, 0);
  return localDateKey(date) === text ? text : null;
}

export function normalizeCategoryCreatedDate(category = {}) {
  return normalizeDateKey(category.createdDate);
}

export function isCategoryActiveOnDate(category = {}, dateKey) {
  const date = normalizeDateKey(dateKey);
  if (!date) return false;
  const createdDate = normalizeCategoryCreatedDate(category);
  return !createdDate || date >= createdDate;
}

export function isCategoryActiveInRange(category = {}, startDate, endDate) {
  const start = normalizeDateKey(startDate);
  const end = normalizeDateKey(endDate);
  if (!start || !end || start > end) return false;
  const createdDate = normalizeCategoryCreatedDate(category);
  return !createdDate || createdDate <= end;
}

export function isEntryWithinCategoryEffectiveDate(entry = {}, category = null) {
  if (!category) return true;
  return isCategoryActiveOnDate(category, entry.date);
}

export function filterCategoriesActiveOnDate(categories = [], dateKey) {
  return categories.filter((category) => isCategoryActiveOnDate(category, dateKey));
}
```

- [ ] **Step 4: 테스트와 전체 회귀 확인**

Run: `node --test tests/category-effective-date.test.js && npm test`

Expected: PASS with no failures.

- [ ] **Step 5: 커밋**

```bash
git add src/category-effective-date.js tests/category-effective-date.test.js
git commit -m "feat: add category effective date domain"
```

---

### Task 2: 생성일 저장과 생명주기 보존

**Files:**
- Modify: `src/app.js` in `saveCategory()`
- Modify: `src/category-ui-patch.js` in `restoreCategory()`
- Verify: `src/category-bulk-editor.js` in `applyAllCategories()`
- Create: `tests/category-effective-date-persistence.test.js`

**Interfaces:**
- Consumes: `toDateKey(date)`
- Produces: 새 대분류에만 immutable `createdDate`

- [ ] **Step 1: 실패 계약 테스트 작성**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const app = await readFile(new URL('../src/app.js', import.meta.url), 'utf8');
const lifecycle = await readFile(new URL('../src/category-ui-patch.js', import.meta.url), 'utf8');
const bulk = await readFile(new URL('../src/category-bulk-editor.js', import.meta.url), 'utf8');

test('새 대분류 생성에만 현지 createdDate를 저장한다', () => {
  assert.match(app, /createdDate:\s*toDateKey\(new Date\(\)\)/);
  const updatePath = app.match(/if \(id\)[\s\S]*?else/)?.[0] || '';
  assert.doesNotMatch(updatePath, /createdDate/);
});

test('대분류 수정과 일괄 저장은 createdDate를 쓰지 않는다', () => {
  const render = app.match(/function renderCategories\([\s\S]*?\n}/)?.[0] || '';
  assert.doesNotMatch(render, /name=["']createdDate["']/);
  const batch = bulk.match(/batch\.set\([\s\S]*?\{ merge: true \}/)?.[0] || '';
  assert.doesNotMatch(batch, /createdDate/);
});

test('복원은 보관된 createdDate가 있을 때만 원래 값을 기록한다', () => {
  assert.match(lifecycle, /data\.createdDate !== undefined/);
  assert.match(lifecycle, /createdDate:\s*data\.createdDate/);
});
```

- [ ] **Step 2: 실패 확인**

Run: `node --test tests/category-effective-date-persistence.test.js`

Expected: FAIL because create and restore paths do not handle `createdDate`.

- [ ] **Step 3: 생성 경로 구현**

```js
if (id) {
  await firebase.setDoc(firebase.doc(collectionRef, id), basePayload, { merge: true });
} else {
  await firebase.addDoc(collectionRef, {
    ...basePayload,
    goalType: normalizeGoalType(goalType),
    createdDate: toDateKey(new Date()),
  });
}
```

Do not expose a creation-date input in category management.

- [ ] **Step 4: 복원 경로 구현**

```js
batch.set(storeModule.doc(db, 'users', user.uid, 'categories', categoryId), {
  name: data.name,
  defaultBudgetMinutes: Number(data.defaultBudgetMinutes ?? data.budgetMinutes ?? 0),
  order: data.order || 999,
  goalType: normalizeGoalType(data.goalType),
  ...(data.createdDate !== undefined ? { createdDate: data.createdDate } : {}),
});
```

The archive path already spreads `snapshot.data()` and must remain unchanged.

- [ ] **Step 5: 테스트와 커밋**

Run: `node --test tests/category-effective-date-persistence.test.js && npm test`

```bash
git add src/app.js src/category-ui-patch.js tests/category-effective-date-persistence.test.js
git commit -m "feat: persist category created date"
```

---

### Task 3: 일간 예산과 카운트다운 기준

**Files:**
- Modify: `src/time-budget-domain.js`
- Modify: `tests/time-budget-domain.test.js`

**Interfaces:**
- Consumes: `isCategoryActiveOnDate(category, dateKey)`
- Produces: inactive daily budget `{ minutes: 0, source: 'inactive' }`
- Produces: inactive countdown baseline `null`
- Produces: inactive rows and pre-creation records removed from daily summary

- [ ] **Step 1: 실패 테스트 추가**

```js
test('생성일 이전 일간 예산과 카운트다운 기준을 만들지 않는다', () => {
  const category = { id: 'phone', createdDate: '2026-07-29', defaultBudgetMinutes: 420 };
  assert.deepEqual(resolveDailyBudget({
    category, date: '2026-07-28', weekDocument: null, dailyDocument: null,
  }), { minutes: 0, source: 'inactive' });
  assert.equal(resolveCountdownBudgetBaseline({
    category, date: '2026-07-28', entries: [], weekDocument: null, dailyDocument: null,
  }), null);
});

test('일간 요약은 생성일 이전 대분류와 비정상 기록을 제외한다', () => {
  const summary = summarizeDailyCategories({
    categories: [
      { id: 'legacy', name: '기도', defaultBudgetMinutes: 420 },
      { id: 'phone', name: '스마트폰', createdDate: '2026-07-29', defaultBudgetMinutes: 420 },
    ],
    entries: [
      { categoryId: 'legacy', date: '2026-07-28', durationMinutes: 60 },
      { categoryId: 'phone', date: '2026-07-28', durationMinutes: 300 },
    ],
    date: '2026-07-28', weekDocument: null, dailyDocument: null,
  });
  assert.deepEqual(summary.categorySummaries.map((item) => item.id), ['legacy']);
  assert.equal(summary.totalActualMinutes, 60);
});
```

- [ ] **Step 2: 실패 확인**

Run: `node --test tests/time-budget-domain.test.js`

Expected: FAIL because inactive categories still receive budgets and rows.

- [ ] **Step 3: 최소 구현**

```js
import { isCategoryActiveOnDate } from './category-effective-date.js';
```

At the start of `resolveDailyBudget()`:

```js
if (!isCategoryActiveOnDate(category, date)) return { minutes: 0, source: 'inactive' };
```

At the start of `resolveCountdownBudgetBaseline()`:

```js
if (!isCategoryActiveOnDate(category, date)) return null;
```

Replace the first half of `summarizeDailyCategories()` with this complete category and record preparation:

```js
const activeCategories = categories.filter((category) => isCategoryActiveOnDate(category, date));
const categoryById = new Map(activeCategories.map((category) => [category.id, category]));
const relevant = entries.filter((entry) => (
  entry.date === date
  && categoryById.has(entry.categoryId)
  && isCategoryActiveOnDate(categoryById.get(entry.categoryId), entry.date)
));
const categorySummaries = activeCategories.map((category) => {
  const budget = resolveDailyBudget({
    category,
    date,
    weekDocument,
    dailyDocument,
    defaultDayWeights,
  });
  const actualMinutes = relevant
    .filter((entry) => entry.categoryId === category.id)
    .reduce((sum, entry) => sum + Math.max(0, Number(entry.durationMinutes) || 0), 0);
  const goalType = normalizeGoalType(category.goalType);
  const achievement = calculateGoalAchievement({
    goalType,
    budgetMinutes: budget.minutes,
    actualMinutes,
  });
  return {
    id: category.id,
    name: categoryDisplayName(category),
    goalType,
    budgetMinutes: budget.minutes,
    actualMinutes,
    budgetSource: budget.source,
    ...achievement,
    contributionScore: calculateGoalContribution(achievement),
    progress: calculateGoalProgress({
      goalType,
      budgetMinutes: budget.minutes,
      actualMinutes,
    }),
  };
});
```

- [ ] **Step 4: 테스트와 커밋**

Run: `node --test tests/time-budget-domain.test.js && npm test`

```bash
git add src/time-budget-domain.js tests/time-budget-domain.test.js
git commit -m "feat: apply category date to daily budgets"
```

---

### Task 4: 주간·월간·연간 날짜별 집계

**Files:**
- Modify: `src/domain.js`
- Modify: `tests/domain.test.js`
- Modify: `tests/recorded-period-pages.test.js`

**Interfaces:**
- Consumes: `isCategoryActiveOnDate()`, `isCategoryActiveInRange()`, `isEntryWithinCategoryEffectiveDate()`
- Produces: 부분 생성 주 예산과 생성 전 행이 없는 모든 기간 요약

- [ ] **Step 1: 실패 테스트 추가**

```js
test('목요일 생성 대분류의 동일 배분 주간 예산은 4일분만 반영한다', () => {
  const summary = summarizeWeeklyBudgetPeriod(
    [],
    [{ id: 'phone', name: '스마트폰', createdDate: '2026-07-30', defaultBudgetMinutes: 420 }],
    [{
      id: '2026-07-27', weekStart: '2026-07-27', budgets: { phone: 420 },
      dayWeights: { mon: 1, tue: 1, wed: 1, thu: 1, fri: 1, sat: 1, sun: 1 },
    }],
    '2026-07-27',
  );
  assert.equal(summary.totalBudgetMinutes, 240);
});

test('생성 전 기간에는 행이 없고 생성 월은 활성 날짜 예산만 반영한다', () => {
  const category = { id: 'phone', name: '스마트폰', createdDate: '2026-07-29', defaultBudgetMinutes: 420 };
  const before = summarizeBudgetPeriod([], [category], [], '2026-07-01', '2026-07-28');
  const month = summarizeBudgetPeriod([], [category], [], '2026-07-01', '2026-07-31');
  assert.deepEqual(before.categorySummaries, []);
  assert.equal(month.totalBudgetMinutes, 180);
});

test('생성일 이전 비정상 기록은 기간 실제 합계에서 제외한다', () => {
  const summary = summarizeBudgetPeriod(
    [
      { categoryId: 'phone', date: '2026-07-28', durationMinutes: 300 },
      { categoryId: 'phone', date: '2026-07-29', durationMinutes: 60 },
    ],
    [{ id: 'phone', name: '스마트폰', createdDate: '2026-07-29', defaultBudgetMinutes: 420 }],
    [], '2026-07-01', '2026-07-31',
  );
  assert.equal(summary.totalActualMinutes, 60);
});
```

- [ ] **Step 2: 실패 확인**

Run: `node --test tests/domain.test.js`

Expected: FAIL because dates before creation receive budget and pre-creation records are counted.

- [ ] **Step 3: 날짜별 예산과 전체 대분류 맵 구현**

```js
import {
  isCategoryActiveInRange,
  isCategoryActiveOnDate,
  isEntryWithinCategoryEffectiveDate,
} from './category-effective-date.js';
```

At the beginning of `effectiveWeeklyBudget()`:

```js
if (!isCategoryActiveOnDate(category, dateKey)) return 0;
```

At the beginning of `summarizeBudgetRange()`:

```js
const allCategoryList = sortedCategories(categories);
const categoryById = new Map(allCategoryList.map((category) => [category.id, category]));
const categoryList = allCategoryList
  .filter((category) => isCategoryActiveInRange(category, start, end));
const weeks = weeklyBudgetMap(weeklyBudgets);
const budgetById = new Map(categoryList.map((category) => [category.id, 0]));
```

Pass the full `categoryById` to `finalizeBudgetSummary()`. A known category created after the selected period must not be treated as a permanently deleted category.

- [ ] **Step 4: 기록 방어 필터 구현**

```js
const filteredEntries = (entries || []).filter((entry) => {
  if (!isDateKey(entry.date) || entry.date < start || entry.date > end) return false;
  return isEntryWithinCategoryEffectiveDate(entry, categoryById.get(entry.categoryId));
});
```

Unknown permanently deleted categories have no creation metadata and remain visible.

- [ ] **Step 5: 연간 결합의 선행 0행 제거**

```js
const categoryById = new Map(sortedCategories(categories).map((category) => [category.id, category]));
const totals = new Map();
summaries.forEach((summary) => {
  summary.categorySummaries.forEach((item) => {
    const source = categoryById.get(item.id) || item;
    const current = totals.get(item.id) || {
      id: item.id,
      name: source.name || item.name,
      goalType: normalizeGoalType(source.goalType ?? item.goalType),
      budgetMinutes: 0,
      actualMinutes: 0,
    };
    current.budgetMinutes += Number(item.budgetMinutes) || 0;
    current.actualMinutes += Number(item.actualMinutes) || 0;
    totals.set(item.id, current);
  });
});
```

- [ ] **Step 6: 공통 통계 계약 테스트**

```js
test('통계 화면은 날짜별 공통 기간 요약을 사용한다', async () => {
  const source = await readFile(new URL('../src/statistics-ui.js', import.meta.url), 'utf8');
  assert.match(source, /summarizeWeeklyBudgetPeriod/);
  assert.match(source, /summarizeRecordedMonthlyBudgetPeriod/);
  assert.match(source, /summarizeRecordedYearlyBudgetPeriod/);
});
```

- [ ] **Step 7: 테스트와 커밋**

Run: `node --test tests/domain.test.js tests/recorded-period-pages.test.js && npm test`

```bash
git add src/domain.js tests/domain.test.js tests/recorded-period-pages.test.js
git commit -m "feat: apply category date to period summaries"
```

---

### Task 5: 대시보드와 시간 예산 모델

**Files:**
- Modify: `src/time-budget-feature.js`
- Modify: `src/app.js` in legacy `renderDashboard()`
- Verify: `src/time-budget-ui.js`
- Modify: `tests/time-budget-ui.test.js`
- Create: `tests/category-effective-date-feature.test.js`

**Interfaces:**
- Consumes: `filterCategoriesActiveOnDate()`, `isCategoryActiveInRange()`
- Consumes: `summarizeWeeklyBudgetPeriod()`
- Produces: 날짜 인식 대시보드와 현재 날짜 예산 편집 모델

- [ ] **Step 1: 실패 계약 테스트 작성**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const feature = await readFile(new URL('../src/time-budget-feature.js', import.meta.url), 'utf8');
const app = await readFile(new URL('../src/app.js', import.meta.url), 'utf8');

test('시간 예산 기능은 날짜별 활성 함수를 사용한다', () => {
  assert.match(feature, /filterCategoriesActiveOnDate/);
  assert.match(feature, /isCategoryActiveInRange/);
});

test('주간 대시보드와 기본 대시보드는 날짜별 기간 요약을 사용한다', () => {
  assert.match(feature, /summarizeWeeklyBudgetPeriod/);
  assert.match(app, /summarizeWeeklyBudgetPeriod/);
});

test('현재 주간 스냅숏은 오늘 활성인 대분류만 보충한다', () => {
  const block = feature.match(/async function ensureCurrentWeekSnapshot\([\s\S]*?\n}/)?.[0] || '';
  assert.match(block, /activeCategories\(today\(\)\)/);
});
```

- [ ] **Step 2: 실패 확인**

Run: `node --test tests/category-effective-date-feature.test.js`

Expected: FAIL because all categories are treated as current and weekly summaries use the full weekly budget.

- [ ] **Step 3: 기능 모델 구현**

```js
import {
  filterCategoriesActiveOnDate,
  isCategoryActiveInRange,
} from './category-effective-date.js';
```

```js
const activeCategories = (date = today()) => filterCategoriesActiveOnDate(state.categories, date);
```

Use `activeCategories(today())` in `ensureCurrentWeekSnapshot()`. In `periodCategories()` add this before the existing active/budget/entry condition:

```js
.filter((category) => isCategoryActiveInRange(category, start, end))
```

Replace `weeklySummary()` with:

```js
function weeklySummary(key) {
  const range = weekRange(key);
  const week = normalizeWeek(key);
  const categories = periodCategories({ start: range.start, end: range.end, weekDocument: week });
  return summarizeWeeklyBudgetPeriod(state.entries, categories, state.weekly, key);
}
```

Pass `categories: activeCategories(state.budget.today)` to the budget UI model.

- [ ] **Step 4: 기본 대시보드도 공통 주간 요약 사용**

Import `summarizeWeeklyBudgetPeriod` in `src/app.js` and replace the manual weekly calculation:

```js
const range = getWeekRange();
const summary = summarizeWeeklyBudgetPeriod(
  state.entries,
  state.categories,
  state.weeklyBudget ? [state.weeklyBudget] : [],
  range.start,
);
```

Render `summary.categorySummaries`, `summary.totalBudgetMinutes`, `summary.totalActualMinutes`, and `summary.goalComplianceScore` directly.

- [ ] **Step 5: UI 렌더링 테스트**

```js
test('시간 예산 UI는 모델에 전달된 대분류만 렌더링한다', () => {
  const html = renderTimeBudgetHtml({
    mode: 'today', today: '2026-07-29',
    categories: [{ id: 'today', name: '오늘 추가', defaultBudgetMinutes: 60 }],
    weekDocument: null, dailyDocument: null, emptyHtml: '',
  });
  assert.match(html, /오늘 추가/);
  assert.doesNotMatch(html, /생성 전 대분류/);
});
```

- [ ] **Step 6: 테스트와 커밋**

Run: `node --test tests/category-effective-date-feature.test.js tests/time-budget-ui.test.js && npm test`

```bash
git add src/time-budget-feature.js src/app.js tests/category-effective-date-feature.test.js tests/time-budget-ui.test.js
git commit -m "feat: filter dashboards by category date"
```

---

### Task 6: 수동 입력과 타이머 이중 검증

**Files:**
- Modify: `src/app.js`
- Modify: `src/persistent-timer-ui.js`
- Create: `tests/category-effective-date-input.test.js`
- Modify: `tests/countdown-timer-ui.test.js`

**Interfaces:**
- Consumes: `filterCategoriesActiveOnDate()`, `isCategoryActiveOnDate()`
- Produces: 날짜별 수동 선택 목록과 저장 차단
- Produces: 현재 활성 타이머 목록과 시작 차단

- [ ] **Step 1: 실패 계약 테스트 작성**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const app = await readFile(new URL('../src/app.js', import.meta.url), 'utf8');
const timer = await readFile(new URL('../src/persistent-timer-ui.js', import.meta.url), 'utf8');

test('수동 입력은 날짜 변경 때 목록을 갱신하고 저장 직전 재검증한다', () => {
  assert.match(app, /refreshManualCategoryOptions/);
  assert.match(app, /manual-date[^\n]*addEventListener\(['"]change['"]/);
  assert.match(app, /isCategoryActiveOnDate\(category, date\)/);
  assert.match(app, /이 대분류는 추가일 이전 날짜에 기록할 수 없습니다\./);
});

test('영구 타이머는 현재 활성 목록과 시작일 검증을 사용한다', () => {
  assert.match(timer, /filterCategoriesActiveOnDate/);
  assert.match(timer, /isCategoryActiveOnDate\(category, startedDate\)/);
  assert.match(timer, /!activeCategories\.some/);
});
```

- [ ] **Step 2: 실패 확인**

Run: `node --test tests/category-effective-date-input.test.js`

Expected: FAIL because lists and save/start paths are not date-aware.

- [ ] **Step 3: 수동 입력 목록과 저장 가드**

```js
import {
  filterCategoriesActiveOnDate,
  isCategoryActiveOnDate,
} from './category-effective-date.js';
```

```js
const categoryOptionHtml = ({ date, selectedId = '' }) => filterCategoriesActiveOnDate(state.categories, date)
  .map((category) => `<option value="${category.id}" ${category.id === selectedId ? 'selected' : ''}>${escapeHtml(categoryDisplayName(category))}</option>`)
  .join('');

function refreshManualCategoryOptions() {
  const select = $('#manual-category');
  const date = $('#manual-date')?.value;
  if (!select || !date) return;
  const selectedId = select.value;
  select.innerHTML = `<option value="">선택하세요</option>${categoryOptionHtml({ date, selectedId })}`;
  if (![...select.options].some((option) => option.value === selectedId)) {
    select.value = '';
    state.manualCategoryId = '';
  }
}
```

Bind:

```js
$('#manual-date')?.addEventListener('change', refreshManualCategoryOptions);
```

Before manual save:

```js
const category = state.categories.find((item) => item.id === categoryId);
if (!category || !isCategoryActiveOnDate(category, date)) {
  alert('이 대분류는 추가일 이전 날짜에 기록할 수 없습니다.');
  refreshManualCategoryOptions();
  return;
}
```

Use `categoryOptionHtml({ date: toDateKey(new Date()), selectedId })` in the fallback timer form and repeat the same validation before starting it.

- [ ] **Step 4: 영구 타이머 목록과 시작 가드**

```js
import {
  filterCategoriesActiveOnDate,
  isCategoryActiveOnDate,
} from './category-effective-date.js';
```

Replace `categoryOptions()` with:

```js
function categoryOptions(selectedId) {
  const all = new Map([...state.archived, ...state.categories].map((item) => [item.id, item]));
  const date = localDateKey(new Date());
  const activeCategories = filterCategoriesActiveOnDate(state.categories, date);
  const options = activeCategories.map((category) => `<option value="${category.id}" ${category.id === selectedId ? 'selected' : ''}>${escapeHtml(categoryDisplayName(category))}</option>`);
  if (selectedId && !activeCategories.some((category) => category.id === selectedId)) {
    const selected = all.get(selectedId);
    options.unshift(`<option value="${selectedId}" selected>${escapeHtml(selected ? categoryDisplayName(selected) : '보관된 대분류')}</option>`);
  }
  return options.join('');
}
```

Immediately after `const startedDate = localDateKey(new Date());`:

```js
const category = knownCategory(categoryId);
if (!category || !isCategoryActiveOnDate(category, startedDate)) {
  showToast({
    type: 'error',
    title: '이 대분류는 아직 사용할 수 없습니다.',
    message: '대분류 추가일부터 타이머를 시작할 수 있습니다.',
  });
  return;
}
```

- [ ] **Step 5: 타이머 회귀 테스트 보강**

```js
test('생성일 검증은 기존 타이머 복구 경로를 유지한다', async () => {
  const source = await readFile(new URL('../src/persistent-timer-ui.js', import.meta.url), 'utf8');
  assert.match(source, /controller\.recover\(\)/);
  assert.match(source, /selectedId && !activeCategories\.some/);
  assert.match(source, /isCategoryActiveOnDate\(category, startedDate\)/);
});
```

- [ ] **Step 6: 테스트와 커밋**

Run: `node --test tests/category-effective-date-input.test.js tests/countdown-timer-ui.test.js && npm test`

```bash
git add src/app.js src/persistent-timer-ui.js tests/category-effective-date-input.test.js tests/countdown-timer-ui.test.js
git commit -m "feat: guard entries before category date"
```

---

### Task 7: 기록 내역과 온라인·오프라인 통계

**Files:**
- Modify: `src/category-ui-patch.js`
- Modify: `src/statistics-ui.js`
- Verify: `src/statistics-offline-rescue.js`
- Create: `tests/category-effective-date-history.test.js`
- Modify: `tests/statistics-offline-rescue.test.js`
- Modify: `tests/restraint-ui-integration.test.js`

**Interfaces:**
- Consumes: `isEntryWithinCategoryEffectiveDate()`
- Consumes: 생성일 인식 기간 요약
- Produces: 생성 전 기록·행·비교 셀이 없는 온라인·오프라인 결과

- [ ] **Step 1: 실패 기록 내역 테스트 작성**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../src/category-ui-patch.js', import.meta.url), 'utf8');

test('기록 내역은 생성일 이전 비정상 기록을 필터링한다', () => {
  assert.match(source, /isEntryWithinCategoryEffectiveDate/);
  assert.match(source, /entriesSnapshot\.docs[\s\S]*?\.filter\(/);
  assert.match(source, /최근 기록[\s\S]*?\$\{entries\.length\}건/);
});
```

- [ ] **Step 2: 실패 확인**

Run: `node --test tests/category-effective-date-history.test.js`

Expected: FAIL because all server entries are rendered.

- [ ] **Step 3: 기록 내역 필터 구현**

```js
import { isEntryWithinCategoryEffectiveDate } from './category-effective-date.js';
```

```js
const categoryById = new Map([...archivedCategories, ...activeCategories]);
const entries = entriesSnapshot.docs
  .map((docSnapshot) => ({ id: docSnapshot.id, ...docSnapshot.data() }))
  .filter((entry) => isEntryWithinCategoryEffectiveDate(entry, categoryById.get(entry.categoryId)));
```

Active categories override archived duplicates because they are spread last. Permanently deleted categories remain visible.

- [ ] **Step 4: 통계 계약 테스트**

```js
test('오프라인 통계는 공통 기간 요약만 사용한다', async () => {
  const source = await readFile(new URL('../src/statistics-offline-rescue.js', import.meta.url), 'utf8');
  assert.match(source, /summarizeWeeklyBudgetPeriod/);
  assert.match(source, /summarizeRecordedMonthlyBudgetPeriod/);
  assert.match(source, /summarizeRecordedYearlyBudgetPeriod/);
  assert.doesNotMatch(source, /createdDate\s*[<>]=?/);
});

test('통계 비교 표는 생성 전 칸을 0시간으로 만들지 않는다', async () => {
  const source = await readFile(new URL('../src/statistics-ui.js', import.meta.url), 'utf8');
  assert.match(source, /if \(!category\)/);
  assert.match(source, /<span class="muted">—<\/span>/);
});
```

- [ ] **Step 5: 비교 표 구현**

Inside the `orderedIds.map()` callback in `categoryBudgetMatrix()` use:

```js
const categoryName = escapeHtml(categoryById.get(id) ? categoryDisplayName(categoryById.get(id)) : '삭제된 대분류');
const category = byId.get(id);
if (!category) {
  return `<td data-label="${categoryName}"><span class="muted">—</span></td>`;
}
return `<td data-label="${categoryName}"><div class="matrix-cell"><strong>${formatMinutes(category.actualMinutes)} / ${formatMinutes(category.budgetMinutes)}</strong><small>${achievementText(category)}</small></div></td>`;
```

Keep `visibleCategorySummaries()` and the offline `categoryTable()` based only on `summary.categorySummaries`; do not map every current category into zero rows.

- [ ] **Step 6: 테스트와 커밋**

Run: `node --test tests/category-effective-date-history.test.js tests/statistics-offline-rescue.test.js tests/restraint-ui-integration.test.js && npm test`

```bash
git add src/category-ui-patch.js src/statistics-ui.js tests/category-effective-date-history.test.js tests/statistics-offline-rescue.test.js tests/restraint-ui-integration.test.js
git commit -m "feat: hide records before category date"
```

---

### Task 8: PWA 캐시와 최종 검증

**Files:**
- Modify: `service-worker.js`
- Modify: `.github/workflows/ci.yml`
- Modify: `tests/offline-app-integration.test.js`
- Modify: `tests/recorded-period-navigation-integration.test.js`

**Interfaces:**
- Consumes: `src/category-effective-date.js`
- Produces: offline-capable app shell v10

- [ ] **Step 1: 실패 PWA 테스트 작성**

```js
test('서비스 워커는 생성일 도메인과 v10 셸을 캐시한다', async () => {
  const source = await readFile(new URL('../service-worker.js', import.meta.url), 'utf8');
  assert.match(source, /weekly-time-budget-shell-v10/);
  assert.match(source, /\.\/src\/category-effective-date\.js/);
});
```

Update the existing cache assertions in `tests/recorded-period-navigation-integration.test.js`:

```js
assert.ok(serviceWorker.includes('./src/category-effective-date.js'));
assert.ok(serviceWorker.includes('./src/recorded-period-domain.js'));
assert.ok(serviceWorker.includes('./src/recorded-period-navigation.js'));
assert.ok(serviceWorker.includes('weekly-time-budget-shell-v10'));
```

Do not add a second navigation implementation; retain all existing `recorded-period-navigation.js` assertions.

- [ ] **Step 2: 실패 확인**

Run: `node --test tests/offline-app-integration.test.js tests/recorded-period-navigation-integration.test.js`

Expected: FAIL because the service worker is still v9 and lacks the new module.

- [ ] **Step 3: 서비스 워커와 CI 구현**

```js
const SHELL_CACHE = 'weekly-time-budget-shell-v10';
```

Add to `SHELL_URLS` before `goal-domain.js`:

```js
'./src/category-effective-date.js',
```

Add to `.github/workflows/ci.yml`:

```bash
test -f _site/src/category-effective-date.js
```

- [ ] **Step 4: 전체 자동 검증**

Run:

```bash
npm test
FIREBASE_API_KEY=test-api-key \
FIREBASE_AUTH_DOMAIN=test.firebaseapp.com \
FIREBASE_PROJECT_ID=test-project \
FIREBASE_STORAGE_BUCKET=test.firebasestorage.app \
FIREBASE_MESSAGING_SENDER_ID=123456789 \
FIREBASE_APP_ID=1:123456789:web:test \
npm run prepare:pages

test -f _site/index.html
test -f _site/service-worker.js
test -f _site/src/category-effective-date.js
test -f _site/src/goal-domain.js
```

Expected: every command exits 0.

- [ ] **Step 5: 수동 시나리오 검증**

```text
1. createdDate 없는 기존 대분류는 과거 일간, 오늘, 현재 주간에 모두 표시된다.
2. 오늘 만든 대분류는 어제 일간과 과거 통계에서 보이지 않는다.
3. 오늘 만든 대분류는 오늘과 이후 화면에 나타난다.
4. 목요일 생성·주간 7시간·동일 요일 비율은 그 주 예산 4시간으로 표시된다.
5. 수동 입력 날짜를 생성일 전날로 바꾸면 선택이 해제되고 저장이 차단된다.
6. 현재 날짜 타이머에는 새 대분류가 나타나며 시작·멈춤·저장이 정상이다.
7. 보관 후 복원해도 최초 createdDate가 바뀌지 않는다.
8. 네트워크를 끈 뒤 캐시 통계에서도 같은 행과 합계가 표시된다.
9. 월간 비교에서 생성 전 달의 해당 대분류 칸은 0시간이 아니라 —로 표시된다.
```

- [ ] **Step 6: 최종 커밋과 브랜치 검증**

```bash
git add service-worker.js .github/workflows/ci.yml tests/offline-app-integration.test.js tests/recorded-period-navigation-integration.test.js
git commit -m "chore: cache category effective dates"
git status --short
npm test
FIREBASE_API_KEY=test-api-key FIREBASE_AUTH_DOMAIN=test.firebaseapp.com FIREBASE_PROJECT_ID=test-project FIREBASE_STORAGE_BUCKET=test.firebasestorage.app FIREBASE_MESSAGING_SENDER_ID=123456789 FIREBASE_APP_ID=1:123456789:web:test npm run prepare:pages
```

Expected:

```text
git status --short → no uncommitted files
npm test → 0 failures
npm run prepare:pages → exit 0
```

Request code review against `main` and fix every Critical or Important finding before merge.
