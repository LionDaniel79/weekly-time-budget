# Restraint Goals Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 기존 성장 목표를 그대로 보존하면서, 새 대분류에만 선택 가능한 절제 목표와 예산시간 가중 `목표 준수` 점수를 추가한다.

**Architecture:** 목표 방식·달성률·전체 반영 점수·진행 막대 계산을 새 순수 도메인 모듈로 분리한다. 기존 요약 도메인은 이 모듈을 호출해 성장·절제를 동일한 결과 모델로 반환하고, 대시보드·통계·시간예산·기록·타이머 UI는 공통 결과만 렌더링한다. 대분류의 `goalType`은 생성 시 한 번 저장하며 수정 경로에서는 절대 덮어쓰지 않는다.

**Tech Stack:** ES modules, Firebase 11.10.0 Auth/Firestore, IndexedDB local-first runtime, Node.js `node:test`, GitHub Pages PWA.

## Global Constraints

- 목표 방식 값은 `growth | restraint`이다.
- 기존 대분류와 잘못된 `goalType` 값은 모두 `growth`로 정규화한다.
- `절제 목표` 체크박스는 `대분류 추가`에만 표시한다.
- 생성된 목표 방식은 이후 변경할 수 없다.
- 성장 목표 이름에는 접미사를 붙이지 않고, 절제 목표만 `대분류 이름 (절제)`로 표시한다.
- 절제 예산 `B > 0`, 실제 `A <= B`: `round(200 - A / B * 100)`.
- 절제 예산 `B > 0`, 실제 `A > B`: `-max(1, round((A - B) / B * 100))`.
- 예산 0은 성장·절제 모두 달성률과 목표 준수 점수에서 제외한다.
- 전체 반영 점수는 개별 달성률을 `0..100`으로 제한한다. 절제 음수는 0점이다.
- 전체 목표 준수는 예산시간 가중 평균이며 최종 범위는 `0..100점`이다.
- 실제 기록 합계와 예산 합계는 기존처럼 양수 시간의 단순 합계다.
- 절제 막대는 예산 안에서 파란 잔여량이 100%에서 감소하고, 초과 시 파란색을 제거한 뒤 빨간 초과량이 왼쪽부터 증가한다.
- 모든 새 타이머·수동 입력·자동 저장 기록에 정규화된 `goalType`을 저장한다.
- 카운트다운·카운트업·오프라인·교차 기기 복구 동작을 변경하지 않는다.
- 서비스 워커 셸 캐시는 `weekly-time-budget-shell-v9`로 올린다.
- 새 외부 의존성을 추가하지 않는다.

---

## File Structure

- Create `src/goal-domain.js`: 목표 방식 정규화, 이름 표시, 개별 달성률, 전체 반영 점수, 목표 준수 가중 평균, 진행 막대 계산.
- Modify `src/domain.js`: 주간·월간·연간 요약에 목표 방식과 목표 준수 점수를 통합.
- Modify `src/time-budget-domain.js`: 일간 요약에도 동일한 목표 계산 결과를 사용.
- Modify `src/app.js`: 대분류 추가·수정 불변성, 공통 이름, 수동 기록 메타데이터, 기본 화면의 목표 준수 표시.
- Modify `src/category-bulk-editor.js`: 일괄 수정에서 `goalType` 보존, 절제 행 표시 보조.
- Modify `src/time-budget-ui.js`: 일간·주간 예산과 대시보드에서 공통 이름·점수·절제 막대 렌더링.
- Modify `src/statistics-ui.js`: 통계의 목표 준수 점수, 절제 막대, 상태 문구, 공통 이름.
- Modify `src/persistent-timer-ui.js`: 타이머 선택 이름, 새 타이머 기록 `goalType`, 절제 카운트다운 음수 경고색.
- Modify `src/mobile-compact.css` and `styles.css`: 절제 체크·배지·파란 잔여 막대·빨간 초과 막대 스타일.
- Modify `service-worker.js`: 새 도메인 모듈 캐시 및 v9 갱신.

---

### Task 1: 목표 계산 순수 도메인

**Files:**
- Create: `src/goal-domain.js`
- Create: `tests/goal-domain.test.js`

**Interfaces:**
- Produces: `GOAL_TYPES`, `normalizeGoalType(value)`, `categoryDisplayName(category)`, `calculateGoalAchievement(input)`, `calculateGoalContribution(achievement)`, `calculateGoalComplianceScore(items)`, `calculateGoalProgress(input)`, `resolveEntryGoalType(entry, category)`.

- [ ] **Step 1: 실패 테스트 작성**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeGoalType,
  categoryDisplayName,
  calculateGoalAchievement,
  calculateGoalContribution,
  calculateGoalComplianceScore,
  calculateGoalProgress,
  resolveEntryGoalType,
} from '../src/goal-domain.js';

test('기존 목표 방식은 성장으로 정규화한다', () => {
  assert.equal(normalizeGoalType(undefined), 'growth');
  assert.equal(normalizeGoalType('other'), 'growth');
  assert.equal(normalizeGoalType('restraint'), 'restraint');
});

