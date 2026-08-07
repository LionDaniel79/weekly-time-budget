# Sunday Calendar and Category Layout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 일간 대시보드의 월간 캘린더를 일요일 시작으로 바꾸고, 대분류 관리의 등록·보관 목록을 데스크톱 전체 폭에 안정적으로 배치한다.

**Architecture:** 캘린더의 날짜 셀 정렬은 `time-budget-domain.js`의 순수 함수에서, 요일 헤더는 `time-budget-ui.js`에서 각각 수정한다. 대분류 화면은 `category-feature.js`에 전용 레이아웃 클래스를 추가하고 `styles.css`에서 그 클래스만 세로 전체 폭 그리드로 정의해 다른 `.grid-2` 화면에 영향을 주지 않는다.

**Tech Stack:** JavaScript ES Modules, Node `node:test`, CSS Grid, GitHub Actions/Playwright.

## Global Constraints

- 캘린더 헤더는 `일 월 화 수 목 금 토` 순서다.
- 월 첫째 날의 빈 셀도 일요일 시작 기준으로 계산한다.
- 주간 예산과 통계의 월요일~일요일 기간 규칙은 변경하지 않는다.
- 대분류 저장·보관·삭제 동작과 절제 목표 표시 로직은 변경하지 않는다.
- 다른 `.grid-2` 화면의 레이아웃은 변경하지 않는다.

---

### Task 1: Sunday-first calendar regression

**Files:**
- Modify: `tests/time-budget-domain.test.js`
- Modify: `src/time-budget-domain.js`
- Modify: `src/time-budget-ui.js`

**Interfaces:**
- Consumes: `calendarMonthCells(year, month, recordedDates, today)`
- Produces: 동일한 셀 객체 배열 API를 유지하되 첫 열을 일요일로 해석한다.

- [ ] **Step 1: Write the failing domain test**

`tests/time-budget-domain.test.js`의 기존 달력 테스트 옆에 다음 검증을 추가한다.

```js
test('달력은 일요일을 첫 열로 사용한다', () => {
  const cells = calendarMonthCells(2026, 8, ['2026-08-01'], '2026-08-07');
  assert.equal(cells[0].date, null);
  assert.equal(cells[5].date, null);
  assert.equal(cells[6].date, '2026-08-01');
  assert.equal(cells[7].date, '2026-08-02');
});
```

2026-08-01은 토요일이므로 일요일 시작 달력에서 첫 주의 7번째 칸(index 6)에 있어야 한다.

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```bash
node --test tests/time-budget-domain.test.js
```

Expected: 새 테스트가 기존 월요일 시작 오프셋 때문에 실패한다.

- [ ] **Step 3: Implement the minimal domain change**

`calendarMonthCells()`에서:

```js
const sundayOffset = first.getDay();
```

를 사용하고 날짜 계산을 `sundayOffset` 기준으로 유지한다. `getWeekRange`, `weekdayIndex`, 주간 예산 로직은 건드리지 않는다.

- [ ] **Step 4: Add the UI contract for weekday order**

`tests/time-budget-domain.test.js` 또는 별도 source-contract 테스트에서 `src/time-budget-ui.js`를 읽어 `['일','월','화','수','목','금','토']` 순서를 요구한다.

```js
const ui = await readFile(new URL('../src/time-budget-ui.js', import.meta.url), 'utf8');
assert.match(ui, /\['일','월','화','수','목','금','토'\]/);
```

- [ ] **Step 5: Change only the calendar weekday header**

`renderCalendar()`의 요일 배열을 다음으로 바꾼다.

```js
['일','월','화','수','목','금','토']
```

- [ ] **Step 6: Run focused tests and verify GREEN**

```bash
node --test tests/time-budget-domain.test.js
```

Expected: PASS.

- [ ] **Step 7: Commit calendar change**

```bash
git add tests/time-budget-domain.test.js src/time-budget-domain.js src/time-budget-ui.js
git commit -m "fix: start dashboard calendar on Sunday"
```

