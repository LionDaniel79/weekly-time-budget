# Restraint Goals Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 기존 성장 목표를 그대로 보존하면서, 새 대분류에만 선택 가능한 절제 목표와 예산시간 가중 `목표 준수` 점수를 추가한다.

**Architecture:** 목표 방식·달성률·전체 반영 점수·진행 막대 계산을 `src/goal-domain.js`의 순수 함수로 분리한다. 기존 일간·주간·월간·연간 요약은 이 모듈을 호출하여 동일한 결과 모델을 반환하고, 온라인·오프라인 UI는 그 결과만 렌더링한다. `goalType`은 대분류 생성 시 한 번 저장하며 수정·일괄 수정·보관·복원 경로에서는 값을 보존한다.

**Tech Stack:** ES modules, Firebase 11.10.0 Auth/Firestore, IndexedDB local-first runtime, Node.js `node:test`, GitHub Pages PWA.

## Global Constraints

- 목표 방식 값은 `growth | restraint`이다.
- 기존 대분류, 기존 기록, 잘못된 값은 모두 `growth`로 정규화한다.
- `절제 목표` 체크박스는 `대분류 추가` 폼에만 표시한다.
- 대분류 수정 화면에는 목표 방식 입력을 제공하지 않는다.
- 생성한 목표 방식은 보관·복원 후에도 바뀌지 않는다.
- 성장 이름은 그대로, 절제 이름은 렌더링 시에만 `이름 (절제)`로 표시한다.
- 절제 예산 `B > 0`, 실제 `A <= B`: `round(200 - A / B * 100)`.
- 절제 예산 `B > 0`, 실제 `A > B`: `-max(1, round((A - B) / B * 100))`.
- 예산 0은 성장·절제 모두 달성률과 목표 준수 계산에서 제외한다.
- 전체 반영 점수는 개별 달성률을 `0..100`으로 제한한다. 절제 음수는 0점이다.
- 전체 목표 준수는 예산시간 가중 평균이며 최종 범위는 `0..100점`이다.
- 실제 기록 합계와 예산 합계는 목표 방식과 관계없이 양수 시간의 단순 합계다.
- 절제 막대는 예산 안에서 파란 잔여량이 100%에서 감소하고, 정확히 소진하면 빈 막대가 되며, 초과 시 빨간 초과량이 왼쪽부터 증가한다.
- 모든 새 수동 입력·타이머·자동 저장 기록에 정규화된 `goalType`을 저장한다.
- 카운트다운·카운트업·일시정지·오프라인·교차 기기 복구 동작을 변경하지 않는다.
- 서비스 워커 셸 캐시는 `weekly-time-budget-shell-v9`로 올린다.
- 새 외부 의존성을 추가하지 않는다.

## File Structure

- Create `src/goal-domain.js`: 목표 정규화, 표시 이름, 개별 달성률, 전체 반영 점수, 목표 준수, 진행 막대.
- Modify `src/domain.js`: 주간·월간·연간 요약에 목표 결과 통합.
- Modify `src/time-budget-domain.js`: 일간 요약에 목표 결과 통합.
- Modify `src/app.js`: 생성 전용 절제 선택, 수정 불변성, 공통 이름, 수동 기록 메타데이터, 초기 대시보드.
- Modify `src/category-bulk-editor.js`: 일괄 수정에서 목표 방식 보존.
- Modify `src/category-ui-patch.js`: 보관·복원 시 `goalType` 보존, 보관 목록·기록 내역 이름 표시.
- Modify `src/time-budget-ui.js`: 시간예산과 일간·주간 대시보드.
- Modify `src/statistics-ui.js`: 온라인 통계.
- Modify `src/statistics-offline-rescue.js`: 기기 캐시 기반 오프라인 통계.
- Modify `src/persistent-timer-ui.js`: 타이머 이름, 기록 스냅샷, 절제 초과 표시.
- Modify `styles.css`, `src/mobile-compact.css`: 체크박스·배지·파란 잔여·빨간 초과 스타일.
- Modify `service-worker.js`: 새 모듈과 v9 앱 셸.

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
  assert.equal(normalizeGoalType('invalid'), 'growth');
  assert.equal(normalizeGoalType('restraint'), 'restraint');
});

