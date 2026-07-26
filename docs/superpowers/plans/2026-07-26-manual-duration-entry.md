# Manual Duration Entry Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a second manual-entry mode that records an integer number of minutes without start or end times while preserving the existing time-range mode and all current statistics behavior.

**Architecture:** Put duration validation, payload construction, and history-label formatting in a small pure module so these rules can be unit tested without Firebase or the DOM. Keep rendering, session-only mode/category state, Firestore writes, and event binding in `src/app.js`. Reuse the existing `durationMinutes`, `date`, and `categoryId` fields so dashboard and statistics calculations require no changes.

**Tech Stack:** Vanilla HTML/CSS/JavaScript, ES modules, Node.js built-in test runner, Firebase Authentication, Cloud Firestore, GitHub Actions, GitHub Pages.

## Global Constraints

- Existing timer behavior must not change.
- Existing manual start/end time behavior must remain the default.
- Direct duration input accepts integer values from 1 through 1,440 minutes inclusive.
- Direct duration records use `source: 'manual-duration'` and omit `startTime` and `endTime`.
- The selected manual input mode and category persist only in the current browser session.
- After saving, the selected mode and category remain; duration and note fields reset.
- Direct duration records must appear in all existing dashboard and statistics calculations without changing statistics formulas.
- History text for direct duration records is `직접 입력 · <formatted duration>`.
- At 360px width, the manual form must not create page-wide horizontal scrolling.
- Work starts from `agent/build-mvp` on a feature branch such as `agent/manual-duration-entry`.
- Merge to `agent/build-mvp` only after the full CI suite passes. Merge to `main` only after review so GitHub Pages redeploys the approved release.

---

## File Map

- Create `src/manual-entry.js`: pure constants, minute validation, direct-entry payload construction, and history-label formatting.
- Create `tests/manual-duration-entry.test.js`: unit tests for validation, payload shape, history text, and syntax.
- Modify `src/app.js`: mode/category state, two mode buttons, conditional form fields, direct-duration save path, and shared history-label use.
- Modify `tests/ui-contract.test.js`: source-contract tests for mode controls, state retention, save integration, and history rendering.
- Modify `styles.css`: responsive mode switch and duration input row.
- No changes to `src/domain.js`, `src/statistics-ui.js`, Firestore rules, or stored existing records.

---

### Task 1: Add Pure Manual-Duration Rules

**Files:**
- Create: `src/manual-entry.js`
- Create: `tests/manual-duration-entry.test.js`

**Interfaces:**
- Produces: `MANUAL_INPUT_MODES` with `TIME_RANGE` and `DURATION` values.
- Produces: `MANUAL_DURATION_ERROR: string`.
- Produces: `parseManualDurationMinutes(value: unknown): number`.
- Produces: `createManualDurationEntry(input): object`.
- Produces: `manualEntryTimeLabel(entry, formatMinutes): string`.

- [ ] **Step 1: Write failing validation and payload tests**

Create `tests/manual-duration-entry.test.js` with these initial tests:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MANUAL_DURATION_ERROR,
  MANUAL_INPUT_MODES,
  createManualDurationEntry,
  manualEntryTimeLabel,
  parseManualDurationMinutes,
} from '../src/manual-entry.js';

const formatMinutes = (minutes) => `${minutes}분`;

test('manual input modes expose time-range and duration values', () => {
  assert.deepEqual(MANUAL_INPUT_MODES, {
    TIME_RANGE: 'time-range',
    DURATION: 'duration',
  });
});

test('direct minute input accepts inclusive integer boundaries', () => {
  assert.equal(parseManualDurationMinutes('1'), 1);
  assert.equal(parseManualDurationMinutes('30'), 30);
  assert.equal(parseManualDurationMinutes('1440'), 1440);
});

test('direct minute input rejects empty, non-integer, and out-of-range values', () => {
  for (const value of ['', '0', '-1', '1.5', '1441', 'abc', null, undefined]) {
    assert.throws(
      () => parseManualDurationMinutes(value),
      (error) => error instanceof RangeError && error.message === MANUAL_DURATION_ERROR,
    );
  }
});

test('direct duration payload omits start and end times', () => {
  assert.deepEqual(
    createManualDurationEntry({
      categoryId: 'reading',
      date: '2026-07-26',
      note: '  chapter 3  ',
      durationMinutes: '45',
    }),
    {
      categoryId: 'reading',
      date: '2026-07-26',
      note: 'chapter 3',
      durationMinutes: 45,
      source: 'manual-duration',
    },
  );
});