---

### Task 2: Full-width category management layout

**Files:**
- Create: `tests/category-layout-regression.test.js`
- Modify: `src/category-feature.js`
- Modify: `styles.css`

**Interfaces:**
- Consumes: 기존 `weekly-time-budget:category-state` 이벤트와 `onSave/onArchive/onRestore/onDelete` 콜백.
- Produces: 동일 기능을 유지하면서 `.category-management-layout` 아래에 추가/등록/보관 카드를 세로 전체 폭으로 렌더링한다.

- [ ] **Step 1: Write the failing source/layout contract test**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('대분류 관리는 등록·보관 목록을 전체 폭 전용 레이아웃으로 배치한다', async () => {
  const [feature, css] = await Promise.all([
    read('src/category-feature.js'),
    read('styles.css'),
  ]);

  assert.match(feature, /category-management-layout/);
  assert.doesNotMatch(feature, /<div class="grid grid-2">/);
  assert.match(css, /\.category-management-layout\s*\{[^}]*display:\s*grid[^}]*grid-template-columns:\s*minmax\(0,1fr\)/s);
});
```

- [ ] **Step 2: Run the focused test and verify RED**

```bash
node --test tests/category-layout-regression.test.js
```

Expected: 현재 `grid grid-2` 마크업 때문에 FAIL.

- [ ] **Step 3: Implement the minimal markup change**

`category-feature.js`의 최상위 래퍼를:

```html
<div class="category-management-layout">
```

로 바꾸고 카드 순서는 `대분류 추가` → `등록된 대분류` → `보관된 대분류`로 유지한다. 각 폼과 버튼 클래스, 데이터 속성, 이벤트 바인딩은 변경하지 않는다.

- [ ] **Step 4: Add isolated CSS**

`styles.css`에 다음 전용 규칙을 추가한다.

```css
.category-management-layout {
  display: grid;
  grid-template-columns: minmax(0,1fr);
  gap: 18px;
}
```

다른 `.grid-2` 규칙과 반응형 규칙은 건드리지 않는다.

- [ ] **Step 5: Run focused tests and verify GREEN**

```bash
node --test tests/category-layout-regression.test.js
```

Expected: PASS.

- [ ] **Step 6: Run related ownership/UI tests**

```bash
node --test tests/category-feature-ownership.test.js tests/ui-contract.test.js tests/restraint-category-management.test.js
```

Expected: PASS.

- [ ] **Step 7: Commit category layout change**

```bash
git add tests/category-layout-regression.test.js src/category-feature.js styles.css
git commit -m "fix: use full-width category management layout"
```

---

### Task 3: Full regression and delivery

**Files:**
- Verify only; no planned product-code changes.

**Interfaces:**
- Consumes: Tasks 1-2 completed changes.
- Produces: CI-clean branch ready for PR.

- [ ] **Step 1: Run all Node tests**

```bash
npm test
```

Expected: all PASS.

- [ ] **Step 2: Run Chromium browser tests**

```bash
npm run test:browser
```

Expected: all PASS.

- [ ] **Step 3: Build/verify Pages artifact**

Use test Firebase values as CI does:

```bash
FIREBASE_API_KEY=test-api-key \
FIREBASE_AUTH_DOMAIN=test.firebaseapp.com \
FIREBASE_PROJECT_ID=test-project \
FIREBASE_STORAGE_BUCKET=test.firebasestorage.app \
FIREBASE_MESSAGING_SENDER_ID=123456789 \
FIREBASE_APP_ID=1:123456789:web:test \
npm run prepare:pages
```

Expected: `_site` is produced successfully and contains the changed source/CSS.

- [ ] **Step 4: Review branch diff for scope**

Confirm changes are limited to the approved design, tests, and docs. In particular, verify no change to `getWeekRange()` or weekly statistics period rules.

- [ ] **Step 5: Open PR**

PR title:

```text
fix: start calendar on Sunday and widen category layout
```

PR body must state the two UI changes and verification results.