test('절제 목표만 이름에 접미사를 한 번 붙인다', () => {
  assert.equal(categoryDisplayName({ name: '기도' }), '기도');
  assert.equal(categoryDisplayName({ name: '스마트폰', goalType: 'restraint' }), '스마트폰 (절제)');
  assert.equal(categoryDisplayName({ name: '스마트폰 (절제)', goalType: 'restraint' }), '스마트폰 (절제)');
});

test('절제 3시간 예산은 엄격한 달성률을 계산한다', () => {
  const actuals = [0, 60, 120, 180, 240, 300, 360];
  assert.deepEqual(actuals.map((actualMinutes) => calculateGoalAchievement({
    goalType: 'restraint', budgetMinutes: 180, actualMinutes,
  }).percentage), [200, 167, 133, 100, -33, -67, -100]);
});

test('절제는 아주 조금만 넘겨도 즉시 음수다', () => {
  assert.equal(calculateGoalAchievement({ goalType: 'restraint', budgetMinutes: 180, actualMinutes: 180.01 }).percentage, -1);
});
```

- [ ] **Step 2: 실패 확인**

Run: `node --test tests/goal-domain.test.js`

Expected: FAIL with `ERR_MODULE_NOT_FOUND`.

- [ ] **Step 3: 최소 구현 작성**

```js
export const GOAL_TYPES = Object.freeze({ GROWTH: 'growth', RESTRAINT: 'restraint' });
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
  const type = normalizeGoalType(goalType);
  const budget = nonNegative(budgetMinutes);
  const actual = nonNegative(actualMinutes);
  if (!budget) return { goalType: type, percentage: null, differenceMinutes: actual, status: 'excluded', hasBudget: false };
  const differenceMinutes = actual - budget;
  if (type === GOAL_TYPES.RESTRAINT) {
    if (actual > budget) return {
      goalType: type,
      percentage: -Math.max(1, Math.round((actual - budget) / budget * 100)),
      differenceMinutes,
      status: 'overage',
      hasBudget: true,
    };
    return {
      goalType: type,
      percentage: Math.round(200 - actual / budget * 100),
      differenceMinutes,
      status: actual === budget ? 'exact' : 'remaining',
      hasBudget: true,
    };
  }
  return {
    goalType: type,
    percentage: Math.round(actual / budget * 100),
    differenceMinutes,
    status: differenceMinutes > 0 ? 'exceeded' : differenceMinutes === 0 ? 'exact' : 'remaining',
    hasBudget: true,
  };
}
```

- [ ] **Step 4: 가중 평균·진행 막대·기록 우선순위 테스트 추가**

```js
test('전체 반영 점수는 100 초과를 제한하고 음수를 0으로 만든다', () => {
  assert.equal(calculateGoalContribution({ hasBudget: true, percentage: 167 }), 100);
  assert.equal(calculateGoalContribution({ hasBudget: true, percentage: 50 }), 50);
  assert.equal(calculateGoalContribution({ hasBudget: true, percentage: -33 }), 0);
  assert.equal(calculateGoalContribution({ hasBudget: false, percentage: null }), null);
});

test('예산시간으로 목표 준수를 가중 계산한다', () => {
  assert.deepEqual(calculateGoalComplianceScore([
    { budgetMinutes: 180, hasBudget: true, percentage: 100 },
    { budgetMinutes: 60, hasBudget: true, percentage: 100 },
    { budgetMinutes: 180, hasBudget: true, percentage: -33 },
  ]), { score: 57, weightedTotal: 24000, totalWeightMinutes: 420, status: 'scored' });
});

test('예산 0은 가중치와 분모에서 제외한다', () => {
  assert.equal(calculateGoalComplianceScore([
    { budgetMinutes: 180, hasBudget: true, percentage: 50 },
    { budgetMinutes: 0, hasBudget: false, percentage: null },
  ]).score, 50);
});

