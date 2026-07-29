# Category Effective Date Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 새 대분류를 추가한 현지 날짜부터만 대시보드·예산·기록·통계에 반영하고, 기존 대분류는 과거·오늘·미래에 계속 활성 상태로 유지한다.

**Architecture:** 날짜 유효성·대분류 활성 여부·기록 유효 여부를 `src/category-effective-date.js`의 순수 함수로 분리한다. 일간·주간·월간·연간 집계는 날짜별로 이 함수를 적용하며, 입력 UI는 목록 필터와 저장 직전 검증을 모두 수행한다. `createdDate`는 새 대분류 생성 시 한 번 저장하고 수정·일괄 저장·보관·복원 과정에서는 원래 값을 보존한다.

**Tech Stack:** ES modules, Firebase 11.10.0 Auth/Firestore, IndexedDB local-first runtime, Node.js `node:test`, GitHub Pages PWA.

## Global Constraints

- 새 대분류 문서만 `createdDate: YYYY-MM-DD`를 가진다.
- `createdDate`는 사용자의 현지 날짜를 `toDateKey(new Date())`로 저장한다.
- `createdDate`가 없거나 형식이 잘못된 기존 대분류는 모든 날짜에서 활성이다.
- 유효한 `createdDate`가 있는 대분류는 그 날짜부터 활성이고 이전 날짜에는 존재하지 않았던 항목처럼 처리한다.
- 성장 목표와 절제 목표에 동일한 생성일 규칙을 적용한다.
- 생성일 이전에는 대분류 행, 예산, 실제 기록, 분야 수, 달성률, 목표 준수 점수의 분자·분모에서 모두 제외한다.
- 주중에 추가한 대분류의 주간 예산은 기존 요일 배분 중 생성일부터 일요일까지의 몫만 합산한다.
- 남은 날짜에 주간 예산 전체를 재분배하지 않는다.
- 수동 입력은 생성일 이전 날짜의 대분류 선택을 숨기고 저장 직전에도 차단한다.
- 타이머는 시작일 현재 활성인 대분류만 새로 시작할 수 있다.
- 시작 당시 유효했던 활성 타이머의 복구·일시정지·저장 동작은 변경하지 않는다.
- 생성일 이전에 비정상적으로 저장된 기록은 대시보드·통계·기록 내역에서 숨긴다.
- 대분류 수정·순서 변경·일괄 저장은 `createdDate`를 덮어쓰지 않는다.
- 보관과 복원은 최초 `createdDate`를 그대로 보존한다.
- 온라인·오프라인 렌더러가 같은 도메인 함수를 사용한다.
- 기록이 있는 날짜·주·월만 이동하는 기존 탐색 규칙은 변경하지 않는다.
- 새 외부 의존성을 추가하지 않는다.
- 서비스 워커 셸 캐시는 `weekly-time-budget-shell-v10`으로 올린다.

## File Structure

- Create `src/category-effective-date.js`: 날짜 정규화, 날짜·기간 활성 여부, 기록 유효 여부, 날짜별 대분류 필터.
- Modify `src/app.js`: 새 대분류 생성일 저장, 수동 입력·기존 타이머 목록 필터와 저장 검증.
- Modify `src/category-bulk-editor.js`: 일괄 저장이 이름·예산·순서만 병합한다는 회귀 계약 유지.
- Modify `src/category-ui-patch.js`: 보관·복원 시 생성일 보존, 생성일 이전 비정상 기록 숨김.
- Modify `src/time-budget-domain.js`: 일간 예산·카운트다운 기준·일간 요약에 생성일 적용.
- Modify `src/domain.js`: 주간·월간·연간 예산과 통계에 날짜별 생성일 적용.
- Modify `src/time-budget-feature.js`: 기간 대분류 선택, 현재 예산 편집 목록, 주간 요약에 공통 집계 사용.
- Modify `src/time-budget-ui.js`: 이미 필터된 모델만 렌더링하는 계약 검증.
- Modify `src/persistent-timer-ui.js`: 현재 활성 대분류만 새 타이머에 표시하고 시작 직전 재검증.
- Modify `src/statistics-ui.js`: 공통 집계 결과의 비활성 대분류를 다시 추가하지 않는 계약 검증.
- Modify `src/statistics-offline-rescue.js`: 오프라인 캐시에서도 동일한 공통 집계 사용.
- Modify `service-worker.js`: 새 모듈 캐시와 셸 v10.
- Modify `.github/workflows/ci.yml`: Pages 산출물에 새 모듈이 포함되는지 검사.

---

### Task 1: 대분류 생성일 순수 도메인

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