test('history label distinguishes direct duration, timed, and legacy records', () => {
  assert.equal(
    manualEntryTimeLabel(
      { source: 'manual-duration', durationMinutes: 30 },
      formatMinutes,
    ),
    '직접 입력 · 30분',
  );
  assert.equal(
    manualEntryTimeLabel(
      { startTime: '09:00', endTime: '10:00', durationMinutes: 60 },
      formatMinutes,
    ),
    '09:00–10:00 · 60분',
  );
  assert.equal(
    manualEntryTimeLabel({ durationMinutes: 15 }, formatMinutes),
    '15분',
  );
});
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run:

```bash
node --test tests/manual-duration-entry.test.js
```

Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `src/manual-entry.js`.

- [ ] **Step 3: Implement the pure module**

Create `src/manual-entry.js`:

```js
export const MANUAL_INPUT_MODES = Object.freeze({
  TIME_RANGE: 'time-range',
  DURATION: 'duration',
});

export const MANUAL_DURATION_ERROR =
  '기록 시간은 1분 이상 1,440분 이하의 정수로 입력하세요.';

export function parseManualDurationMinutes(value) {
  const text = String(value ?? '').trim();
  if (!/^\d+$/.test(text)) throw new RangeError(MANUAL_DURATION_ERROR);

  const minutes = Number(text);
  if (!Number.isSafeInteger(minutes) || minutes < 1 || minutes > 1440) {
    throw new RangeError(MANUAL_DURATION_ERROR);
  }
  return minutes;
}

export function createManualDurationEntry({
  categoryId,
  date,
  note = '',
  durationMinutes,
}) {
  return {
    categoryId,
    date,
    note: String(note).trim(),
    durationMinutes: parseManualDurationMinutes(durationMinutes),
    source: 'manual-duration',
  };
}

export function manualEntryTimeLabel(entry, formatMinutes) {
  const duration = formatMinutes(Number(entry?.durationMinutes) || 0);
  if (entry?.source === 'manual-duration') return `직접 입력 · ${duration}`;
  if (entry?.startTime && entry?.endTime) {
    return `${entry.startTime}–${entry.endTime} · ${duration}`;
  }
  return duration;
}
```

- [ ] **Step 4: Run the focused test and syntax check**

Run:

```bash
node --test tests/manual-duration-entry.test.js
node --check src/manual-entry.js
```

Expected: all tests PASS and syntax check exits 0.

- [ ] **Step 5: Commit the pure rules**

```bash
git add src/manual-entry.js tests/manual-duration-entry.test.js
git commit -m "feat: add manual duration entry rules"
```

---

### Task 2: Add the Manual Input Mode Switch and Session State

**Files:**
- Modify: `src/app.js` imports, state object, `manualForm()`, and `bindManual()`
- Modify: `tests/ui-contract.test.js`

**Interfaces:**
- Consumes: `MANUAL_INPUT_MODES` from Task 1.
- Produces state fields: `manualInputMode: 'time-range' | 'duration'` and `manualCategoryId: string`.
- Produces DOM controls: `[data-manual-mode="time-range"]`, `[data-manual-mode="duration"]`, `#manual-duration`.

- [ ] **Step 1: Add failing UI contract tests**

Append to `tests/ui-contract.test.js`:

```js
test('수동 입력은 시각 범위와 분 직접 입력 방식을 제공한다', async () => {
  const appSource = await read('src/app.js');
  assert.match(appSource, /manualInputMode:\s*MANUAL_INPUT_MODES\.TIME_RANGE/);
  assert.match(appSource, /manualCategoryId:\s*['"]/);
  assert.match(appSource, /data-manual-mode="time-range"/);
  assert.match(appSource, /data-manual-mode="duration"/);
  assert.match(appSource, /시작·종료 시각/);
  assert.match(appSource, /분 직접 입력/);
  assert.match(appSource, /id="manual-duration"/);
  assert.match(appSource, /state\.manualCategoryId\s*=\s*\$\('#manual-category'\)/);
});

test('수동 입력은 선택한 방식의 필드만 렌더링한다', async () => {
  const appSource = await read('src/app.js');
  assert.match(appSource, /state\.manualInputMode\s*===\s*MANUAL_INPUT_MODES\.DURATION/);
  assert.match(appSource, /durationMode\s*\?/);
  assert.match(appSource, /class="time-fields"/);
  assert.match(appSource, /class="duration-input-row"/);
  assert.match(appSource, /renderRecord\(\)/);
});
```