test('절제 막대는 파란 잔여 뒤 빨간 초과로 전환한다', () => {
  assert.deepEqual(calculateGoalProgress({ goalType: 'restraint', budgetMinutes: 180, actualMinutes: 0 }), { mode: 'remaining', fillPercentage: 100 });
  assert.deepEqual(calculateGoalProgress({ goalType: 'restraint', budgetMinutes: 180, actualMinutes: 60 }), { mode: 'remaining', fillPercentage: 67 });
  assert.deepEqual(calculateGoalProgress({ goalType: 'restraint', budgetMinutes: 180, actualMinutes: 180 }), { mode: 'exact', fillPercentage: 0 });
  assert.deepEqual(calculateGoalProgress({ goalType: 'restraint', budgetMinutes: 180, actualMinutes: 240 }), { mode: 'overage', fillPercentage: 33 });
  assert.deepEqual(calculateGoalProgress({ goalType: 'restraint', budgetMinutes: 180, actualMinutes: 420 }), { mode: 'overage', fillPercentage: 100 });
});

test('기록 당시 목표 방식이 현재 대분류보다 우선한다', () => {
  assert.equal(resolveEntryGoalType({ goalType: 'restraint' }, { goalType: 'growth' }), 'restraint');
  assert.equal(resolveEntryGoalType({}, { goalType: 'restraint' }), 'restraint');
  assert.equal(resolveEntryGoalType({}, null), 'growth');
});
```

- [ ] **Step 5: 나머지 함수 구현**

```js
export function calculateGoalContribution(achievement) {
  if (!achievement?.hasBudget || achievement.percentage === null) return null;
  return clamp(Number(achievement.percentage) || 0, 0, 100);
}

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
  if (type === GOAL_TYPES.GROWTH) return { mode: 'growth', fillPercentage: Math.round(clamp(actual / budget * 100, 0, 100)) };
  if (actual < budget) return { mode: 'remaining', fillPercentage: Math.round((budget - actual) / budget * 100) };
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

### Task 2: 모든 기간 요약에 목표 계산 통합

**Files:**
- Modify: `src/domain.js`
- Modify: `src/time-budget-domain.js`
- Modify: `tests/domain.test.js`
- Modify: `tests/time-budget-domain.test.js`

**Interfaces:**
- Consumes: Task 1 exports.
- Produces category summary fields: `goalType`, formatted `name`, `percentage`, `differenceMinutes`, `status`, `hasBudget`, `contributionScore`, `progress`.
- Produces period summary fields: existing time totals and period counts plus `goalComplianceScore`, `goalComplianceStatus`; `percentage` remains a temporary compatibility alias to `goalComplianceScore`.

- [ ] **Step 1: 실패 테스트 작성**

```js
test('주간 요약은 성장과 절제를 다르게 계산한다', () => {
  const summary = summarizeBudgetPeriod(
    [
      { categoryId: 'prayer', date: '2026-07-27', durationMinutes: 180, goalType: 'growth' },
      { categoryId: 'reading', date: '2026-07-27', durationMinutes: 60, goalType: 'growth' },
      { categoryId: 'phone', date: '2026-07-27', durationMinutes: 240, goalType: 'restraint' },
    ],
    [
      { id: 'prayer', name: '기도', defaultBudgetMinutes: 180 },
      { id: 'reading', name: '독서', defaultBudgetMinutes: 60 },
      { id: 'phone', name: '스마트폰', goalType: 'restraint', defaultBudgetMinutes: 180 },
    ],
    [{ weekStart: '2026-07-27', budgets: { prayer: 180, reading: 60, phone: 180 } }],
    '2026-07-27', '2026-08-02',
  );
  const phone = summary.categorySummaries.find((item) => item.id === 'phone');
  assert.equal(phone.name, '스마트폰 (절제)');
  assert.equal(phone.percentage, -33);
  assert.equal(phone.contributionScore, 0);
  assert.deepEqual(phone.progress, { mode: 'overage', fillPercentage: 33 });
  assert.equal(summary.goalComplianceScore, 57);
  assert.equal(summary.totalBudgetMinutes, 420);
  assert.equal(summary.totalActualMinutes, 480);
});
```

- [ ] **Step 2: 실패 확인**

Run: `node --test tests/domain.test.js tests/time-budget-domain.test.js --test-name-pattern="성장과 절제|목표 준수"`

Expected: FAIL because goal fields are absent.

- [ ] **Step 3: 공통 category summary builder 추가**

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

