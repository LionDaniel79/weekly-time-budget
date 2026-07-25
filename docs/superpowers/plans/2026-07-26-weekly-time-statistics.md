# Weekly Time Statistics Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Include Sunday in every weekly calculation, preserve the last selected category for timer and manual entry, support category reordering, and add monthly/yearly statistics plus comparisons.

**Architecture:** Keep Firebase persistence in `src/app.js`, move pure date/statistics calculations into `src/domain.js`, and add focused tests in `test/domain.test.js`. Store last selections in `localStorage`; store category order in each category document's `order` field. Statistics are computed client-side from loaded entries and active/archived category names, using CSS bars without adding dependencies.

**Tech Stack:** Vanilla JavaScript ES modules, Firebase Authentication/Firestore 11.10.0, Node.js built-in test runner, HTML/CSS.

## Global Constraints

- Weekly ranges run Monday through Sunday.
- Every dashboard, record list, monthly statistic, yearly statistic, and comparison includes Sunday records.
- Timer and manual-entry category selections are remembered independently and restored after save and reload.
- Category order is persisted to Firestore and used consistently in dropdowns, budgets, dashboard, and statistics.
- Archived categories remain visible by name in historical statistics; permanently deleted records do not appear.
- No chart library or new runtime dependency is added.

---

### Task 1: Monday-to-Sunday date range and aggregation helpers

**Files:**
- Modify: `src/domain.js`
- Modify: `test/domain.test.js`

**Interfaces:**
- Produces: `getWeekRange(date): { start: string, end: string }` ending on Sunday.
- Produces: `getMonthRange(year, month): { start: string, end: string }`.
- Produces: `getYearRange(year): { start: string, end: string }`.
- Produces: `summarizePeriod(entries, categoryNames, start, end)` returning total minutes, record-day count, daily average, and category totals.
- Produces: `monthlyComparison(entries, year)` returning 12 month totals.
- Produces: `yearlyComparison(entries)` returning sorted year totals.

- [ ] **Step 1: Write failing tests**

Add tests proving that a Sunday date is included in the week ending Sunday, month boundaries include the last calendar day, leap-year February is handled, and comparison helpers aggregate entries correctly.

- [ ] **Step 2: Run tests to verify failure**

Run: `npm test`
Expected: failures for the Sunday week end and undefined statistics helpers.

- [ ] **Step 3: Implement minimal pure helpers**

Change `getWeekRange()` to return Monday through Sunday and add the date/statistics exports listed above. Treat entry dates as `YYYY-MM-DD` strings and duration as numeric minutes.

- [ ] **Step 4: Run tests to verify pass**