- [ ] **Step 2: Run the UI contract tests and verify failure**

Run:

```bash
node --test tests/ui-contract.test.js
```

Expected: FAIL because the new state fields and controls are absent.

- [ ] **Step 3: Import the mode constant and extend state**

At the top of `src/app.js`, add:

```js
import {
  MANUAL_INPUT_MODES,
  createManualDurationEntry,
  manualEntryTimeLabel,
} from './manual-entry.js';
```

Extend `state`:

```js
manualInputMode: MANUAL_INPUT_MODES.TIME_RANGE,
manualCategoryId: '',
```

Do not store these values in Firestore or local storage.

- [ ] **Step 4: Replace `manualForm()` with conditional mode fields**

Use this structure inside `manualForm()`:

```js
function manualForm() {
  const now = new Date();
  const end = now.toTimeString().slice(0, 5);
  const startDate = new Date(now.getTime() - 60 * 60 * 1000);
  const start = startDate.toTimeString().slice(0, 5);
  const durationMode = state.manualInputMode === MANUAL_INPUT_MODES.DURATION;

  return `
    <form id="manual-form" class="form-grid">
      <div class="manual-mode-switch" role="group" aria-label="수동 입력 방식">
        <button
          type="button"
          class="tab-button ${durationMode ? '' : 'active'}"
          data-manual-mode="time-range"
          aria-pressed="${durationMode ? 'false' : 'true'}">
          시작·종료 시각
        </button>
        <button
          type="button"
          class="tab-button ${durationMode ? 'active' : ''}"
          data-manual-mode="duration"
          aria-pressed="${durationMode ? 'true' : 'false'}">
          분 직접 입력
        </button>
      </div>
      <label>대분류
        <select id="manual-category" required>
          <option value="">선택하세요</option>
          ${optionHtml(state.manualCategoryId)}
        </select>
      </label>
      <label>날짜
        <input id="manual-date" type="date" value="${toDateKey(now)}" required>
      </label>
      ${durationMode
        ? `<label>직접 기록할 시간
            <div class="duration-input-row">
              <input
                id="manual-duration"
                type="number"
                min="1"
                max="1440"
                step="1"
                inputmode="numeric"
                autocomplete="off"
                required>
              <span aria-hidden="true">분</span>
            </div>
          </label>`
        : `<div class="time-fields">
            <label>시작<input id="manual-start" type="time" value="${start}" required></label>
            <label>종료<input id="manual-end" type="time" value="${end}" required></label>
          </div>`}
      <label>메모(선택)<textarea id="manual-note" rows="2"></textarea></label>
      <button class="primary-button" type="submit">기록 저장</button>
    </form>`;
}
```

- [ ] **Step 5: Bind the mode buttons before binding submit**

At the start of `bindManual()` add:

```js
document.querySelectorAll('[data-manual-mode]').forEach((button) => {
  button.onclick = () => {
    state.manualCategoryId = $('#manual-category')?.value || state.manualCategoryId;
    state.manualInputMode = button.dataset.manualMode;
    renderRecord();
  };
});
```

This preserves only the category and selected mode, exactly as specified.

- [ ] **Step 6: Run UI tests and syntax check**

Run:

```bash
node --test tests/ui-contract.test.js
node --check src/app.js
```

Expected: PASS.

- [ ] **Step 7: Commit mode-switch rendering**

```bash
git add src/app.js tests/ui-contract.test.js
git commit -m "feat: add manual entry mode switch"
```

---

### Task 3: Save Direct Minutes and Format History Consistently

**Files:**
- Modify: `src/app.js` `bindManual()` and `renderHistory()`
- Modify: `tests/ui-contract.test.js`
- Test: `tests/manual-duration-entry.test.js`

**Interfaces:**
- Consumes: `createManualDurationEntry()` and `manualEntryTimeLabel()` from Task 1.
- Produces Firestore entry objects with `source: 'manual-duration'` and no time fields.
- Preserves `state.manualCategoryId` and `state.manualInputMode` after save.

- [ ] **Step 1: Add failing integration contract tests**

Append to `tests/ui-contract.test.js`:

