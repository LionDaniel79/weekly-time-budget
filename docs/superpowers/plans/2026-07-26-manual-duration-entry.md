# Manual Duration Entry Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a second manual-entry mode that records an integer number of minutes without start or end times while preserving the existing time-range mode and all current statistics behavior.

**Architecture:** Put duration validation, payload construction, and history-label formatting in a small pure module so the rules can be tested without Firebase or the DOM. Keep rendering, session-only mode/category state, Firestore writes, and event binding in `src/app.js`. Reuse `durationMinutes`, `date`, and `categoryId`, so dashboard and statistics calculations require no changes.

**Tech Stack:** Vanilla HTML/CSS/JavaScript, ES modules, Node.js built-in test runner, Firebase Authentication, Cloud Firestore, GitHub Actions, GitHub Pages.

## Global Constraints

- Existing timer behavior must not change.
- Existing manual start/end time behavior remains the default.
- Direct duration accepts integers from 1 through 1,440 minutes inclusive.
- Invalid direct values use exactly: `기록 시간은 1분 이상 1,440분 이하의 정수로 입력하세요.`
- Direct duration records use `source: 'manual-duration'` and omit `startTime` and `endTime`.
- Selected manual mode and category persist only in the current browser session.
- After saving, selected mode and category remain; duration and note fields reset.
- Direct records participate in all existing statistics without changing statistics formulas.
- History text is `직접 입력 · <formatted duration>`.
- The form must not create page-wide horizontal scrolling at 360px.
- Start from `agent/build-mvp` on `agent/manual-duration-entry`.
- Merge to `agent/build-mvp` only after full CI passes; release to `main` only after review.

---

## File Map

- Create `src/manual-entry.js`: mode constants, duration validation, payload creation, history label.
- Create `tests/manual-duration-entry.test.js`: pure behavior and responsive CSS contracts.
- Modify `src/app.js`: state, mode buttons, conditional fields, save paths, history label.
- Modify `tests/ui-contract.test.js`: integration source contracts.
- Modify `styles.css`: two-button switch and duration input layout.
- Do not modify `src/domain.js`, statistics modules, Firestore rules, or existing stored records.

---

### Task 1: Add Pure Manual-Duration Rules

**Files:**
- Create: `src/manual-entry.js`
- Create: `tests/manual-duration-entry.test.js`

**Interfaces:**
- Produces `MANUAL_INPUT_MODES`.
- Produces `MANUAL_DURATION_ERROR: string`.
- Produces `parseManualDurationMinutes(value: unknown): number`.
- Produces `createManualDurationEntry(input): object`.
- Produces `manualEntryTimeLabel(entry, formatMinutes): string`.

- [ ] **Step 1: Write the failing tests**

Create `tests/manual-duration-entry.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  MANUAL_DURATION_ERROR,
  MANUAL_INPUT_MODES,
  createManualDurationEntry,
  manualEntryTimeLabel,
  parseManualDurationMinutes,
} from '../src/manual-entry.js';

const formatMinutes = (minutes) => `${minutes}분`;

test('manual modes expose time-range and duration values', () => {
  assert.deepEqual(MANUAL_INPUT_MODES, {
    TIME_RANGE: 'time-range',
    DURATION: 'duration',
  });
});

test('direct minutes accept inclusive integer boundaries', () => {
  assert.equal(parseManualDurationMinutes('1'), 1);
  assert.equal(parseManualDurationMinutes('30'), 30);
  assert.equal(parseManualDurationMinutes('1440'), 1440);
});

test('direct minutes reject invalid values with one message', () => {
  for (const value of ['', '0', '-1', '1.5', '1441', 'abc', null, undefined]) {
    assert.throws(
      () => parseManualDurationMinutes(value),
      (error) => error instanceof RangeError && error.message === MANUAL_DURATION_ERROR,
    );
  }
});

test('direct payload omits start and end times', () => {
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

test('history label covers direct, timed, and legacy records', () => {
  assert.equal(
    manualEntryTimeLabel({ source: 'manual-duration', durationMinutes: 30 }, formatMinutes),
    '직접 입력 · 30분',
  );
  assert.equal(
    manualEntryTimeLabel(
      { startTime: '09:00', endTime: '10:00', durationMinutes: 60 },
      formatMinutes,
    ),
    '09:00–10:00 · 60분',
  );
  assert.equal(manualEntryTimeLabel({ durationMinutes: 15 }, formatMinutes), '15분');
});
```