test('절제 목표만 이름에 접미사를 붙인다', () => {
  assert.equal(categoryDisplayName({ name: '기도' }), '기도');
  assert.equal(categoryDisplayName({ name: '스마트폰', goalType: 'restraint' }), '스마트폰 (절제)');
  assert.equal(categoryDisplayName({ name: '스마트폰 (절제)', goalType: 'restraint' }), '스마트폰 (절제)');
});

test('절제 3시간 예산은 0·1·2·3·4·5·6시간을 엄격하게 계산한다', () => {
  const percentages = [0, 60, 120, 180, 240, 300, 360].map((actualMinutes) => (
    calculateGoalAchievement({ goalType: 'restraint', budgetMinutes: 180, actualMinutes }).percentage
  ));
  assert.deepEqual(percentages, [200, 167, 133, 100, -33, -67, -100]);
});

test('절제 목표는 조금이라도 넘으면 즉시 음수다', () => {
  assert.equal(calculateGoalAchievement({ goalType: 'restraint', budgetMinutes: 180, actualMinutes: 180.01 }).percentage, -1);
});

test('전체 반영 점수는 100 초과를 제한하고 음수를 0으로 만든다', () => {
  assert.equal(calculateGoalContribution({ hasBudget: true, percentage: 167 }), 100);
  assert.equal(calculateGoalContribution({ hasBudget: true, percentage: 50 }), 50);
  assert.equal(calculateGoalContribution({ hasBudget: true, percentage: -33 }), 0);
  assert.equal(calculateGoalContribution({ hasBudget: false, percentage: null }), null);
});
```

- [ ] **Step 2: 실패 확인**

Run: `node --test tests/goal-domain.test.js`

Expected: FAIL with `ERR_MODULE_NOT_FOUND`.

- [ ] **Step 3: 최소 구현 작성**

```js
export const GOAL_TYPES = Object.freeze({
  GROWTH: 'growth',
  RESTRAINT: 'restraint',
});

const nonNegative = (value) => Math.max(0, Number(value) || 0);
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

export function normalizeGoalType(value) {
  return value === GOAL_TYPES.RESTRAINT ? GOAL_TYPES.RESTRAINT : GOAL_TYPES.GROWTH;
}

export function categoryDisplayName(category = {}) {
  const name = String(category.name || '').trim();
  if (normalizeGoalType(category.goalType) !== GOAL_TYPES.RESTRAINT) return name;
  return /\s*\(절제\)$/.test(name) ? name : `${name} (절제)`;
}

export function calculateGoalAchievement({ goalType, budgetMinutes, actualMinutes }) {
  const normalizedGoalType = normalizeGoalType(goalType);
  const budget = nonNegative(budgetMinutes);
  const actual = nonNegative(actualMinutes);
  if (budget <= 0) {
    return {
      goalType: normalizedGoalType,
      percentage: null,
      differenceMinutes: actual,
      status: 'excluded',
      hasBudget: false,
    };
  }
  const differenceMinutes = actual - budget;
  if (normalizedGoalType === GOAL_TYPES.RESTRAINT) {
    if (actual > budget) {
      return {
        goalType: normalizedGoalType,
        percentage: -Math.max(1, Math.round((actual - budget) / budget * 100)),
        differenceMinutes,
        status: 'overage',
        hasBudget: true,
      };
    }
    return {
      goalType: normalizedGoalType,
      percentage: Math.round(200 - actual / budget * 100),
      differenceMinutes,
      status: actual === budget ? 'exact' : 'remaining',
      hasBudget: true,
    };
  }
  return {
    goalType: normalizedGoalType,
    percentage: Math.round(actual / budget * 100),
    differenceMinutes,
    status: differenceMinutes > 0 ? 'exceeded' : differenceMinutes === 0 ? 'exact' : 'remaining',
    hasBudget: true,
  };
}

export function calculateGoalContribution(achievement) {
  if (!achievement?.hasBudget || achievement.percentage === null) return null;
  return clamp(Number(achievement.percentage) || 0, 0, 100);
}
```

- [ ] **Step 4: 가중 평균·진행 막대·기록 우선순위 테스트 추가**

```js
test('예산시간으로 가중한 목표 준수 점수를 계산한다', () => {
  const score = calculateGoalComplianceScore([
    { budgetMinutes: 180, hasBudget: true, percentage: 100 },
    { budgetMinutes: 60, hasBudget: true, percentage: 100 },
    { budgetMinutes: 180, hasBudget: true, percentage: -33 },
  ]);
  assert.deepEqual(score, {
    score: 57,
    weightedTotal: 24000,
    totalWeightMinutes: 420,
    status: 'scored',
  });
});

test('예산 0 항목은 가중치와 분모에서 제외한다', () => {
  assert.equal(calculateGoalComplianceScore([
    { budgetMinutes: 180, hasBudget: true, percentage: 50 },
    { budgetMinutes: 0, hasBudget: false, percentage: null },
  ]).score, 50);
});