```js
test('분 직접 입력은 별도 source로 저장하고 시각 필드를 만들지 않는다', async () => {
  const appSource = await read('src/app.js');
  assert.match(appSource, /createManualDurationEntry\(\{/);
  assert.match(appSource, /durationMinutes:\s*\$\('#manual-duration'\)\.value/);
  assert.match(appSource, /state\.manualCategoryId\s*=\s*categoryId/);
  assert.match(appSource, /catch\s*\(error\)/);
  assert.match(appSource, /alert\(error\.message\)/);
});

test('기록 내역은 직접 입력과 기존 시각 기록을 공통 formatter로 표시한다', async () => {
  const appSource = await read('src/app.js');
  assert.match(appSource, /manualEntryTimeLabel\(entry,\s*formatMinutes\)/);
  assert.doesNotMatch(appSource, /\$\{entry\.startTime \|\| ''\}–\$\{entry\.endTime \|\| ''\}/);
});
```

- [ ] **Step 2: Run the tests and verify failure**

Run:

```bash
node --test tests/ui-contract.test.js tests/manual-duration-entry.test.js
```

Expected: UI contract FAIL because `bindManual()` and history rendering still use the old path.

- [ ] **Step 3: Split the submit handler by mode**

Replace the old body of `#manual-form.onsubmit` with:

```js
$('#manual-form').onsubmit = async (event) => {
  event.preventDefault();

  const categoryId = $('#manual-category').value;
  if (!categoryId) return alert('대분류를 선택하세요.');

  const date = $('#manual-date').value;
  if (!date) return alert('날짜를 선택하세요.');

  state.manualCategoryId = categoryId;

  if (state.manualInputMode === MANUAL_INPUT_MODES.DURATION) {
    try {
      const entry = createManualDurationEntry({
        categoryId,
        date,
        note: $('#manual-note').value,
        durationMinutes: $('#manual-duration').value,
      });
      await saveEntry(entry);
    } catch (error) {
      alert(error instanceof Error ? error.message : String(error));
    }
    return;
  }

  const durationMinutes = minutesBetween(
    $('#manual-start').value,
    $('#manual-end').value,
  );
  if (durationMinutes <= 0 || durationMinutes > 1440) {
    return alert('시간 범위를 확인하세요.');
  }

  await saveEntry({
    categoryId,
    note: $('#manual-note').value.trim(),
    date,
    durationMinutes,
    startTime: $('#manual-start').value,
    endTime: $('#manual-end').value,
    source: 'manual',
  });
};
```

Because `saveEntry()` reloads data and calls `renderAll()`, the form is redrawn with the retained mode and category while duration and note fields are blank.

- [ ] **Step 4: Use the shared history label**

Inside `renderHistory()`, calculate:

```js
const timeDescription = manualEntryTimeLabel(entry, formatMinutes);
```

Then replace the old time line with:

```js
<div>${escapeHtml(timeDescription)}</div>
```

Do not add fake start or end times to direct duration records.

- [ ] **Step 5: Run focused tests and JavaScript syntax checks**

Run:

```bash
node --test tests/manual-duration-entry.test.js tests/ui-contract.test.js
node --check src/manual-entry.js
node --check src/app.js
```

Expected: all PASS.

- [ ] **Step 6: Commit save and history integration**

```bash
git add src/app.js tests/ui-contract.test.js
git commit -m "feat: save direct manual minutes"
```

---

### Task 4: Make the New Controls Mobile-Safe

**Files:**
- Modify: `styles.css`
- Modify: `tests/manual-duration-entry.test.js`

**Interfaces:**
- Produces `.manual-mode-switch` and `.duration-input-row` layout rules.
- Keeps both mode buttons in one row and constrains children with `min-width: 0`.

- [ ] **Step 1: Add failing CSS contract tests**

Append to `tests/manual-duration-entry.test.js`:

```js
import { readFile } from 'node:fs/promises';

test('manual duration controls stay within the mobile viewport', async () => {
  const css = await readFile(new URL('../styles.css', import.meta.url), 'utf8');
  assert.match(css, /\.manual-mode-switch\s*\{[^}]*display\s*:\s*grid/s);
  assert.match(css, /\.manual-mode-switch\s*\{[^}]*grid-template-columns\s*:\s*repeat\(2,minmax\(0,1fr\)\)/s);
  assert.match(css, /\.manual-mode-switch \.tab-button\s*\{[^}]*min-width\s*:\s*0/s);
  assert.match(css, /\.duration-input-row\s*\{[^}]*display\s*:\s*grid/s);
  assert.match(css, /\.duration-input-row\s*\{[^}]*grid-template-columns\s*:\s*minmax\(0,1fr\) auto/s);
  assert.match(css, /@media\(max-width:360px\)/);
});
```