- [ ] **Step 2: Verify the test fails**

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

- [ ] **Step 4: Verify green**

```bash
node --test tests/manual-duration-entry.test.js
node --check src/manual-entry.js
```

Expected: PASS and exit 0.

- [ ] **Step 5: Commit**

```bash
git add src/manual-entry.js tests/manual-duration-entry.test.js
git commit -m "feat: add manual duration entry rules"
```

---

### Task 2: Add the Mode Switch and Session State

**Files:**
- Modify: `src/app.js`
- Modify: `tests/ui-contract.test.js`

**Interfaces:**
- Consumes `MANUAL_INPUT_MODES` from Task 1.
- Produces `state.manualInputMode` and `state.manualCategoryId`.
- Produces `[data-manual-mode]` controls and `#manual-duration`.

- [ ] **Step 1: Add failing UI contracts**

Append to `tests/ui-contract.test.js`:

```js
test('수동 입력은 시각 범위와 분 직접 입력 방식을 제공한다', async () => {
  const appSource = await read('src/app.js');
  assert.match(appSource, /manualInputMode:\s*MANUAL_INPUT_MODES\.TIME_RANGE/);
  assert.match(appSource, /manualCategoryId:\s*''/);
  assert.match(appSource, /data-manual-mode="time-range"/);
  assert.match(appSource, /data-manual-mode="duration"/);
  assert.match(appSource, /시작·종료 시각/);
  assert.match(appSource, /분 직접 입력/);
  assert.match(appSource, /id="manual-duration"/);
  assert.match(appSource, /<form id="manual-form" class="form-grid" novalidate>/);
});

test('방식 변경은 대분류를 유지하고 선택한 필드만 다시 그린다', async () => {
  const appSource = await read('src/app.js');
  assert.match(appSource, /state\.manualCategoryId\s*=\s*\$\('#manual-category'\)\?\.value/);
  assert.match(appSource, /state\.manualInputMode\s*=\s*button\.dataset\.manualMode/);
  assert.match(appSource, /state\.manualInputMode\s*===\s*MANUAL_INPUT_MODES\.DURATION/);
  assert.match(appSource, /class="time-fields"/);
  assert.match(appSource, /class="duration-input-row"/);
  assert.match(appSource, /renderRecord\(\)/);
});
```

- [ ] **Step 2: Verify red**

```bash
node --test tests/ui-contract.test.js
```

Expected: FAIL because the state and controls are absent.

- [ ] **Step 3: Import the new module and extend state**

Add to `src/app.js`:

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

Do not persist these fields to Firestore or local storage.

- [ ] **Step 4: Render both modes conditionally**

Replace `manualForm()` with this shape:

```js
function manualForm() {
  const now = new Date();
  const end = now.toTimeString().slice(0, 5);
  const startDate = new Date(now.getTime() - 60 * 60 * 1000);
  const start = startDate.toTimeString().slice(0, 5);
  const durationMode = state.manualInputMode === MANUAL_INPUT_MODES.DURATION;

  return `
    <form id="manual-form" class="form-grid" novalidate>
      <div class="manual-mode-switch" role="group" aria-label="수동 입력 방식">
        <button type="button" class="tab-button ${durationMode ? '' : 'active'}"
          data-manual-mode="time-range" aria-pressed="${durationMode ? 'false' : 'true'}">
          시작·종료 시각
        </button>
        <button type="button" class="tab-button ${durationMode ? 'active' : ''}"
          data-manual-mode="duration" aria-pressed="${durationMode ? 'true' : 'false'}">
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
              <input id="manual-duration" type="number" min="1" max="1440"
                step="1" inputmode="numeric" autocomplete="off" required>
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

`novalidate` ensures empty, decimal, and out-of-range values reach the common JavaScript validation message.

- [ ] **Step 5: Bind mode buttons before submit binding**

At the start of `bindManual()`:

```js
document.querySelectorAll('[data-manual-mode]').forEach((button) => {
  button.onclick = () => {
    state.manualCategoryId = $('#manual-category')?.value || state.manualCategoryId;
    state.manualInputMode = button.dataset.manualMode;
    renderRecord();
  };
});
```

- [ ] **Step 6: Verify green and commit**

```bash
node --test tests/ui-contract.test.js
node --check src/app.js
git add src/app.js tests/ui-contract.test.js
git commit -m "feat: add manual entry mode switch"
```

---

### Task 3: Save Direct Minutes and Format History

**Files:**
- Modify: `src/app.js`
- Modify: `tests/ui-contract.test.js`

**Interfaces:**
- Consumes `createManualDurationEntry()` and `manualEntryTimeLabel()`.
- Produces direct Firestore entries without time fields.
- Preserves selected category and mode after either save path.

- [ ] **Step 1: Add failing integration contracts**

Append to `tests/ui-contract.test.js`:

```js
test('분 직접 입력은 별도 source로 저장하고 오류 문구를 표시한다', async () => {
  const appSource = await read('src/app.js');
  assert.match(appSource, /createManualDurationEntry\(\{/);
  assert.match(appSource, /durationMinutes:\s*\$\('#manual-duration'\)\.value/);
  assert.match(appSource, /state\.manualCategoryId\s*=\s*categoryId/);
  assert.match(appSource, /alert\(error instanceof Error \? error\.message : String\(error\)\)/);
});

test('기존 시각 방식은 빈 시각과 잘못된 범위를 검사한다', async () => {
  const appSource = await read('src/app.js');
  assert.match(appSource, /if \(!startTime \|\| !endTime\)/);
  assert.match(appSource, /minutesBetween\(startTime, endTime\)/);
  assert.match(appSource, /시간 범위를 확인하세요/);
});

test('기록 내역은 공통 formatter를 사용한다', async () => {
  const appSource = await read('src/app.js');
  assert.match(appSource, /manualEntryTimeLabel\(entry,\s*formatMinutes\)/);
  assert.doesNotMatch(appSource, /\$\{entry\.startTime \|\| ''\}–\$\{entry\.endTime \|\| ''\}/);
});
```

- [ ] **Step 2: Verify red**

```bash
node --test tests/ui-contract.test.js tests/manual-duration-entry.test.js
```

Expected: UI contracts FAIL.

- [ ] **Step 3: Split submit handling by mode**