test('절제 막대는 파란 잔여량 뒤 빨간 초과량으로 전환한다', () => {
  assert.deepEqual(calculateGoalProgress({ goalType: 'restraint', budgetMinutes: 180, actualMinutes: 0 }), { mode: 'remaining', fillPercentage: 100 });
  assert.deepEqual(calculateGoalProgress({ goalType: 'restraint', budgetMinutes: 180, actualMinutes: 60 }), { mode: 'remaining', fillPercentage: 67 });
  assert.deepEqual(calculateGoalProgress({ goalType: 'restraint', budgetMinutes: 180, actualMinutes: 180 }), { mode: 'exact', fillPercentage: 0 });
  assert.deepEqual(calculateGoalProgress({ goalType: 'restraint', budgetMinutes: 180, actualMinutes: 240 }), { mode: 'overage', fillPercentage: 33 });
  assert.deepEqual(calculateGoalProgress({ goalType: 'restraint', budgetMinutes: 180, actualMinutes: 420 }), { mode: 'overage', fillPercentage: 100 });
});

test('기록 당시 방식이 현재 대분류보다 우선한다', () => {
  assert.equal(resolveEntryGoalType({ goalType: 'restraint' }, { goalType: 'growth' }), 'restraint');
  assert.equal(resolveEntryGoalType({}, { goalType: 'restraint' }), 'restraint');
  assert.equal(resolveEntryGoalType({}, null), 'growth');
});
```

- [ ] **Step 5: 나머지 구현 작성**

```js
export function calculateGoalComplianceScore(items = []) {
  let weightedTotal = 0;
  let totalWeightMinutes = 0;
  for (const item of items) {
    const weight = nonNegative(item?.budgetMinutes);
    const contribution = calculateGoalContribution(item);
    if (!weight || contribution === null) continue;
    weightedTotal += contribution * weight;
    totalWeightMinutes += weight;
  }
  if (!totalWeightMinutes) return { score: null, weightedTotal: 0, totalWeightMinutes: 0, status: 'excluded' };
  return {
    score: clamp(Math.round(weightedTotal / totalWeightMinutes), 0, 100),
    weightedTotal,
    totalWeightMinutes,
    status: 'scored',
  };
}

export function calculateGoalProgress({ goalType, budgetMinutes, actualMinutes }) {
  const type = normalizeGoalType(goalType);
  const budget = nonNegative(budgetMinutes);
  const actual = nonNegative(actualMinutes);
  if (!budget) return { mode: 'excluded', fillPercentage: 0 };
  if (type === GOAL_TYPES.GROWTH) {
    return { mode: 'growth', fillPercentage: Math.round(clamp(actual / budget * 100, 0, 100)) };
  }
  if (actual < budget) {
    return { mode: 'remaining', fillPercentage: Math.round((budget - actual) / budget * 100) };
  }
  if (actual === budget) return { mode: 'exact', fillPercentage: 0 };
  return { mode: 'overage', fillPercentage: Math.round(clamp((actual - budget) / budget * 100, 0, 100)) };
}

export function resolveEntryGoalType(entry, category) {
  return normalizeGoalType(entry?.goalType ?? category?.goalType);
}
```

- [ ] **Step 6: 테스트와 커밋**

Run: `node --test tests/goal-domain.test.js`

Expected: PASS.

```bash
git add src/goal-domain.js tests/goal-domain.test.js
git commit -m "feat: add growth and restraint goal calculations"
```

---

### Task 2: 주간·일간·월간 요약에 목표 계산 통합

**Files:**
- Modify: `src/domain.js`
- Modify: `src/time-budget-domain.js`
- Modify: `tests/domain.test.js`
- Modify: `tests/time-budget-domain.test.js`

**Interfaces:**
- Consumes: all exports from `src/goal-domain.js`.
- Produces: every summary item with `goalType`, `name`, `percentage`, `differenceMinutes`, `status`, `hasBudget`, `contributionScore`, `progress`; every period summary with `goalComplianceScore`, `goalComplianceStatus`.

- [ ] **Step 1: 실패 테스트 작성**

```js
test('주간 요약은 성장과 절제를 다르게 계산하고 예산시간 가중 점수를 반환한다', () => {
  const summary = summarizeBudgetPeriod(
    [
      { categoryId: 'prayer', date: '2026-07-27', durationMinutes: 180, goalType: 'growth' },
      { categoryId: 'reading', date: '2026-07-27', durationMinutes: 60, goalType: 'growth' },
      { categoryId: 'phone', date: '2026-07-27', durationMinutes: 240, goalType: 'restraint' },
    ],
    [
      { id: 'prayer', name: '기도', goalType: 'growth', defaultBudgetMinutes: 180 },
      { id: 'reading', name: '독서', goalType: 'growth', defaultBudgetMinutes: 60 },
      { id: 'phone', name: '스마트폰', goalType: 'restraint', defaultBudgetMinutes: 180 },
    ],
    [{ weekStart: '2026-07-27', budgets: { prayer: 180, reading: 60, phone: 180 } }],
    '2026-07-27',
    '2026-08-02',
  );
  const phone = summary.categorySummaries.find((item) => item.id === 'phone');
  assert.equal(phone.name, '스마트폰 (절제)');
  assert.equal(phone.percentage, -33);
  assert.equal(phone.contributionScore, 0);
  assert.equal(phone.progress.mode, 'overage');
  assert.equal(summary.goalComplianceScore, 57);
});
```

- [ ] **Step 2: 실패 확인**

Run: `node --test tests/domain.test.js tests/time-budget-domain.test.js --test-name-pattern="성장과 절제|목표 준수"`

Expected: FAIL because goal fields are absent.

- [ ] **Step 3: `domain.js` 요약 통합**

Replace the old budget-only achievement helper with a shared builder:

```js
import {
  calculateGoalAchievement,
  calculateGoalComplianceScore,
  calculateGoalContribution,
  calculateGoalProgress,
  categoryDisplayName,
  normalizeGoalType,
} from './goal-domain.js';