Use it in `summarizeCategories`, `finalizeBudgetSummary`, and `summarizeDailyCategories`.

- [ ] **Step 4: 기간 요약 반환값 추가**

After `categorySummaries`, `totalBudgetMinutes`, `totalActualMinutes` are computed:

```js
const compliance = calculateGoalComplianceScore(categorySummaries);
```

Preserve each function's current fields exactly:

- `summarizeCategories`: return its category array only, with enriched item fields.
- `summarizeDailyCategories`: return `totalBudgetMinutes`, `totalActualMinutes`, `goalComplianceScore`, `goalComplianceStatus`, `percentage: compliance.score`, `categorySummaries`.
- `finalizeBudgetSummary`: return `totalBudgetMinutes`, `totalActualMinutes`, `goalComplianceScore`, `goalComplianceStatus`, `percentage: compliance.score`, `differenceMinutes: totalActualMinutes - totalBudgetMinutes`, `status`, `recordDays`, `dailyAverageMinutes`, `categorySummaries`.
- monthly/yearly wrappers keep their existing `recordWeekCount`, `recordMonthCount`, comparison, and change fields.

- [ ] **Step 5: 삭제 대분류 목표 방식 처리**

For a category missing from active and archived maps, inspect its filtered entries:

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

- [ ] **Step 6: 테스트와 커밋**

Run: `node --test tests/domain.test.js tests/time-budget-domain.test.js tests/goal-domain.test.js tests/countdown-timer-domain.test.js`

Expected: PASS; time totals remain unchanged.

```bash
git add src/domain.js src/time-budget-domain.js tests/domain.test.js tests/time-budget-domain.test.js
git commit -m "feat: summarize restraint goals across all periods"
```

---

### Task 3: 생성 전용 절제 선택과 목표 방식 불변성

**Files:**
- Modify: `src/app.js`
- Modify: `src/category-bulk-editor.js`
- Modify: `src/category-ui-patch.js`
- Create: `tests/restraint-category-management.test.js`

**Interfaces:**
- Consumes: `normalizeGoalType`, `categoryDisplayName`.
- Produces: creation payload with `goalType`; edit payloads that omit it; archive/restore paths that preserve it.

- [ ] **Step 1: 실패 테스트 작성**

```js
test('절제 체크박스는 대분류 추가 폼에만 있다', async () => {
  const source = await read('src/app.js');
  const start = source.indexOf('function renderCategories');
  const end = source.indexOf('function formatClock', start);
  const block = source.slice(start, end);
  assert.ok(block.includes('name="restraint"'));
  assert.ok(block.includes('절제 목표'));
  const editRows = block.slice(block.indexOf('category-edit-row'));
  assert.ok(!editRows.includes('name="restraint"'));
});

test('수정·일괄 수정은 goalType을 쓰지 않고 보관 복원은 보존한다', async () => {
  const [app, bulk, lifecycle] = await Promise.all([
    read('src/app.js'), read('src/category-bulk-editor.js'), read('src/category-ui-patch.js'),
  ]);
  assert.doesNotMatch(bulk, /goalType\s*:/);
  assert.match(lifecycle, /archiveCategory[\s\S]*\.\.\.snapshot\.data\(\)/);
  assert.match(lifecycle, /restoreCategory[\s\S]*goalType:\s*normalizeGoalType\(data\.goalType\)/);
  assert.match(app, /if \(id\)[\s\S]*setDoc[\s\S]*basePayload/);
});
```

- [ ] **Step 2: 생성·수정 경로 분리**

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
  if (id) await firebase.setDoc(firebase.doc(collectionRef, id), basePayload, { merge: true });
  else await firebase.addDoc(collectionRef, { ...basePayload, goalType: normalizeGoalType(goalType) });
  await loadData();
  renderAll();
}
```

- [ ] **Step 3: 추가 폼에만 체크박스 연결**

```html
<label class="restraint-goal-option">
  <input name="restraint" type="checkbox">
  <span><strong>절제 목표</strong><small>설정한 예산시간 이하로 사용하는 것이 목표입니다.</small></span>