Use this body for `#manual-form.onsubmit`:

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
      await saveEntry(createManualDurationEntry({
        categoryId,
        date,
        note: $('#manual-note').value,
        durationMinutes: $('#manual-duration').value,
      }));
    } catch (error) {
      alert(error instanceof Error ? error.message : String(error));
    }
    return;
  }

  const startTime = $('#manual-start').value;
  const endTime = $('#manual-end').value;
  if (!startTime || !endTime) return alert('시작과 종료 시간을 입력하세요.');

  const durationMinutes = minutesBetween(startTime, endTime);
  if (durationMinutes <= 0 || durationMinutes > 1440) {
    return alert('시간 범위를 확인하세요.');
  }

  await saveEntry({
    categoryId,
    note: $('#manual-note').value.trim(),
    date,
    durationMinutes,
    startTime,
    endTime,
    source: 'manual',
  });
};
```

Because `saveEntry()` reloads and rerenders, mode and category remain in state while duration and note fields are recreated empty.

- [ ] **Step 4: Format history through the helper**

Inside each history entry render:

```js
const timeDescription = manualEntryTimeLabel(entry, formatMinutes);
```

Replace the old time-range interpolation with:

```js
<div>${escapeHtml(timeDescription)}</div>
```

- [ ] **Step 5: Verify green and commit**

```bash
node --test tests/manual-duration-entry.test.js tests/ui-contract.test.js
node --check src/manual-entry.js
node --check src/app.js
git add src/app.js tests/ui-contract.test.js
git commit -m "feat: save direct manual minutes"
```

---

### Task 4: Make the Controls Mobile-Safe

**Files:**
- Modify: `styles.css`
- Modify: `tests/manual-duration-entry.test.js`

**Interfaces:**
- Produces `.manual-mode-switch` and `.duration-input-row` responsive rules.

- [ ] **Step 1: Add the failing CSS contract**

Append to `tests/manual-duration-entry.test.js`:

```js
test('manual duration controls stay within the mobile viewport', async () => {
  const css = await readFile(new URL('../styles.css', import.meta.url), 'utf8');
  assert.match(css, /\.manual-mode-switch\s*\{[^}]*display\s*:\s*grid/s);
  assert.match(css, /grid-template-columns\s*:\s*repeat\(2,minmax\(0,1fr\)\)/);
  assert.match(css, /\.manual-mode-switch \.tab-button\s*\{[^}]*min-width\s*:\s*0/s);
  assert.match(css, /\.duration-input-row\s*\{[^}]*display\s*:\s*grid/s);
  assert.match(css, /grid-template-columns\s*:\s*minmax\(0,1fr\) auto/);
  assert.match(css, /@media\(max-width:360px\)/);
});
```

- [ ] **Step 2: Verify red**

```bash
node --test tests/manual-duration-entry.test.js
```

Expected: FAIL because the selectors do not exist.

- [ ] **Step 3: Add the styles**

Add near `.tabs` and `.time-fields`:

```css
.manual-mode-switch{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}.manual-mode-switch .tab-button{min-width:0;width:100%;white-space:normal}.duration-input-row{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:10px;align-items:center}.duration-input-row span{font-weight:800;white-space:nowrap}
```

Add after the existing mobile rule:

```css
@media(max-width:360px){.manual-mode-switch{gap:6px}.manual-mode-switch .tab-button{padding:9px 8px;font-size:.9rem}.duration-input-row{gap:8px}}
```

- [ ] **Step 4: Verify green and commit**

```bash
node --test tests/manual-duration-entry.test.js tests/mobile-statistics-layout.test.js
git add styles.css tests/manual-duration-entry.test.js
git commit -m "style: fit manual duration controls on mobile"
```

---

### Task 5: Full Regression, PR, and Live Release

**Files:**
- Review all Task 1–4 files.

**Interfaces:**
- Produces a reviewed feature PR to `agent/build-mvp`, then an approved release PR to `main`.

- [ ] **Step 1: Run full verification**

```bash
npm test
node --check src/manual-entry.js
node --check src/app.js
```

Expected: 0 failures and both syntax checks exit 0.

- [ ] **Step 2: Review the diff**

```bash
git diff agent/build-mvp...HEAD -- src/manual-entry.js src/app.js styles.css tests/manual-duration-entry.test.js tests/ui-contract.test.js
```

Verify:

- Existing `source: 'manual'` payload stays compatible.
- Direct payload has no `startTime` or `endTime`.
- Statistics formulas and Firestore rules are untouched.
- State fields are session-only.
- No Firebase configuration value appears.

- [ ] **Step 3: Open the feature PR**

Title:

```text
feat: add direct minute manual entry
```

Body:

```markdown
- add time-range and direct-minute manual modes
- validate integer durations from 1 to 1,440 minutes
- retain selected mode and category after save
- display direct records without fabricated times
- preserve existing dashboard and statistics aggregation
- add responsive and regression coverage
```

- [ ] **Step 4: Confirm CI and merge to `agent/build-mvp`**

Expected: repository `CI` passes. Review the patch before merging.

- [ ] **Step 5: Smoke-test the development build**

Verify all nine cases:

1. Time-range mode is the default.
2. Duration mode hides start/end fields.
3. `30` saves as `직접 입력 · 30분`.
4. Mode and category remain after save.
5. Duration and note reset after save.
6. Dashboard and weekly/monthly/yearly statistics increase by 30 minutes.
7. `0`, `1.5`, and `1441` show the common validation message.
8. 360px has no page-wide horizontal scrollbar.
9. Existing start/end entry still saves correctly.

- [ ] **Step 6: Release after approval**

Open `agent/build-mvp` → `main` with title:

```text
release: add direct minute manual entry
```

After CI passes, merge and confirm `Deploy GitHub Pages` succeeds. Smoke-test:

```text
https://liondaniel79.github.io/weekly-time-budget/
```

The release is complete only after Google login, one direct-minute save, history display, and statistics reflection are verified on the live site.