Place the new `readFile` import with the other imports at the top of the test file.

- [ ] **Step 2: Run the focused test and verify failure**

Run:

```bash
node --test tests/manual-duration-entry.test.js
```

Expected: FAIL because the new CSS selectors do not exist.

- [ ] **Step 3: Add desktop and mobile styles**

Add these non-media rules to `styles.css` near `.tabs` and `.time-fields`:

```css
.manual-mode-switch{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}.manual-mode-switch .tab-button{min-width:0;width:100%;white-space:normal}.duration-input-row{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:10px;align-items:center}.duration-input-row span{font-weight:800;white-space:nowrap}
```

Add this media rule after the existing mobile block:

```css
@media(max-width:360px){.manual-mode-switch{gap:6px}.manual-mode-switch .tab-button{padding:9px 8px;font-size:.9rem}.duration-input-row{gap:8px}}
```

Do not shrink form text below `.9rem`.

- [ ] **Step 4: Run focused and existing mobile tests**

Run:

```bash
node --test tests/manual-duration-entry.test.js tests/mobile-statistics-layout.test.js
```

Expected: PASS.

- [ ] **Step 5: Commit responsive styles**

```bash
git add styles.css tests/manual-duration-entry.test.js
git commit -m "style: fit manual duration controls on mobile"
```

---

### Task 5: Full Regression, Review, and Release Preparation

**Files:**
- No new feature files.
- Review all changes from Tasks 1–4.

**Interfaces:**
- Consumes the completed feature branch.
- Produces a reviewed PR to `agent/build-mvp`, followed later by a release PR to `main`.

- [ ] **Step 1: Run the entire test suite from a clean tree**

Run:

```bash
npm test
```

Expected: all tests PASS with 0 failures.

- [ ] **Step 2: Run syntax checks for all modified JavaScript**

Run:

```bash
node --check src/manual-entry.js
node --check src/app.js
```

Expected: both commands exit 0.

- [ ] **Step 3: Review the feature diff**

Run:

```bash
git diff agent/build-mvp...HEAD -- src/manual-entry.js src/app.js styles.css tests/manual-duration-entry.test.js tests/ui-contract.test.js
```

Verify all of the following:

- Existing `source: 'manual'` time-range records remain unchanged.
- Direct duration records omit `startTime` and `endTime`.
- No changes exist in statistics formulas or Firestore rules.
- `manualInputMode` and `manualCategoryId` are session-only state.
- History uses `manualEntryTimeLabel()` for all record types.
- No real Firebase configuration value appears in the diff.

- [ ] **Step 4: Open a PR to `agent/build-mvp`**

Use title:

```text
feat: add direct minute manual entry
```

Use body:

```markdown
- add time-range and direct-minute modes to manual entry
- validate direct duration as an integer from 1 to 1,440 minutes
- preserve selected mode and category after saving
- display direct records without fabricated start or end times
- keep existing dashboard and statistics aggregation unchanged
- add responsive and regression coverage
```

- [ ] **Step 5: Confirm PR CI and merge to development**

Expected: the repository `CI` workflow passes. Merge only after reviewing the patch.

- [ ] **Step 6: Perform a development smoke test**

On the development version, verify:

1. `시작·종료 시각` is selected by default.
2. Switching to `분 직접 입력` hides start/end fields.
3. Entering `30` saves a history row containing `직접 입력 · 30분`.
4. The selected category and duration mode remain after save.
5. The duration and note fields reset after save.
6. Dashboard, weekly, monthly, and yearly statistics increase by 30 minutes.
7. Values `0`, `1.5`, and `1441` are rejected.
8. A 360px viewport has no page-wide horizontal scrollbar.
9. Existing start/end manual entry still saves correctly.

- [ ] **Step 7: Release to the live GitHub Pages site after approval**

Open a release PR from `agent/build-mvp` to `main` with title:

```text
release: add direct minute manual entry
```

After the release PR CI passes, merge it. Confirm `Deploy GitHub Pages` succeeds and smoke-test the live URL:

```text
https://liondaniel79.github.io/weekly-time-budget/
```

The release is complete only after Google login, one direct-minute save, history display, and statistics reflection are verified on the live site.