function categoryGoalSummary(category, budgetMinutes, actualMinutes) {
  const goalType = normalizeGoalType(category?.goalType);
  const achievement = calculateGoalAchievement({ goalType, budgetMinutes, actualMinutes });
  return {
    goalType,
    name: categoryDisplayName(category),
    ...achievement,
    contributionScore: calculateGoalContribution(achievement),
    progress: calculateGoalProgress({ goalType, budgetMinutes, actualMinutes }),
  };
}
```

In `summarizeCategories` and `finalizeBudgetSummary`, merge `categoryGoalSummary(...)` instead of `calculateAchievement(...)` or `calculateBudgetAchievement(...)`.

After category summaries are complete:

```js
const compliance = calculateGoalComplianceScore(categorySummaries);
return {
  totalBudgetMinutes,
  totalActualMinutes,
  goalComplianceScore: compliance.score,
  goalComplianceStatus: compliance.status,
  percentage: compliance.score,
  ...existingPeriodFields,
  categorySummaries,
};
```

Keep `percentage` as a compatibility alias during this change so comparison code does not break before Task 6.

- [ ] **Step 4: 삭제 대분류의 기록 방식 보존**

For categories missing from `categoryById`, derive the deleted category goal type from its entries:

```js
const deletedEntries = filteredEntries.filter((entry) => entry.categoryId === categoryId);
const goalType = normalizeGoalType(deletedEntries.find((entry) => entry.goalType)?.goalType);
const achievement = calculateGoalAchievement({ goalType, budgetMinutes: 0, actualMinutes });
categorySummaries.push({
  id: categoryId,
  name: '삭제된 대분류',
  budgetMinutes: 0,
  actualMinutes: Math.round(actualMinutes),
  goalType,
  ...achievement,
  contributionScore: null,
  progress: { mode: 'excluded', fillPercentage: 0 },
});
```

- [ ] **Step 5: `time-budget-domain.js` 일간 요약 통합**

Use the same goal helpers inside `summarizeDailyCategories`:

```js
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
  progress: calculateGoalProgress({ goalType, budgetMinutes: budget.minutes, actualMinutes }),
};
```

Return `goalComplianceScore` and `goalComplianceStatus` from the daily summary using `calculateGoalComplianceScore(categorySummaries)`.

- [ ] **Step 6: 회귀 테스트 실행 및 커밋**

Run: `node --test tests/domain.test.js tests/time-budget-domain.test.js tests/countdown-timer-domain.test.js`

Expected: PASS. Existing total budget and total actual minute assertions remain unchanged.

```bash
git add src/domain.js src/time-budget-domain.js tests/domain.test.js tests/time-budget-domain.test.js
git commit -m "feat: summarize restraint goals across budget periods"
```

---

### Task 3: 대분류 추가에서만 절제 선택 및 수정 불변성

**Files:**
- Modify: `src/app.js`
- Modify: `src/category-bulk-editor.js`
- Create: `tests/restraint-category-management.test.js`

**Interfaces:**
- Consumes: `normalizeGoalType`, `categoryDisplayName`.
- Produces: creation payload with immutable `goalType`; edit payloads that omit `goalType`.

- [ ] **Step 1: 정적 계약 실패 테스트 작성**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('절제 체크박스는 대분류 추가 폼에만 있다', async () => {
  const source = await read('src/app.js');
  const addStart = source.indexOf('function renderCategories');
  const addEnd = source.indexOf('function formatClock', addStart);
  const categoriesSource = source.slice(addStart, addEnd);
  assert.ok(categoriesSource.includes('name="restraint"'));
  assert.ok(categoriesSource.includes('절제 목표'));
  assert.doesNotMatch(categoriesSource, /category-edit-row[\s\S]*name="restraint"/);
});

test('기존 대분류 수정과 일괄 저장은 goalType을 쓰지 않는다', async () => {
  const [app, bulk] = await Promise.all([read('src/app.js'), read('src/category-bulk-editor.js')]);
  assert.match(app, /if \(id\)[\s\S]*setDoc[\s\S]*name:[\s\S]*defaultBudgetMinutes:[\s\S]*order:/);
  assert.doesNotMatch(bulk, /goalType\s*:/);
});
```

- [ ] **Step 2: 실패 확인**

Run: `node --test tests/restraint-category-management.test.js`

Expected: FAIL because add-only restraint control is absent.

- [ ] **Step 3: `saveCategory` 생성·수정 경로 분리**