test('생성일이 없는 기존 대분류는 모든 날짜에서 활성이다', () => {
  const category = { id: 'legacy', name: '기도' };
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
  assert.equal(normalizeCategoryCreatedDate({ createdDate: '2026-02-30' }), null);
  assert.equal(isCategoryActiveOnDate({ createdDate: '2026-02-30' }, '2026-01-01'), true);
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

test('날짜별 활성 대분류 필터는 원래 순서를 유지한다', () => {
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

Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `src/category-effective-date.js`.

- [ ] **Step 3: 최소 구현 작성**

```js
const DATE_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function localDateKey(date) {
  const pad = (value) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

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

- [ ] **Step 4: 테스트 통과 확인**

Run: `node --test tests/category-effective-date.test.js`

Expected: 7 tests PASS.

- [ ] **Step 5: 전체 회귀 테스트**

Run: `npm test`

Expected: PASS with no failures.

- [ ] **Step 6: 커밋**

```bash
git add src/category-effective-date.js tests/category-effective-date.test.js
git commit -m "feat: add category effective date domain"
```

---

### Task 2: 생성일 저장과 생명주기 보존

**Files:**
- Modify: `src/app.js` in `saveCategory()` and `renderCategories()`
- Modify: `src/category-ui-patch.js` in `restoreCategory()`
- Verify: `src/category-bulk-editor.js` in `applyAllCategories()`
- Create: `tests/category-effective-date-persistence.test.js`

**Interfaces:**
- Consumes: `toDateKey(date)` from `src/domain.js`
- Consumes: `normalizeDateKey(value)` from `src/category-effective-date.js`
- Produces: new category documents with immutable `createdDate`

- [ ] **Step 1: 실패하는 저장 계약 테스트 작성**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const appSource = await readFile(new URL('../src/app.js', import.meta.url), 'utf8');
const lifecycleSource = await readFile(new URL('../src/category-ui-patch.js', import.meta.url), 'utf8');
const bulkSource = await readFile(new URL('../src/category-bulk-editor.js', import.meta.url), 'utf8');

test('새 대분류 생성에만 현지 createdDate를 저장한다', () => {
  assert.match(appSource, /createdDate:\s*toDateKey\(new Date\(\)\)/);
  const updateBranch = appSource.match(/if \(id\)[\s\S]*?else await firebase\.addDoc[\s\S]*?;/)?.[0] || '';
  assert.doesNotMatch(updateBranch.split('else')[0], /createdDate/);
});

test('대분류 수정 화면은 생성일 입력을 노출하지 않는다', () => {
  const renderBlock = appSource.match(/function renderCategories\(\)[\s\S]*?\n}/)?.[0] || '';
  assert.doesNotMatch(renderBlock, /name=["']createdDate["']/);
  assert.doesNotMatch(renderBlock, /생성일/);
});

test('일괄 저장은 createdDate를 덮어쓰지 않는다', () => {
  const batchPayload = bulkSource.match(/batch\.set\([\s\S]*?\{ merge: true \}/)?.[0] || '';
  assert.doesNotMatch(batchPayload, /createdDate/);
});

test('복원은 보관된 createdDate가 있을 때만 그대로 기록한다', () => {
  assert.match(lifecycleSource, /data\.createdDate !== undefined/);
  assert.match(lifecycleSource, /createdDate:\s*data\.createdDate/);
});
```

- [ ] **Step 2: 실패 확인**

Run: `node --test tests/category-effective-date-persistence.test.js`

Expected: FAIL because `saveCategory()` does not save `createdDate` and `restoreCategory()` drops it.

- [ ] **Step 3: 새 대분류 생성에만 생성일 저장**

Change `saveCategory()` so the update path remains unchanged and the create path writes the local date.

```js
const collectionRef = firebase.collection(db, 'users', state.user.uid, 'categories');
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

Do not add a creation-date input to `renderCategories()`.

- [ ] **Step 4: 복원에서 원래 생성일 보존**

Replace the restore payload with a conditional spread so legacy categories remain fieldless.

```js
batch.set(storeModule.doc(db, 'users', user.uid, 'categories', categoryId), {
  name: data.name,
  defaultBudgetMinutes: Number(data.defaultBudgetMinutes ?? data.budgetMinutes ?? 0),
  order: data.order || 999,
  goalType: normalizeGoalType(data.goalType),
  ...(data.createdDate !== undefined ? { createdDate: data.createdDate } : {}),
});
```

The archive path already spreads `snapshot.data()` and therefore preserves `createdDate`; keep that behavior.

- [ ] **Step 5: 계약 테스트와 전체 테스트 통과 확인**

Run: `node --test tests/category-effective-date-persistence.test.js && npm test`

Expected: PASS with no failures.

- [ ] **Step 6: 커밋**

```bash
git add src/app.js src/category-ui-patch.js tests/category-effective-date-persistence.test.js
git commit -m "feat: persist category created date"
```

---

### Task 3: 일간 예산·카운트다운·일간 요약

**Files:**
- Modify: `src/time-budget-domain.js`
- Modify: `tests/time-budget-domain.test.js`

**Interfaces:**
- Consumes: `isCategoryActiveOnDate(category, dateKey)`
- Produces: `resolveDailyBudget()` with `source: 'inactive'` and zero minutes before creation
- Produces: `resolveCountdownBudgetBaseline()` returning `null` before creation
- Produces: `summarizeDailyCategories()` omitting inactive categories and invalid pre-creation records

- [ ] **Step 1: 실패 테스트 추가**

Append to `tests/time-budget-domain.test.js`:

```js
test('생성일 이전 일간 예산은 비활성 0분이다', () => {
  assert.deepEqual(resolveDailyBudget({
    category: { id: 'phone', createdDate: '2026-07-29', defaultBudgetMinutes: 420 },
    date: '2026-07-28',
    weekDocument: null,
    dailyDocument: null,
  }), { minutes: 0, source: 'inactive' });
});

test('생성일 이전에는 카운트다운 기준을 만들지 않는다', () => {
  assert.equal(resolveCountdownBudgetBaseline({
    category: { id: 'phone', createdDate: '2026-07-29', defaultBudgetMinutes: 420 },
    date: '2026-07-28',
    entries: [],
    weekDocument: null,
    dailyDocument: null,
  }), null);
});

test('일간 요약은 생성일 이전 대분류와 비정상 기록을 완전히 제외한다', () => {
  const summary = summarizeDailyCategories({
    categories: [
      { id: 'legacy', name: '기도', defaultBudgetMinutes: 420 },
      { id: 'phone', name: '스마트폰', createdDate: '2026-07-29', defaultBudgetMinutes: 420 },
    ],
    entries: [
      { categoryId: 'legacy', date: '2026-07-28', durationMinutes: 60 },
      { categoryId: 'phone', date: '2026-07-28', durationMinutes: 300 },
    ],
    date: '2026-07-28',
    weekDocument: null,
    dailyDocument: null,
  });
  assert.deepEqual(summary.categorySummaries.map((item) => item.id), ['legacy']);
  assert.equal(summary.totalActualMinutes, 60);
});

test('생성일부터 일간 요약에 포함한다', () => {
  const summary = summarizeDailyCategories({
    categories: [{ id: 'phone', name: '스마트폰', createdDate: '2026-07-29', defaultBudgetMinutes: 420 }],
    entries: [{ categoryId: 'phone', date: '2026-07-29', durationMinutes: 60 }],
    date: '2026-07-29',
    weekDocument: null,
    dailyDocument: null,
  });
  assert.deepEqual(summary.categorySummaries.map((item) => item.id), ['phone']);
  assert.equal(summary.totalActualMinutes, 60);
});
```

- [ ] **Step 2: 실패 확인**

Run: `node --test tests/time-budget-domain.test.js`

Expected: FAIL because inactive categories still receive a daily budget and appear in the summary.

- [ ] **Step 3: 일간 예산과 카운트다운 경계 구현**

Add the import:

```js
import { isCategoryActiveOnDate } from './category-effective-date.js';
```

At the beginning of `resolveDailyBudget()`:

```js
if (!isCategoryActiveOnDate(category, date)) {
  return { minutes: 0, source: 'inactive' };
}
```

At the beginning of `resolveCountdownBudgetBaseline()`:

```js
if (!isCategoryActiveOnDate(category, date)) return null;
```

- [ ] **Step 4: 일간 요약에서 목록과 기록을 함께 필터링**

Use only active categories and only records whose category is active on the selected date.

```js
const activeCategories = categories.filter((category) => isCategoryActiveOnDate(category, date));
const categoryById = new Map(activeCategories.map((category) => [category.id, category]));
const relevant = entries.filter((entry) => (
  entry.date === date
  && categoryById.has(entry.categoryId)
  && isCategoryActiveOnDate(categoryById.get(entry.categoryId), entry.date)
));
const categorySummaries = activeCategories.map((category) => {
  // existing budget, actual, achievement and progress calculation
});
```

- [ ] **Step 5: 테스트 통과 확인**

Run: `node --test tests/time-budget-domain.test.js && npm test`

Expected: PASS with no failures.

- [ ] **Step 6: 커밋**

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
- Produces: all budget-period summaries with partial creation-week budgets and no pre-creation rows

- [ ] **Step 1: 생성 주 부분 예산 실패 테스트 작성**

Append to `tests/domain.test.js`:

```js
test('목요일 생성 대분류의 동일 배분 주간 예산은 목요일부터 4일분만 반영한다', () => {
  const summary = summarizeWeeklyBudgetPeriod(
    [],
    [{ id: 'phone', name: '스마트폰', createdDate: '2026-07-30', defaultBudgetMinutes: 420 }],
    [{
      id: '2026-07-27',
      weekStart: '2026-07-27',
      budgets: { phone: 420 },
      dayWeights: { mon: 1, tue: 1, wed: 1, thu: 1, fri: 1, sat: 1, sun: 1 },
    }],
    '2026-07-27',
  );
  assert.equal(summary.totalBudgetMinutes, 240);
  assert.equal(summary.categorySummaries[0].budgetMinutes, 240);
});

test('생성일이 기간 종료일 뒤면 대분류 행 자체가 없다', () => {
  const summary = summarizeBudgetPeriod(
    [],
    [{ id: 'phone', name: '스마트폰', createdDate: '2026-07-29', defaultBudgetMinutes: 420 }],
    [],
    '2026-07-01',
    '2026-07-28',
  );
  assert.deepEqual(summary.categorySummaries, []);
  assert.equal(summary.totalBudgetMinutes, 0);
});

test('월간 집계는 생성일부터 월말까지의 예산만 합산한다', () => {
  const summary = summarizeBudgetPeriod(
    [],
    [{ id: 'phone', name: '스마트폰', createdDate: '2026-07-29', defaultBudgetMinutes: 420 }],
    [],
    '2026-07-01',
    '2026-07-31',
  );
  assert.equal(summary.categorySummaries.length, 1);
  assert.equal(summary.totalBudgetMinutes, 180);
});

test('생성일 이전 비정상 기록은 기간 실제 합계에서 제외한다', () => {
  const summary = summarizeBudgetPeriod(
    [
      { categoryId: 'phone', date: '2026-07-28', durationMinutes: 300 },
      { categoryId: 'phone', date: '2026-07-29', durationMinutes: 60 },
    ],
    [{ id: 'phone', name: '스마트폰', createdDate: '2026-07-29', defaultBudgetMinutes: 420 }],
    [],
    '2026-07-01',
    '2026-07-31',
  );
  assert.equal(summary.totalActualMinutes, 60);
});
```

The 7-hour weekly budget is 60 minutes per equally weighted day; July 29–31 contains three active days and therefore 180 minutes.

- [ ] **Step 2: 실패 확인**

Run: `node --test tests/domain.test.js`

Expected: FAIL because the full weekly budget is applied to dates before creation and inactive categories remain in summaries.

- [ ] **Step 3: 날짜별 예산 차단 구현**

Add imports:

```js
import {
  isCategoryActiveInRange,
  isCategoryActiveOnDate,
  isEntryWithinCategoryEffectiveDate,
} from './category-effective-date.js';
```

Update `effectiveWeeklyBudget()` before archive and override handling:

```js
if (!isCategoryActiveOnDate(category, dateKey)) return 0;
```

Filter the sorted list at the start of `summarizeBudgetRange()`:

```js
const categoryList = sortedCategories(categories)
  .filter((category) => isCategoryActiveInRange(category, start, end));
```

- [ ] **Step 4: 실제 기록을 생성일 기준으로 방어 필터링**

In `finalizeBudgetSummary()` replace the initial entry filter with:

```js
const filteredEntries = (entries || []).filter((entry) => {
  if (!isDateKey(entry.date) || entry.date < start || entry.date > end) return false;
  const category = categoryById.get(entry.categoryId);
  return isEntryWithinCategoryEffectiveDate(entry, category);
});
```

Unknown or permanently deleted categories have no creation metadata and remain visible, preserving old records.

- [ ] **Step 5: 연간 결합에서 현재 대분류 전체를 미리 넣지 않기**

Change `combineBudgetSummaries()` to start with an empty map and add only rows returned by represented monthly summaries.

```js
const categoryById = new Map(sortedCategories(categories).map((category) => [category.id, category]));
const totals = new Map();

summaries.forEach((summary) => {
  summary.categorySummaries.forEach((item) => {
    const category = categoryById.get(item.id) || item;
    const current = totals.get(item.id) || {
      id: item.id,
      name: category.name || item.name,
      goalType: normalizeGoalType(category.goalType ?? item.goalType),
      budgetMinutes: 0,
      actualMinutes: 0,
    };
    current.budgetMinutes += Number(item.budgetMinutes) || 0;
    current.actualMinutes += Number(item.actualMinutes) || 0;
    totals.set(item.id, current);
  });
});
```

This prevents a category created in July from appearing as a zero row in January–June or in a previous year.

- [ ] **Step 6: 기간 페이지 회귀 테스트 추가**

Append to `tests/recorded-period-pages.test.js` a source contract that monthly and yearly pages still call the shared budget summarizers:

```js
test('통계 화면은 생성일 적용 공통 기간 요약을 사용한다', async () => {
  const source = await readFile(new URL('../src/statistics-ui.js', import.meta.url), 'utf8');
  assert.match(source, /summarizeWeeklyBudgetPeriod/);
  assert.match(source, /summarizeRecordedMonthlyBudgetPeriod/);
  assert.match(source, /summarizeRecordedYearlyBudgetPeriod/);
});
```

- [ ] **Step 7: 테스트 통과 확인**

Run: `node --test tests/domain.test.js tests/recorded-period-pages.test.js && npm test`

Expected: PASS with no failures.

- [ ] **Step 8: 커밋**

```bash
git add src/domain.js tests/domain.test.js tests/recorded-period-pages.test.js
git commit -m "feat: apply category date to period summaries"
```

---

### Task 5: 대시보드와 시간 예산 모델 필터링

**Files:**
- Modify: `src/time-budget-feature.js`
- Verify: `src/time-budget-ui.js`
- Modify: `tests/time-budget-ui.test.js`
- Create: `tests/category-effective-date-feature.test.js`

**Interfaces:**
- Consumes: `filterCategoriesActiveOnDate()`, `isCategoryActiveInRange()`
- Consumes: `summarizeWeeklyBudgetPeriod()` from `src/domain.js`
- Produces: date-aware dashboard and current-date budget editing models

- [ ] **Step 1: 실패하는 기능 계약 테스트 작성**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../src/time-budget-feature.js', import.meta.url), 'utf8');

test('시간 예산 기능은 날짜별 활성 함수를 사용한다', () => {
  assert.match(source, /filterCategoriesActiveOnDate/);
  assert.match(source, /isCategoryActiveInRange/);
});

test('주간 대시보드는 날짜별 기간 요약을 사용한다', () => {
  assert.match(source, /summarizeWeeklyBudgetPeriod/);
  const weeklyBlock = source.match(/function weeklySummary\([\s\S]*?\n}/)?.[0] || '';
  assert.doesNotMatch(weeklyBlock, /summarizeCategories\(/);
});

test('현재 주간 스냅숏에는 오늘 활성인 대분류만 새로 채운다', () => {
  const snapshotBlock = source.match(/async function ensureCurrentWeekSnapshot\([\s\S]*?\n}/)?.[0] || '';
  assert.match(snapshotBlock, /activeCategories\(today\(\)\)/);
});
```

- [ ] **Step 2: 실패 확인**

Run: `node --test tests/category-effective-date-feature.test.js`

Expected: FAIL because `activeCategories()` returns every current category and weekly summary uses `summarizeCategories()` with a full-week budget.

- [ ] **Step 3: 날짜별 활성 대분류 도우미 연결**

Update imports:

```js
import {
  filterCategoriesActiveOnDate,
  isCategoryActiveInRange,
} from './category-effective-date.js';
import {
  getWeekRange,
  moveWeekStart,
  summarizeWeeklyBudgetPeriod,
  toDateKey,
} from './domain.js';
```

Replace the helper:

```js
const activeCategories = (date = today()) => filterCategoriesActiveOnDate(state.categories, date);
```

Use `activeCategories(today())` in `ensureCurrentWeekSnapshot()` when filling missing current-week budgets.

- [ ] **Step 4: 기간 대분류 선택에서 생성일 적용**

At the start of the `allKnownCategories()` chain in `periodCategories()` add:

```js
.filter((category) => isCategoryActiveInRange(category, start, end))
```

Keep the existing active, budget, override, and entry-reference conditions after this filter so archived historical categories still appear only in valid periods.

- [ ] **Step 5: 주간 요약을 날짜별 공통 집계로 교체**

Replace `weeklySummary()` with:

```js
function weeklySummary(key) {
  const range = weekRange(key);
  const week = normalizeWeek(key);
  const categories = periodCategories({ start: range.start, end: range.end, weekDocument: week });
  return summarizeWeeklyBudgetPeriod(state.entries, categories, state.weekly, key);
}
```

This is the required path for partial creation-week budgets; do not calculate `percentage` manually.

- [ ] **Step 6: 시간 예산 화면에는 오늘 활성인 대분류만 전달**

Where the budget model is built, pass:

```js
categories: activeCategories(state.budget.today),
```

The UI renderer continues to map `model.categories`; no creation-date condition belongs in `src/time-budget-ui.js`.

- [ ] **Step 7: UI 단위 테스트 추가**

Append to `tests/time-budget-ui.test.js`:

```js
test('시간 예산 UI는 모델에 전달된 대분류만 렌더링한다', () => {
  const html = renderTimeBudgetHtml({
    mode: 'today',
    today: '2026-07-29',
    categories: [{ id: 'today', name: '오늘 추가' }],
    weekDocument: null,
    dailyDocument: null,
    defaultDayWeights: EQUAL_DAY_WEIGHTS,
    emptyHtml: '',
  });
  assert.match(html, /오늘 추가/);
  assert.doesNotMatch(html, /어제 추가 전/);
});
```

- [ ] **Step 8: 테스트 통과 확인**

Run: `node --test tests/category-effective-date-feature.test.js tests/time-budget-ui.test.js && npm test`

Expected: PASS with no failures.

- [ ] **Step 9: 커밋**

```bash
git add src/time-budget-feature.js tests/category-effective-date-feature.test.js tests/time-budget-ui.test.js
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
- Produces: date-aware manual options and save guard
- Produces: current-date timer options and start guard

- [ ] **Step 1: 실패하는 입력 계약 테스트 작성**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const appSource = await readFile(new URL('../src/app.js', import.meta.url), 'utf8');
const timerSource = await readFile(new URL('../src/persistent-timer-ui.js', import.meta.url), 'utf8');

test('수동 입력은 날짜 변경 때 대분류 선택지를 갱신한다', () => {
  assert.match(appSource, /refreshManualCategoryOptions/);
  assert.match(appSource, /manual-date[^\n]*addEventListener\(['"]change['"]/);
});

test('수동 저장은 생성일 이전 날짜를 명시적으로 차단한다', () => {
  assert.match(appSource, /이 대분류는 추가일 이전 날짜에 기록할 수 없습니다\./);
  assert.match(appSource, /isCategoryActiveOnDate\(category, date\)/);
});

test('새 타이머 목록과 시작은 현재 날짜 활성 여부를 검사한다', () => {
  assert.match(timerSource, /filterCategoriesActiveOnDate/);
  assert.match(timerSource, /isCategoryActiveOnDate\(category, startedDate\)/);
});
```

- [ ] **Step 2: 실패 확인**

Run: `node --test tests/category-effective-date-input.test.js`

Expected: FAIL because input lists are not date-aware and no save/start guard exists.

- [ ] **Step 3: 수동 입력용 옵션 함수 구현**

Import:

```js
import {
  filterCategoriesActiveOnDate,
  isCategoryActiveOnDate,
} from './category-effective-date.js';
```

Replace the global option mapper with a date-aware variant:

```js
const categoryOptionHtml = ({ date, selectedId = '' }) => filterCategoriesActiveOnDate(state.categories, date)
  .map((category) => `<option value="${category.id}" ${category.id === selectedId ? 'selected' : ''}>${escapeHtml(categoryDisplayName(category))}</option>`)
  .join('');
```

Use today's date for timer options and the current manual date for manual options.

- [ ] **Step 4: 날짜 변경 시 수동 선택 목록 갱신**

Add:

```js
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

In `bindManual()`:

```js
$('#manual-date')?.addEventListener('change', refreshManualCategoryOptions);
```

The date input remains editable before the category input; either interaction order is supported.

- [ ] **Step 5: 수동 저장 직전 재검증**

After category and date presence checks:

```js
const category = state.categories.find((item) => item.id === categoryId);
if (!category || !isCategoryActiveOnDate(category, date)) {
  alert('이 대분류는 추가일 이전 날짜에 기록할 수 없습니다.');
  refreshManualCategoryOptions();
  return;
}
```

- [ ] **Step 6: 기존 단순 타이머도 현재 날짜로 필터링**

Use `categoryOptionHtml({ date: toDateKey(new Date()), selectedId })` in the fallback timer form. Before starting, find the category and call `isCategoryActiveOnDate(category, toDateKey(new Date()))`; show the same alert when invalid.

- [ ] **Step 7: 영구 타이머 UI 필터와 시작 가드**

Import:

```js
import {
  filterCategoriesActiveOnDate,
  isCategoryActiveOnDate,
} from './category-effective-date.js';
```

In `categoryOptions()`:

```js
const date = localDateKey(new Date());
const activeCategories = filterCategoriesActiveOnDate(state.categories, date);
const options = activeCategories.map((category) => /* existing option HTML */);
```

Keep the existing selected active/recovered timer option insertion so a legitimate timer remains recoverable.

In `handleAction()` immediately after `startedDate`:

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

- [ ] **Step 8: 카운트다운 회귀 테스트 보강**

Append to `tests/countdown-timer-ui.test.js`:

```js
test('생성일 검증은 기존 타이머 복구 경로를 제거하지 않는다', async () => {
  const source = await readFile(new URL('../src/persistent-timer-ui.js', import.meta.url), 'utf8');
  assert.match(source, /controller\.recover\(\)/);
  assert.match(source, /selectedId && !state\.categories\.some/);
  assert.match(source, /isCategoryActiveOnDate\(category, startedDate\)/);
});
```

- [ ] **Step 9: 테스트 통과 확인**

Run: `node --test tests/category-effective-date-input.test.js tests/countdown-timer-ui.test.js && npm test`

Expected: PASS with no timer pause, recovery, countdown, or countup regressions.

- [ ] **Step 10: 커밋**

```bash
git add src/app.js src/persistent-timer-ui.js tests/category-effective-date-input.test.js tests/countdown-timer-ui.test.js
git commit -m "feat: guard entries before category date"
```

---

### Task 7: 기록 내역과 온라인·오프라인 통계 일치

**Files:**
- Modify: `src/category-ui-patch.js`
- Verify: `src/statistics-ui.js`
- Verify: `src/statistics-offline-rescue.js`
- Create: `tests/category-effective-date-history.test.js`
- Modify: `tests/statistics-offline-rescue.test.js`
- Modify: `tests/restraint-ui-integration.test.js`

**Interfaces:**
- Consumes: `isEntryWithinCategoryEffectiveDate()`
- Consumes: date-aware period summaries from `src/domain.js`
- Produces: history and statistics with no pre-creation rows or minutes

- [ ] **Step 1: 기록 내역 실패 테스트 작성**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../src/category-ui-patch.js', import.meta.url), 'utf8');

test('기록 내역은 대분류 생성일 도메인으로 비정상 기록을 거른다', () => {
  assert.match(source, /isEntryWithinCategoryEffectiveDate/);
  assert.match(source, /entriesSnapshot\.docs[\s\S]*?\.filter\(/);
});

test('기록 건수는 필터링된 기록 수를 사용한다', () => {
  assert.match(source, /최근 기록[\s\S]*?\$\{entries\.length\}건/);
});
```

- [ ] **Step 2: 실패 확인**

Run: `node --test tests/category-effective-date-history.test.js`

Expected: FAIL because `patchHistoryView()` renders every server entry.

- [ ] **Step 3: 기록 내역 필터 구현**

Import:

```js
import { isEntryWithinCategoryEffectiveDate } from './category-effective-date.js';
```

After building active and archived maps:

```js
const categoryById = new Map([...archivedCategories, ...activeCategories]);
const entries = entriesSnapshot.docs
  .map((docSnapshot) => ({ id: docSnapshot.id, ...docSnapshot.data() }))
  .filter((entry) => isEntryWithinCategoryEffectiveDate(entry, categoryById.get(entry.categoryId)));
```

Because the map contains active and archived categories, archive state does not change creation-date behavior. Permanently deleted categories remain visible because their creation date is unknowable.

- [ ] **Step 4: 통계 공통 집계 계약 테스트**

Append to `tests/statistics-offline-rescue.test.js`:

```js
test('오프라인 통계도 공통 날짜별 기간 요약을 사용한다', async () => {
  const source = await readFile(new URL('../src/statistics-offline-rescue.js', import.meta.url), 'utf8');
  assert.match(source, /summarizeWeeklyBudgetPeriod/);
  assert.match(source, /summarizeRecordedMonthlyBudgetPeriod/);
  assert.match(source, /summarizeRecordedYearlyBudgetPeriod/);
  assert.doesNotMatch(source, /createdDate\s*[<>]=?/);
});
```

Append to `tests/restraint-ui-integration.test.js`:

```js
test('온라인 통계는 요약에 없는 현재 대분류를 새 행으로 만들지 않는다', async () => {
  const source = await readFile(new URL('../src/statistics-ui.js', import.meta.url), 'utf8');
  const visibleBlock = source.match(/function visibleCategorySummaries\([\s\S]*?\n}/)?.[0] || '';
  assert.match(visibleBlock, /summary\.categorySummaries\.filter/);
  assert.doesNotMatch(visibleBlock, /statisticsState\.activeCategories\.map\([\s\S]*?categorySummaries/);
});
```

- [ ] **Step 5: 통계 렌더러 점검과 최소 수정**

Keep both statistics renderers dependent on `summary.categorySummaries`. Do not re-create rows by mapping every current category. If either renderer constructs zero rows from `activeCategories`, replace that code with filtering of the summary only:

```js
const activeIds = new Set(activeCategories.map((category) => category.id));
const rows = summary.categorySummaries.filter((item) => (
  activeIds.has(item.id) || item.budgetMinutes > 0 || item.actualMinutes > 0
));
```

A category absent from `summary.categorySummaries` must remain absent even when currently active.

- [ ] **Step 6: 테스트 통과 확인**

Run: `node --test tests/category-effective-date-history.test.js tests/statistics-offline-rescue.test.js tests/restraint-ui-integration.test.js && npm test`

Expected: PASS with online and offline statistics producing the same rows.

- [ ] **Step 7: 커밋**

```bash
git add src/category-ui-patch.js src/statistics-ui.js src/statistics-offline-rescue.js tests/category-effective-date-history.test.js tests/statistics-offline-rescue.test.js tests/restraint-ui-integration.test.js
git commit -m "feat: hide records before category date"
```

---

### Task 8: PWA 캐시, Pages 산출물, 최종 회귀 검증

**Files:**
- Modify: `service-worker.js`
- Modify: `.github/workflows/ci.yml`
- Modify: `tests/offline-app-integration.test.js`
- Modify: `tests/recorded-period-navigation-integration.test.js`

**Interfaces:**
- Consumes: `src/category-effective-date.js`
- Produces: offline-capable app shell v10

- [ ] **Step 1: 실패하는 PWA 계약 테스트 작성**

Append to `tests/offline-app-integration.test.js`:

```js
test('서비스 워커는 생성일 도메인과 v10 셸을 캐시한다', async () => {
  const source = await readFile(new URL('../service-worker.js', import.meta.url), 'utf8');
  assert.match(source, /weekly-time-budget-shell-v10/);
  assert.match(source, /\.\/src\/category-effective-date\.js/);
});
```

Append to `tests/recorded-period-navigation-integration.test.js`:

```js
test('생성일 기능은 기록 기반 기간 이동 규칙을 바꾸지 않는다', async () => {
  const dashboard = await readFile(new URL('../src/time-budget-feature.js', import.meta.url), 'utf8');
  const statistics = await readFile(new URL('../src/statistics-ui.js', import.meta.url), 'utf8');
  assert.match(dashboard, /previousRecordedDate/);
  assert.match(dashboard, /nextRecordedDateOrToday/);
  assert.match(statistics, /previousRecordedPeriod/);
});
```

- [ ] **Step 2: 실패 확인**

Run: `node --test tests/offline-app-integration.test.js tests/recorded-period-navigation-integration.test.js`

Expected: FAIL because the service worker is still v9 and does not cache the new module.

- [ ] **Step 3: 서비스 워커 갱신**

In `service-worker.js`:

```js
const SHELL_CACHE = 'weekly-time-budget-shell-v10';
```

Add immediately before `./src/goal-domain.js`:

```js
'./src/category-effective-date.js',
```

- [ ] **Step 4: Pages 파일 검사 추가**

In `.github/workflows/ci.yml`, add:

```bash
test -f _site/src/category-effective-date.js
```

next to the existing `goal-domain.js` check.

- [ ] **Step 5: 전체 테스트와 Pages 빌드 검증**

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

- [ ] **Step 6: 수동 시나리오 검증**

Run a local static server for `_site` and verify these exact scenarios with browser devtools date data or seeded test data:

```text
1. createdDate 없는 기존 대분류는 과거 일간, 오늘, 현재 주간에 모두 표시된다.
2. 오늘 만든 대분류는 어제 일간과 어제가 포함된 과거 통계에서 보이지 않는다.
3. 오늘 만든 대분류는 오늘 일간과 오늘 이후 화면에 나타난다.
4. 목요일 생성·주간 7시간·동일 요일 비율은 그 주 예산 4시간으로 표시된다.
5. 수동 입력 날짜를 생성일 전날로 바꾸면 해당 대분류 선택이 해제되고 저장이 차단된다.
6. 현재 날짜 타이머에는 새 대분류가 나타나며 정상 시작·멈춤·저장된다.
7. 보관 후 복원해도 최초 createdDate가 바뀌지 않는다.
8. 네트워크를 끈 뒤 캐시 통계에서도 동일한 기간 행과 합계가 표시된다.
```

- [ ] **Step 7: 최종 커밋**

```bash
git add service-worker.js .github/workflows/ci.yml tests/offline-app-integration.test.js tests/recorded-period-navigation-integration.test.js
git commit -m "chore: cache category effective dates"
```

- [ ] **Step 8: 브랜치 전체 검증**

Run:

```bash
git status --short
npm test
npm run prepare:pages
```

Expected:

```text
git status --short → no uncommitted files
npm test → 0 failures
npm run prepare:pages → exit 0
```

Then request code review against `main` and fix every Critical or Important finding before merge.