</label>
```

```js
await saveCategory({
  name: data.get('name'),
  defaultBudgetMinutes: Number(data.get('hours')) * 60,
  goalType: data.get('restraint') === 'on' ? 'restraint' : 'growth',
});
```

Edit rows keep raw `category.name` in the input and add a non-editable `(절제)` suffix outside the input.

- [ ] **Step 4: 보관·복원·보관목록 표시 수정**

Import goal helpers into `src/category-ui-patch.js`.

Restore payload:

```js
batch.set(storeModule.doc(db, 'users', user.uid, 'categories', categoryId), {
  name: data.name,
  defaultBudgetMinutes: Number(data.defaultBudgetMinutes ?? data.budgetMinutes ?? 0),
  order: data.order || 999,
  goalType: normalizeGoalType(data.goalType),
});
```

Use `categoryDisplayName({ ...data, id })` in lifecycle modal, archived list, and archive-aware history. Preserve raw name when writing documents.

- [ ] **Step 5: 테스트와 커밋**

Run: `node --test tests/restraint-category-management.test.js tests/category-save-copy.test.js tests/category-bulk-order.test.js tests/category-lifecycle.test.js`

Expected: PASS.

```bash
git add src/app.js src/category-bulk-editor.js src/category-ui-patch.js tests/restraint-category-management.test.js
git commit -m "feat: make restraint type immutable after category creation"
```

---

### Task 4: 모든 화면의 이름과 모든 새 기록의 목표 스냅샷

**Files:**
- Modify: `src/app.js`
- Modify: `src/time-budget-ui.js`
- Modify: `src/persistent-timer-ui.js`
- Modify: `src/category-ui-patch.js`
- Create: `tests/restraint-entry-metadata.test.js`

**Interfaces:**
- Consumes: `categoryDisplayName`, `normalizeGoalType`.
- Produces: `(절제)` labels across record, budget, history, timer; every new record with `goalType`.

- [ ] **Step 1: 실패 테스트 작성**

```js
test('선택·예산·기록 화면은 공통 이름 함수를 사용한다', async () => {
  const [app, budget, timer, lifecycle] = await Promise.all([
    read('src/app.js'), read('src/time-budget-ui.js'), read('src/persistent-timer-ui.js'), read('src/category-ui-patch.js'),
  ]);
  for (const source of [app, budget, timer, lifecycle]) assert.ok(source.includes('categoryDisplayName'));
});

test('모든 새 기록은 goalType을 저장한다', async () => {
  const [app, timer] = await Promise.all([read('src/app.js'), read('src/persistent-timer-ui.js')]);
  assert.match(app, /normalizedEntry[\s\S]*goalType:/);
  assert.match(timer, /source: 'timer'[\s\S]*goalType:/);
});
```

- [ ] **Step 2: `app.js` 공통 이름 적용**

```js
import { categoryDisplayName, normalizeGoalType } from './goal-domain.js';

const optionHtml = (selectedId = '') => state.categories
  .map((category) => `<option value="${category.id}" ${category.id === selectedId ? 'selected' : ''}>${escapeHtml(categoryDisplayName(category))}</option>`)
  .join('');
```

Use `categoryDisplayName` in legacy dashboard, budget, history, and registered-category read-only suffixes. Edit input values remain raw.

- [ ] **Step 3: `saveEntry`에서 목표 방식 강제 주입**

```js
const category = state.categories.find((item) => item.id === entry.categoryId);
const normalizedEntry = {
  ...entry,
  goalType: normalizeGoalType(entry.goalType ?? category?.goalType),
  createdAt: Date.now(),
};
```

Pass `normalizedEntry` to `saveEntryLocalFirst`. This covers both manual modes and the legacy in-page timer.

- [ ] **Step 4: 시간예산·영속 타이머 이름과 기록 적용**

- `src/time-budget-ui.js`: replace both category display sites and aria labels with `categoryDisplayName(category)`.
- `src/persistent-timer-ui.js`: use `categoryDisplayName(category)` in `categoryOptions`.
- `saveActiveTimer` completion payload:

```js
const category = knownCategory(timer.categoryId);
return {
  categoryId: timer.categoryId,
  note: timer.note,
  date: timer.startedDate,
  durationMinutes,
  startTime: new Date(timer.startedAt).toTimeString().slice(0, 5),
  endTime: new Date(endedAt).toTimeString().slice(0, 5),
  source: 'timer',
  timerMode: timer.mode,
  goalType: normalizeGoalType(category?.goalType),
};
```

- [ ] **Step 5: 테스트와 커밋**

Run: `node --test tests/restraint-entry-metadata.test.js tests/countdown-timer-ui.test.js tests/manual-entry.test.js tests/offline-entry-repository.test.js`

Expected: PASS.

```bash
git add src/app.js src/time-budget-ui.js src/persistent-timer-ui.js src/category-ui-patch.js tests/restraint-entry-metadata.test.js
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
- Consumes: summary `goalComplianceScore`, `goalComplianceStatus`; item `progress`, `goalType`, `status`, `percentage`.
- Produces: `목표 준수 N점`, 파란 잔여 막대, 빈 정확 소진 막대, 빨간 초과 막대.