```js
async function saveCategory({ id, name, defaultBudgetMinutes: budget, goalType }) {
  const trimmedName = String(name || '').trim();
  if (!trimmedName) throw new Error('대분류 이름을 입력하세요.');
  const existing = state.categories.find((category) => category.id === id);
  const basePayload = {
    name: trimmedName,
    defaultBudgetMinutes: Number(budget) || 0,
    order: existing?.order || state.categories.length + 1,
  };
  const collectionRef = firebase.collection(db, 'users', state.user.uid, 'categories');
  if (id) {
    await firebase.setDoc(firebase.doc(collectionRef, id), basePayload, { merge: true });
  } else {
    await firebase.addDoc(collectionRef, {
      ...basePayload,
      goalType: normalizeGoalType(goalType),
    });
  }
  await loadData();
  renderAll();
}
```

- [ ] **Step 4: 추가 폼에만 체크박스 연결**

```html
<label class="restraint-goal-option">
  <input name="restraint" type="checkbox">
  <span><strong>절제 목표</strong><small>설정한 예산시간 이하로 사용하는 것이 목표입니다.</small></span>
</label>
```

Submit mapping:

```js
await saveCategory({
  name: data.get('name'),
  defaultBudgetMinutes: Number(data.get('hours')) * 60,
  goalType: data.get('restraint') === 'on' ? 'restraint' : 'growth',
});
```

Registered edit rows keep raw `category.name` in the text input and append a non-editable suffix outside the input:

```js
${normalizeGoalType(category.goalType) === 'restraint'
  ? '<span class="goal-type-label">(절제)</span>'
  : ''}
```

- [ ] **Step 5: 일괄 저장 보존 테스트와 UI 테스트 통과**

Run: `node --test tests/restraint-category-management.test.js tests/category-save-copy.test.js tests/category-bulk-order.test.js`

Expected: PASS.

- [ ] **Step 6: 커밋**

```bash
git add src/app.js src/category-bulk-editor.js tests/restraint-category-management.test.js
git commit -m "feat: select restraint goals only when creating categories"
```

---

### Task 4: 공통 이름 표시와 모든 새 기록의 목표 방식 스냅샷

**Files:**
- Modify: `src/app.js`
- Modify: `src/persistent-timer-ui.js`
- Modify: `src/time-budget-ui.js`
- Modify: `tests/restraint-category-management.test.js`
- Create: `tests/restraint-entry-metadata.test.js`

**Interfaces:**
- Consumes: `categoryDisplayName`, `normalizeGoalType`.
- Produces: all option/row labels with `(절제)` and every new entry with `goalType`.

- [ ] **Step 1: 실패 테스트 작성**

```js
test('앱의 선택·예산·기록 화면은 공통 이름 함수를 사용한다', async () => {
  const source = await read('src/app.js');
  assert.ok(source.includes('categoryDisplayName(category)'));
  assert.match(source, /optionHtml[\s\S]*categoryDisplayName/);
  assert.match(source, /renderBudget[\s\S]*categoryDisplayName/);
  assert.match(source, /renderHistory[\s\S]*categoryDisplayName/);
});

test('모든 새 기록은 goalType을 저장한다', async () => {
  const [app, timer] = await Promise.all([read('src/app.js'), read('src/persistent-timer-ui.js')]);
  assert.match(app, /saveEntry\(entry[\s\S]*goalType/);
  assert.match(timer, /source: 'timer'[\s\S]*goalType:/);
});
```

- [ ] **Step 2: `app.js` 공통 이름 적용**

Add imports:

```js
import { categoryDisplayName, normalizeGoalType } from './goal-domain.js';
```

Update options:

```js
const optionHtml = (selectedId = '') => state.categories
  .map((category) => `<option value="${category.id}" ${category.id === selectedId ? 'selected' : ''}>${escapeHtml(categoryDisplayName(category))}</option>`)
  .join('');
```

Use `categoryDisplayName(category)` for budget rows, history rows, and read-only category labels. Keep edit input values as raw `category.name`.

- [ ] **Step 3: `saveEntry`에서 목표 방식 강제 주입**

```js
async function saveEntry(entry, options = {}) {
  const category = state.categories.find((item) => item.id === entry.categoryId);
  const normalizedEntry = {
    ...entry,
    goalType: normalizeGoalType(entry.goalType ?? category?.goalType),
  };
  // pass normalizedEntry to repository.saveEntryLocalFirst
}
```

This catches both manual input modes and any remaining legacy in-page timer path.

- [ ] **Step 4: 영속 타이머 기록과 선택 이름 적용**

In `src/persistent-timer-ui.js`:

```js
import { categoryDisplayName, normalizeGoalType } from './goal-domain.js';
```

Use `categoryDisplayName(category)` in `categoryOptions(...)`.

Inside `saveActiveTimer` completion payload:

```js
const category = knownCategory(timer.categoryId);
return {
  ...existingEntryFields,
  timerMode: timer.mode,
  goalType: normalizeGoalType(category?.goalType),
};
```

- [ ] **Step 5: 시간예산 이름 적용**

Import `categoryDisplayName` into `src/time-budget-ui.js` and replace both `category.name` display sites and their aria labels with the formatted name.