Run: `npm test`
Expected: all domain tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/domain.js test/domain.test.js
git commit -m "feat: include Sunday and add statistics helpers"
```

### Task 2: Persist last selected timer and manual categories

**Files:**
- Modify: `src/app.js`
- Test: manual browser verification

**Interfaces:**
- Consumes: active categories sorted by `order`.
- Produces: localStorage keys `weekly-time-budget:last-timer-category` and `weekly-time-budget:last-manual-category`.

- [ ] **Step 1: Add selection state initialization**

Read both localStorage keys into `state.lastTimerCategoryId` and `state.lastManualCategoryId`, ignoring IDs no longer present among active categories.

- [ ] **Step 2: Preserve timer selection**

When starting a timer, save the selected category ID to state and localStorage. When the timer is stopped and the form rerenders, use that saved ID as the selected option.

- [ ] **Step 3: Preserve manual selection**

On manual submit, save the selected category ID before writing the entry. After `saveEntry()` rerenders the form, use the saved manual ID as the selected option.

- [ ] **Step 4: Verify behavior**

Run: `npm start`
Expected: timer selection remains after stop/save; manual selection remains after save; both survive a browser reload; deleting or archiving the selected category falls back to “선택하세요”.

- [ ] **Step 5: Commit**

```bash
git add src/app.js
git commit -m "fix: remember last selected categories"
```

### Task 3: Persist category ordering

**Files:**
- Modify: `src/app.js`
- Modify: `styles.css`
- Test: manual browser verification

**Interfaces:**
- Produces: `moveCategory(categoryId, direction)` where direction is `-1` or `1`.
- Persists: contiguous `order` values starting at 1 for active categories.

- [ ] **Step 1: Normalize loaded category order**

Sort active categories by numeric `order`, with missing values placed last while preserving document order.

- [ ] **Step 2: Add move controls**

Add `↑` and `↓` buttons beside each registered category. Disable `↑` for the first item and `↓` for the last.

- [ ] **Step 3: Implement atomic reorder**

Swap the selected item with its neighbor, write every affected category's new `order` in one Firestore batch, reload data, and rerender.

- [ ] **Step 4: Verify propagation**

Run: `npm start`
Expected: reordered categories appear in the same order in category management, timer/manual dropdowns, weekly budget, dashboard, and statistics.

- [ ] **Step 5: Commit**

```bash
git add src/app.js styles.css
git commit -m "feat: reorder categories"
```

### Task 4: Add statistics navigation and view shell

**Files:**
- Modify: `index.html`
- Modify: `src/app.js`
- Modify: `styles.css`

**Interfaces:**
- Adds view key: `statistics`.
- Produces: statistics modes `monthly`, `yearly`, `monthly-comparison`, `yearly-comparison`.

- [ ] **Step 1: Add navigation and section**

Add a “통계” sidebar button and `<section id="statistics-view">`.

- [ ] **Step 2: Add statistics state and controls**

Add selected mode, year, and month to state. Render four tabs plus year/month selectors appropriate to each mode.

- [ ] **Step 3: Add responsive layout styles**

Add CSS for statistic summary cards, category bars, comparison bars, tab wrapping, and mobile controls.

- [ ] **Step 4: Verify navigation**

Run: `npm start`
Expected: the statistics view opens, tabs switch without errors, and controls remain usable on desktop and mobile widths.

- [ ] **Step 5: Commit**

```bash
git add index.html src/app.js styles.css
git commit -m "feat: add statistics view shell"
```

### Task 5: Monthly and yearly statistics

**Files:**
- Modify: `src/app.js`
- Test: `test/domain.test.js`

**Interfaces:**
- Consumes: `getMonthRange`, `getYearRange`, `summarizePeriod` from `src/domain.js`.
- Consumes: merged active and archived category-name map.

- [ ] **Step 1: Add archived category loading**

Load archived categories with active categories and entries. Build one name map where active names take precedence and archived names preserve historical labels.

- [ ] **Step 2: Render monthly statistics**

For selected year/month, show total time, record days, daily average, and category totals sorted by current active order followed by archived-only categories by name.

- [ ] **Step 3: Render yearly statistics**

For selected year, show the same summary and category breakdown across January 1 through December 31.

- [ ] **Step 4: Verify Sunday inclusion**

Create or identify a Sunday entry and confirm it appears in the selected month/year totals and category breakdown.

- [ ] **Step 5: Commit**

```bash
git add src/app.js test/domain.test.js
git commit -m "feat: add monthly and yearly statistics"
```

### Task 6: Monthly and yearly comparisons

**Files:**
- Modify: `src/app.js`
- Modify: `styles.css`
- Test: `test/domain.test.js`

**Interfaces:**
- Consumes: `monthlyComparison(entries, year)` and `yearlyComparison(entries)`.

- [ ] **Step 1: Render monthly comparison**

Show January through December totals for the selected year. Scale CSS bars relative to the largest month, show formatted time, and show change from the preceding month when both values exist.

- [ ] **Step 2: Render yearly comparison**

Show every year represented in entries, sorted ascending, with relative bars, formatted total time, and change from the preceding year.

- [ ] **Step 3: Handle empty and zero data**

Show a clear empty state when there are no entries; avoid division by zero and display 0% change when both periods are zero.

- [ ] **Step 4: Run automated and manual verification**

Run: `npm test`
Expected: all tests pass.

Run: `npm start`
Expected: all four statistics modes render and controls update figures immediately.

- [ ] **Step 5: Commit**

```bash
git add src/app.js styles.css test/domain.test.js
git commit -m "feat: add period comparison statistics"
```

### Task 7: Remove Monday-to-Saturday copy and complete regression verification

**Files:**
- Modify: `index.html`
- Modify: `src/app.js`
- Modify: `README.md`

**Interfaces:**
- No new interfaces.

- [ ] **Step 1: Replace outdated copy**

Replace every “월~토”, “월요일부터 토요일”, and “주일 제외” message with Monday-to-Sunday wording.

- [ ] **Step 2: Update documentation**

Document Sunday inclusion, remembered selections, category ordering, and the four statistics modes.

- [ ] **Step 3: Run the complete test suite**

Run: `npm test`
Expected: all tests pass.

- [ ] **Step 4: Verify primary user flows**

Run: `npm start`
Expected: login, category create/edit/order/archive/delete, budget save, timer save, manual save, dashboard, history, and statistics all work without console errors.

- [ ] **Step 5: Commit**

```bash
git add index.html src/app.js README.md
git commit -m "docs: document Sunday-inclusive statistics"
```