- [ ] **Step 1: 실패 테스트 작성**

```js
test('대시보드는 전체 달성률 대신 목표 준수 점수를 표시한다', async () => {
  const source = await read('src/time-budget-ui.js');
  assert.ok(source.includes('목표 준수'));
  assert.ok(source.includes('goalComplianceScore'));
  assert.ok(!source.includes('<p class="muted">전체 달성률</p>'));
});

test('절제 막대는 remaining과 overage 클래스를 분리한다', async () => {
  const [ui, css] = await Promise.all([read('src/time-budget-ui.js'), read('styles.css')]);
  assert.ok(ui.includes('restraint-remaining'));
  assert.ok(ui.includes('restraint-overage'));
  assert.ok(css.includes('.restraint-remaining'));
  assert.ok(css.includes('.restraint-overage'));
});
```

- [ ] **Step 2: 렌더 헬퍼 작성**

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

- [ ] **Step 3: 요약 카드와 대분류 행 변경**

```html
<article class="card"><p class="muted">목표 준수</p><div class="metric">${goalScoreText(summary)}</div></article>
```

Each row uses `categoryProgressHtml(item)`, budget-aware achievement text, and `categoryGoalDetail(item)`. Update the legacy `renderDashboard()` in `src/app.js` too, so cached first paint never shows the old label.

- [ ] **Step 4: 스타일 작성**

```css
.progress.restraint-progress > span{transition:width .2s ease}
.progress.restraint-remaining > span{background:#2f6fb2}
.progress.restraint-overage > span{background:#c23b36}
.progress.restraint-exact > span{width:0!important}
.goal-type-label{color:#8d3d35;font-weight:800;white-space:nowrap}
.restraint-goal-option{display:flex;gap:10px;align-items:flex-start}
.restraint-goal-option input{width:auto;margin-top:3px}
.restraint-goal-option span{display:grid;gap:3px}
.restraint-goal-option small{color:#68736e;font-weight:400}
```

- [ ] **Step 5: 수치 예시 테스트**

Assert:

- 기도 3h, 독서 1h, 스마트폰 절제 3h에서 스마트폰 1h: blue 67%, individual 167%, overall 100 points.
- same budgets with phone 4h: red 33%, individual -33%, overall 57 points.

- [ ] **Step 6: 테스트와 커밋**

Run: `node --test tests/restraint-dashboard-ui.test.js tests/time-budget-ui.test.js tests/recorded-period-navigation-integration.test.js`

Expected: PASS.

```bash
git add src/time-budget-ui.js src/app.js styles.css src/mobile-compact.css tests/restraint-dashboard-ui.test.js
git commit -m "feat: show weighted goal compliance and restraint progress"
```

---

### Task 6: 온라인·오프라인 통계에 목표 의미 적용

**Files:**
- Modify: `src/statistics-ui.js`
- Modify: `src/statistics-offline-rescue.js`
- Modify: `tests/statistics-ui.test.js`
- Modify: `tests/statistics-offline-rescue.test.js`
- Create: `tests/restraint-statistics-ui.test.js`

**Interfaces:**
- Consumes: enriched period summaries from Task 2 and `categoryDisplayName` for matrix headers.
- Produces: weekly/monthly/yearly online and offline statistics using `목표 준수 N점` and goal-aware copy.

- [ ] **Step 1: 실패 테스트 작성**