- [ ] **Step 6: 테스트와 커밋**

Run: `node --test tests/restraint-category-management.test.js tests/restraint-entry-metadata.test.js tests/countdown-timer-ui.test.js tests/manual-entry.test.js`

Expected: PASS.

```bash
git add src/app.js src/persistent-timer-ui.js src/time-budget-ui.js tests/restraint-category-management.test.js tests/restraint-entry-metadata.test.js
git commit -m "feat: label restraint categories and snapshot entry goal types"
```

---

### Task 5: 대시보드 목표 준수와 절제 진행 막대

**Files:**
- Modify: `src/time-budget-ui.js`
- Modify: `src/app.js`
- Modify: `styles.css`
- Modify: `src/mobile-compact.css`
- Create: `tests/restraint-dashboard-ui.test.js`

**Interfaces:**
- Consumes: summary `goalComplianceScore`, item `progress`, `goalType`, `status`, `percentage`.
- Produces: `목표 준수 N점`, blue remaining bars, empty exact bar, red overage bars.

- [ ] **Step 1: UI 계약 실패 테스트 작성**

```js
test('대시보드는 전체 달성률 대신 목표 준수 점수를 표시한다', async () => {
  const source = await read('src/time-budget-ui.js');
  assert.ok(source.includes('목표 준수'));
  assert.ok(source.includes('goalComplianceScore'));
  assert.ok(source.includes('점'));
  assert.ok(!source.includes('<p class="muted">전체 달성률</p>'));
});

test('절제 진행 막대는 remaining과 overage 클래스를 분리한다', async () => {
  const [ui, css] = await Promise.all([read('src/time-budget-ui.js'), read('styles.css')]);
  assert.ok(ui.includes('restraint-progress'));
  assert.ok(ui.includes('restraint-remaining'));
  assert.ok(ui.includes('restraint-overage'));
  assert.ok(css.includes('.restraint-progress.restraint-remaining'));
  assert.ok(css.includes('.restraint-progress.restraint-overage'));
});
```

- [ ] **Step 2: 공통 렌더 헬퍼 작성**

Inside `src/time-budget-ui.js`:

```js
const goalScoreText = (summary) => summary?.goalComplianceStatus === 'excluded'
  ? '계산 제외'
  : `${summary?.goalComplianceScore ?? 0}점`;

function categoryProgressHtml(item) {
  const progress = item.progress || { mode: 'growth', fillPercentage: 0 };
  const className = progress.mode === 'remaining'
    ? 'restraint-progress restraint-remaining'
    : progress.mode === 'overage'
      ? 'restraint-progress restraint-overage'
      : progress.mode === 'exact' || progress.mode === 'excluded'
        ? 'restraint-progress restraint-exact'
        : 'growth-progress';
  return `<div class="progress ${className}"><span style="width:${progress.fillPercentage}%"></span></div>`;
}
```

Status copy:

```js
function categoryGoalDetail(item) {
  if (!item.hasBudget) return '달성률 계산 제외';
  if (item.goalType === 'restraint') {
    if (item.status === 'overage') return `${formatMinutes(item.differenceMinutes)} 초과 사용`;
    if (item.status === 'exact') return '예산 소진';
    return `${formatMinutes(Math.abs(item.differenceMinutes))} 남음`;
  }
  if (item.differenceMinutes > 0) return `${formatMinutes(item.differenceMinutes)} 초과 달성`;
  if (item.differenceMinutes < 0) return `${formatMinutes(Math.abs(item.differenceMinutes))} 남음`;
  return '예산과 일치';
}
```

- [ ] **Step 3: 요약 카드·대분류 행 변경**

```js
<article class="card">
  <p class="muted">목표 준수</p>
  <div class="metric">${goalScoreText(summary)}</div>
</article>
```

Each category row uses `categoryProgressHtml(item)`, `${item.percentage}%` when budget exists, and `categoryGoalDetail(item)`.

Update the legacy `renderDashboard()` in `src/app.js` to use the same summary fields so no cached/early render briefly shows the old `전체 달성률` card.

- [ ] **Step 4: 스타일 작성**

```css
.progress.restraint-progress > span { transition: width .2s ease; }
.progress.restraint-remaining > span { background: #2f6fb2; }
.progress.restraint-overage > span { background: #c23b36; }
.progress.restraint-exact > span { width: 0 !important; }
.goal-type-label { color: #8d3d35; font-weight: 800; white-space: nowrap; }
.restraint-goal-option { display:flex; gap:10px; align-items:flex-start; }
.restraint-goal-option input { width:auto; margin-top:3px; }
.restraint-goal-option span { display:grid; gap:3px; }
.restraint-goal-option small { color:#68736e; font-weight:400; }
```

- [ ] **Step 5: 수치 예시 렌더 테스트**

Add assertions that a summary with phone 1/3 hours renders blue 67%, 167%, and 100-point overall; phone 4/3 hours renders red 33%, -33%, and 57-point overall.

- [ ] **Step 6: 테스트와 커밋**

Run: `node --test tests/restraint-dashboard-ui.test.js tests/time-budget-ui.test.js tests/recorded-period-navigation-integration.test.js`

Expected: PASS.

```bash
git add src/time-budget-ui.js src/app.js styles.css src/mobile-compact.css tests/restraint-dashboard-ui.test.js
git commit -m "feat: show weighted goal compliance and restraint progress"
```

---

### Task 6: 통계 화면의 성장·절제 의미 반영

**Files:**
- Modify: `src/statistics-ui.js`
- Modify: `tests/statistics-ui.test.js`
- Create: `tests/restraint-statistics-ui.test.js`

**Interfaces:**
- Consumes: period summary goal fields from Task 2.
- Produces: all weekly/monthly/yearly statistics using `목표 준수 N점` and goal-aware category progress/copy.

- [ ] **Step 1: 실패 테스트 작성**

```js
test('통계 요약은 전체 달성률 대신 목표 준수를 표시한다', async () => {
  const source = await read('src/statistics-ui.js');
  assert.ok(source.includes('목표 준수'));
  assert.ok(source.includes('goalComplianceScore'));
  assert.ok(!source.includes('<p class="muted">전체 달성률</p>'));
});

test('절제 통계는 파란 잔여·빨간 초과 막대와 계산 제외 문구를 지원한다', async () => {
  const source = await read('src/statistics-ui.js');
  assert.ok(source.includes('restraint-remaining'));
  assert.ok(source.includes('restraint-overage'));
  assert.ok(source.includes('달성률 계산 제외'));
  assert.ok(source.includes('초과 사용'));
});
```

- [ ] **Step 2: 통계 헬퍼 교체**

```js
function overallAchievementText(summary) {
  return summary.goalComplianceStatus === 'excluded'
    ? '계산 제외'
    : `${summary.goalComplianceScore ?? 0}점`;
}

function achievementText(item) {
  if (!item.hasBudget) return '달성률 계산 제외';
  return `${item.percentage}%`;
}

function achievementWidth(item) {
  return Number(item.progress?.fillPercentage) || 0;
}

function achievementBarClass(item) {
  if (item.progress?.mode === 'remaining') return 'restraint-remaining';
  if (item.progress?.mode === 'overage') return 'restraint-overage';
  if (item.progress?.mode === 'exact') return 'restraint-exact';
  if (item.progress?.mode === 'excluded') return 'unbudgeted';
  return item.status === 'exceeded' ? 'over' : '';
}
```

`differenceText` must distinguish restraint:

```js
if (!item.hasBudget) return '달성률 계산 제외';
if (item.goalType === 'restraint') {
  if (item.status === 'overage') return `${formatMinutes(item.differenceMinutes)} 초과 사용`;
  if (item.status === 'exact') return '예산 소진';
  return `${formatMinutes(Math.abs(item.differenceMinutes))} 남음`;
}
```

- [ ] **Step 3: 표·비교·행렬 용어 변경**

- Summary card label: `목표 준수`.
- Category table explanation: growth 100% is budget achievement; restraint 100% is budget exact use, above 100% is remaining allowance, negative is overage.
- Comparison rows and detailed table label: `목표 준수` and unit `점`.
- Category names already arrive formatted from domain summaries; matrix headers use `categoryDisplayName(category)` for active/archived source categories.

- [ ] **Step 4: 통계 스타일 적용**

In injected CSS:

```css
.stat-bar-fill.restraint-remaining{background:#2f6fb2}
.stat-bar-fill.restraint-overage{background:#c23b36}
.stat-bar-fill.restraint-exact{width:0!important}
.difference.overage{color:#b3261e}
```

- [ ] **Step 5: 통계 회귀 테스트 실행**

Run: `node --test tests/restraint-statistics-ui.test.js tests/statistics-ui.test.js tests/statistics-offline-rescue.test.js tests/statistics-monthly-timer-resume-regression.test.js`

Expected: PASS. Week/month/year navigation remains unchanged.

- [ ] **Step 6: 커밋**

```bash
git add src/statistics-ui.js tests/statistics-ui.test.js tests/restraint-statistics-ui.test.js
git commit -m "feat: apply restraint goals to statistics"
```

---

### Task 7: 타이머 절제 표시와 기록 메타데이터 회귀 보호

**Files:**
- Modify: `src/persistent-timer-ui.js`
- Modify: `src/mobile-compact.css`
- Modify: `tests/countdown-timer-ui.test.js`
- Modify: `tests/restraint-entry-metadata.test.js`

**Interfaces:**
- Consumes: selected category `goalType` and `categoryDisplayName`.
- Produces: restraint countdown negative display with red semantic class; saved entry goal metadata.

- [ ] **Step 1: 실패 테스트 작성**

```js
test('절제 카운트다운 음수는 초과 사용 경고 클래스를 사용한다', async () => {
  const source = await read('src/persistent-timer-ui.js');
  assert.ok(source.includes('is-restraint-overage'));
  assert.ok(source.includes("goalType === 'restraint'"));
});
```

- [ ] **Step 2: 렌더 상태 계산**

```js
const activeCategory = knownCategory(timer?.categoryId || selectedId);
const goalType = normalizeGoalType(activeCategory?.goalType);
const isRestraintOverage = mode === 'countdown' && goalType === 'restraint' && displayMs < 0;
```