```js
test('온라인과 오프라인 통계는 목표 준수 점수를 표시한다', async () => {
  const [online, offline] = await Promise.all([
    read('src/statistics-ui.js'), read('src/statistics-offline-rescue.js'),
  ]);
  for (const source of [online, offline]) {
    assert.ok(source.includes('목표 준수'));
    assert.ok(source.includes('goalComplianceScore'));
    assert.ok(!source.includes('<p class="muted">전체 달성률</p>'));
  }
});

test('절제 통계는 파란 잔여와 빨간 초과를 지원한다', async () => {
  const source = await read('src/statistics-ui.js');
  assert.ok(source.includes('restraint-remaining'));
  assert.ok(source.includes('restraint-overage'));
  assert.ok(source.includes('달성률 계산 제외'));
  assert.ok(source.includes('초과 사용'));
});
```

- [ ] **Step 2: 온라인 통계 헬퍼 교체**

```js
function overallAchievementText(summary) {
  return summary.goalComplianceStatus === 'excluded'
    ? '계산 제외'
    : `${summary.goalComplianceScore ?? 0}점`;
}

function achievementText(item) {
  return item.hasBudget ? `${item.percentage}%` : '달성률 계산 제외';
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

`differenceText` for restraint:

```js
if (!item.hasBudget) return '달성률 계산 제외';
if (item.goalType === 'restraint') {
  if (item.status === 'overage') return `${formatMinutes(item.differenceMinutes)} 초과 사용`;
  if (item.status === 'exact') return '예산 소진';
  return `${formatMinutes(Math.abs(item.differenceMinutes))} 남음`;
}
```

- [ ] **Step 3: 표·비교·행렬 변경**

- Summary card label: `목표 준수`.
- Detailed comparison header: `목표 준수` rather than `달성률` for overall cells.
- Category tables keep `달성률` because individual values remain percentages.
- Matrix category headers use `categoryDisplayName(category)`.
- Comparison chart time bars remain budget vs actual time; text beside them shows `목표 준수 N점`.
- Actual-time change fields remain minutes and are not reinterpreted as goal score changes.

- [ ] **Step 4: 오프라인 통계에 동일 규칙 적용**

Import `categoryDisplayName` and reuse equivalent `overallAchievement`, `differenceText`, and category table copy. Cached categories retain `goalType`; existing cached data without it normalizes to growth through the summary domain.

- [ ] **Step 5: 통계 스타일 추가**

```css
.stat-bar-fill.restraint-remaining{background:#2f6fb2}
.stat-bar-fill.restraint-overage{background:#c23b36}
.stat-bar-fill.restraint-exact{width:0!important}
.difference.overage{color:#b3261e}
```

- [ ] **Step 6: 테스트와 커밋**

Run: `node --test tests/restraint-statistics-ui.test.js tests/statistics-ui.test.js tests/statistics-offline-rescue.test.js tests/statistics-monthly-timer-resume-regression.test.js`

Expected: PASS; period navigation and offline timeout behavior remain unchanged.

```bash
git add src/statistics-ui.js src/statistics-offline-rescue.js tests/statistics-ui.test.js tests/statistics-offline-rescue.test.js tests/restraint-statistics-ui.test.js
git commit -m "feat: apply restraint goals to online and offline statistics"
```

---

### Task 7: 타이머 절제 초과 표시와 회귀 보호

**Files:**
- Modify: `src/persistent-timer-ui.js`
- Modify: `src/mobile-compact.css`
- Modify: `tests/countdown-timer-ui.test.js`
- Modify: `tests/restraint-entry-metadata.test.js`

**Interfaces:**
- Consumes: selected category `goalType`.
- Produces: restraint countdown negative display with red semantic class; saved timer entries with `goalType`.

- [ ] **Step 1: 실패 테스트 작성**

```js
test('절제 카운트다운 음수는 초과 사용 경고 클래스를 사용한다', async () => {
  const source = await read('src/persistent-timer-ui.js');
  assert.ok(source.includes('is-restraint-overage'));
  assert.ok(source.includes("goalType === 'restraint'"));
  assert.doesNotMatch(source, /AudioContext|new Audio|\.vibrate\(|Notification\(/);
});
```

- [ ] **Step 2: 렌더 상태 계산**

```js
const activeCategory = knownCategory(timer?.categoryId || selectedId);
const goalType = normalizeGoalType(activeCategory?.goalType);
const isRestraintOverage = mode === 'countdown' && goalType === 'restraint' && displayMs < 0;
```

Timer class and note:

```js
class="timer${isNegative ? ' is-negative' : ''}${isRestraintOverage ? ' is-restraint-overage' : ''}"
${isRestraintOverage ? '<p class="timer-goal-note restraint-overage-copy">초과 사용시간</p>' : ''}
```

- [ ] **Step 3: 스타일 작성**

```css
.timer.is-restraint-overage,.restraint-overage-copy{color:#b3261e}
.timer-goal-note{margin:4px 0 0;text-align:center;font-weight:800}
```

- [ ] **Step 4: 전체 타이머 회귀 실행**

Run: `node --test tests/countdown-timer-ui.test.js tests/persistent-timer.test.js tests/persistent-timer-cross-device.test.js tests/statistics-monthly-timer-resume-regression.test.js tests/restraint-entry-metadata.test.js`

Expected: PASS; duration, pause, recovery, default mode, and category auto-save semantics remain unchanged.

- [ ] **Step 5: 커밋**

```bash
git add src/persistent-timer-ui.js src/mobile-compact.css tests/countdown-timer-ui.test.js tests/restraint-entry-metadata.test.js
git commit -m "feat: mark restraint timer overage"
```

---

### Task 8: PWA, Pages, 전체 검증

**Files:**
- Modify: `service-worker.js`
- Modify: `tests/offline-app-integration.test.js`
- Modify: `tests/recorded-period-pages.test.js`
- Modify: `tests/category-save-copy.test.js`

**Interfaces:**
- Consumes: `src/goal-domain.js` and all modified modules.
- Produces: v9 offline app shell and deployable Pages artifact.

- [ ] **Step 1: 실패 테스트 작성**

```js
test('절제 목표 도메인과 v9 앱 셸을 배포한다', async () => {
  const worker = await read('service-worker.js');
  assert.ok(worker.includes('weekly-time-budget-shell-v9'));
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

Add `./src/goal-domain.js` to `SHELL_URLS` before `domain.js`, `time-budget-domain.js`, and UI importers.

- [ ] **Step 3: 전체 테스트**

Run: `npm test`

Expected: all tests PASS.

- [ ] **Step 4: 문법 검사**

```bash
node --check src/goal-domain.js
node --check src/domain.js
node --check src/time-budget-domain.js
node --check src/app.js
node --check src/category-bulk-editor.js
node --check src/category-ui-patch.js
node --check src/time-budget-ui.js
node --check src/statistics-ui.js
node --check src/statistics-offline-rescue.js
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

- existing/invalid types normalize to growth;
- restraint checkbox is only in category-add;
- edit and bulk save never write `goalType`;
- archive and restore preserve `goalType`;
- restraint names appear in dashboard, timer, manual input, budget, online/offline history, online/offline statistics, category management;
- every new entry carries `goalType`;
- 3-hour restraint values are exactly `200, 167, 133, 100, -33, -67, -100`;
- any positive overage is negative;
- zero budget is excluded;
- overall score uses budget-minute weights;
- phone 1-hour example is 100 points and phone 4-hour example is 57 points;
- restraint negative contributes 0 and never subtracts another category score;
- blue remaining bar decreases, exact is empty, red overage restarts from left;
- actual/budget time totals remain positive sums;
- timer and offline regressions remain green;
- service worker uses v9 only;
- no unrelated refactor or dependency is included.

- [ ] **Step 7: 최종 커밋과 PR 준비**

```bash
git add -A
git commit -m "feat: add immutable restraint goals"
```

PR body must state:

```markdown
- 기존 대분류와 goalType 없는 데이터: growth
- 절제 선택 위치: 대분류 추가 폼만
- 목표 방식 변경: 생성 후 불가, 보관·복원 시 보존
- 전체 목표 준수: 예산시간 가중, 0~100점
- 절제 음수의 전체 반영: 해당 항목 0점, 다른 목표 차감 없음
- 절제 막대: 파란 잔여 감소 → 빈 막대 → 빨간 초과 증가
```