Timer class:

```js
class="timer${isNegative ? ' is-negative' : ''}${isRestraintOverage ? ' is-restraint-overage' : ''}"
```

Optional inline copy below the number:

```js
${isRestraintOverage ? '<p class="timer-goal-note restraint-overage-copy">초과 사용시간</p>' : ''}
```

Do not add alerts, audio, vibration, or auto-stop.

- [ ] **Step 3: 스타일 작성**

```css
.timer.is-restraint-overage,
.restraint-overage-copy { color:#b3261e; }
.timer-goal-note { margin:4px 0 0; text-align:center; font-weight:800; }
```

- [ ] **Step 4: 전체 타이머 회귀 실행**

Run: `node --test tests/countdown-timer-ui.test.js tests/persistent-timer.test.js tests/persistent-timer-cross-device.test.js tests/statistics-monthly-timer-resume-regression.test.js tests/restraint-entry-metadata.test.js`

Expected: PASS with no changes to timer duration, pause, recovery, or mode defaults.

- [ ] **Step 5: 커밋**

```bash
git add src/persistent-timer-ui.js src/mobile-compact.css tests/countdown-timer-ui.test.js tests/restraint-entry-metadata.test.js
git commit -m "feat: mark restraint timer overage and preserve goal metadata"
```

---

### Task 8: PWA 캐시, Pages 산출물, 전체 검증

**Files:**
- Modify: `service-worker.js`
- Modify: `tests/offline-app-integration.test.js`
- Modify: `tests/recorded-period-pages.test.js`
- Modify: `tests/category-save-copy.test.js`

**Interfaces:**
- Consumes: `src/goal-domain.js` and all modified UI modules.
- Produces: v9 offline app shell and deployable Pages artifact.

- [ ] **Step 1: 실패 테스트 작성**

```js
test('절제 목표 도메인과 v9 앱 셸을 배포한다', async () => {
  const worker = await read('service-worker.js');
  assert.ok(worker.includes("weekly-time-budget-shell-v9"));
  assert.ok(worker.includes('./src/goal-domain.js'));
});
```

Pages test:

```js
await access(path.join(outputDir, 'src', 'goal-domain.js'));
assert.ok(serviceWorker.includes('weekly-time-budget-shell-v9'));
assert.ok(serviceWorker.includes('./src/goal-domain.js'));
```

- [ ] **Step 2: 서비스 워커 갱신**

```js
const SHELL_CACHE = 'weekly-time-budget-shell-v9';
```

Add `./src/goal-domain.js` to `SHELL_URLS` before modules that import it.

- [ ] **Step 3: 전체 테스트 실행**

Run: `npm test`

Expected: all existing and new tests PASS.

- [ ] **Step 4: 문법 검사**

```bash
node --check src/goal-domain.js
node --check src/domain.js
node --check src/time-budget-domain.js
node --check src/app.js
node --check src/category-bulk-editor.js
node --check src/time-budget-ui.js
node --check src/statistics-ui.js
node --check src/persistent-timer-ui.js
node --check service-worker.js
```

Expected: all commands exit 0.

- [ ] **Step 5: Pages 산출물 검사**

```bash
npm run prepare:pages
test -f _site/src/goal-domain.js
test -f _site/service-worker.js
grep -q "weekly-time-budget-shell-v9" _site/service-worker.js
grep -q "./src/goal-domain.js" _site/service-worker.js
```

Expected: all commands exit 0.

- [ ] **Step 6: 최종 요구사항 검사**

Verify in the final diff and tests:

- existing and invalid goal types normalize to growth;
- restraint checkbox exists only in category-add form;
- edit and bulk-save payloads never write `goalType`;
- restraint name appears in dashboard, timer, manual input, budget, history, statistics, and category management;
- all new entries carry `goalType`;
- restraint values for 3-hour budget are exactly `200, 167, 133, 100, -33, -67, -100`;
- 3 hours plus any positive fraction becomes negative;
- budget 0 is excluded from individual and overall scores;
- overall score uses budget minutes as weights;
- phone 1 hour example is 100 points, phone 4 hours example is 57 points;
- restraint negative contributes 0, never subtracts another category score;
- blue bar starts full and decreases; exact budget is empty; red overage restarts from the left;
- actual and budget time totals remain simple positive sums;
- timer countup/countdown and offline recovery tests remain green;
- service worker uses v9 only;
- no unrelated refactor or dependency is included.

- [ ] **Step 7: 최종 커밋과 PR 준비**

```bash
git add -A
git commit -m "feat: add immutable restraint goals"
```

PR body must explicitly state:

```markdown
- 기존 대분류와 goalType 없는 데이터: growth
- 절제 선택 위치: 대분류 추가 폼만
- 목표 방식 변경: 생성 후 불가
- 전체 목표 준수: 예산시간 가중, 0~100점
- 절제 음수의 전체 반영: 해당 항목 0점, 다른 목표 점수 차감 없음
- 절제 막대: 파란 잔여량 감소 → 빈 막대 → 빨간 초과량 증가
```
