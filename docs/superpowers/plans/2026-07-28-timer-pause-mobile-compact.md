# Persistent Timer Pause and Mobile Compact UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a persistent pause/resume lifecycle to the timer and make the requested mobile UI and category-button text changes.

**Architecture:** Extend the existing focused timer domain/controller in `src/persistent-timer.js`, then expose pause/resume through the existing persistent timer UI adapter. Keep mobile changes in `styles.css`, keep the category copy change in `src/category-bulk-editor.js`, and bump the PWA shell cache so installed clients receive the changes.

**Tech Stack:** Vanilla JavaScript ES modules, Firebase Firestore 11.10.0, localStorage, Node.js built-in test runner, GitHub Pages PWA.

## Global Constraints

- Preserve all existing timer records and automatically normalize legacy active-timer snapshots.
- Persist pause/resume state to both localStorage and Firestore `users/{uid}/activeTimer/current`.
- Exclude paused time from saved duration.
- Keep current offline-first behavior and cross-device recovery.
- Do not restructure unrelated application files.
- Mobile history dates and the top-right `메뉴` label must remain on one line.
- Change only the final category bulk action label to `저장`.
- Update the service-worker shell cache to `weekly-time-budget-shell-v7`.

---

### Task 1: Timer pause/resume domain and controller

**Files:**
- Modify: `src/persistent-timer.js`
- Modify: `tests/persistent-timer.test.js`

**Interfaces:**
- Produces: `normalizeTimerSnapshot(timer)`, `elapsedMilliseconds(timer, now)`, controller methods `pause()` and `resume()` returning `{ timer, remotePending }`.
- Consumes: existing `remote.get`, `remote.set`, `remote.remove`, `complete`, localStorage adapter, `now()` clock.

- [ ] **Step 1: Write failing domain tests**

Add tests that assert:

```js
const legacy = normalizeTimerSnapshot({ userId: 'u1', categoryId: 'work', startedAt: 1000, running: true });
assert.equal(legacy.accumulatedMs, 0);
assert.equal(legacy.resumedAt, 1000);
assert.equal(legacy.stateChangedAt, 1000);

assert.equal(elapsedMilliseconds({ startedAt: 1000, resumedAt: 2000, accumulatedMs: 3000, running: true }, 7000), 8000);
assert.equal(elapsedMilliseconds({ startedAt: 1000, accumulatedMs: 3000, running: false }, 7000), 3000);
```

- [ ] **Step 2: Write failing controller tests**

Use a controllable clock and remote adapter with `update()` to verify:

```js
await controller.start({ userId: 'u1', categoryId: 'work' });
clock = 61_000;
await controller.pause();
assert.equal(controller.active.running, false);
assert.equal(controller.elapsedSeconds(), 60);
clock = 121_000;
assert.equal(controller.elapsedSeconds(), 60);
await controller.resume();
clock = 181_000;
assert.equal(controller.elapsedSeconds(), 120);
```

Also verify stop after pause stores only active elapsed time, local-newer recovery wins using `stateChangedAt`, retryable update failure keeps local state, and non-retryable failure rolls back.

- [ ] **Step 3: Run tests to verify RED**

Run: `npm test -- --test-name-pattern="타이머|일시정지|계속"`

Expected: FAIL because normalization, elapsed-millisecond calculation, `pause`, `resume`, and remote `update` support do not exist.

- [ ] **Step 4: Implement minimal timer model**

Implement:

```js
export function normalizeTimerSnapshot(timer) { /* legacy-safe normalized copy */ }
export function elapsedMilliseconds(timer, now = Date.now()) { /* accumulated + current segment */ }
```

Make `elapsedSeconds()` delegate to `elapsedMilliseconds()`.

- [ ] **Step 5: Implement controller persistence**

Add an internal state transition helper that writes local first, calls `remote.update(next)`, returns `remotePending: true` for retryable errors, and restores the previous local/active state for non-retryable errors. Add `pause()` and `resume()` and make `stop()` use accumulated active time.

During `recover()`, normalize both snapshots and choose the newer `stateChangedAt`; when local is newer, call `remote.update(local)`.

- [ ] **Step 6: Run timer tests to verify GREEN**

Run: `npm test -- --test-name-pattern="타이머|일시정지|계속"`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/persistent-timer.js tests/persistent-timer.test.js
git commit -m "feat: persist timer pause and resume"
```

### Task 2: Timer pause/resume user interface

**Files:**
- Modify: `src/persistent-timer-ui.js`
- Create: `tests/persistent-timer-pause-ui.test.js`

**Interfaces:**
- Consumes: controller `active.running`, `pause()`, `resume()`, `elapsedSeconds()`.
- Produces: buttons `#timer-pause`, `#timer-action`, and `#timer-cancel` with capture-phase handlers.

- [ ] **Step 1: Write failing UI contract tests**

Assert the source includes:

```js
id="timer-pause"
active.running ? '멈춤' : '계속'
state.controller.pause()
state.controller.resume()
```

Assert `startDisplay()` creates an interval only when `active.running !== false` and that the Firestore adapter defines `update(timer)`.

- [ ] **Step 2: Run UI test to verify RED**

Run: `node --test tests/persistent-timer-pause-ui.test.js`

Expected: FAIL.

- [ ] **Step 3: Add Firestore update adapter and buttons**

Use `store.setDoc(activeRef, { ...timer, updatedAt: store.serverTimestamp() }, { merge: true })` for pause/resume updates. Render `멈춤` while running and `계속` while paused. Keep `종료하고 저장` and `취소` available in both states.

- [ ] **Step 4: Add pause/resume handler**

Capture `#timer-pause`, disable it during the transition, call the correct controller method, stop or restart the display interval, rerender, and show a queued toast when `remotePending` is true.

- [ ] **Step 5: Run UI test to verify GREEN**

Run: `node --test tests/persistent-timer-pause-ui.test.js`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/persistent-timer-ui.js tests/persistent-timer-pause-ui.test.js
git commit -m "feat: add timer pause controls"
```

### Task 3: Compact mobile history and keep mobile menu on one line

**Files:**
- Modify: `styles.css`
- Create: `tests/mobile-compact-ui.test.js`

**Interfaces:**
- Consumes: existing `.entry`, `.entry-actions`, `.mobile-menu`, `.topbar` markup.
- Produces: mobile-only layout rules under `@media(max-width:600px)`.

- [ ] **Step 1: Write failing CSS contract tests**

Assert the stylesheet contains mobile rules for:

```css
.entry { grid-template-columns: auto minmax(0,1fr) auto; }
.entry > strong:first-child { white-space: nowrap; }
.entry .entry-actions { grid-column: auto; }
.mobile-menu { white-space: nowrap; word-break: keep-all; flex-shrink: 0; }
.topbar > div { min-width: 0; }
```

Also assert reduced mobile `.entry` padding and note paragraph margins.

- [ ] **Step 2: Run test to verify RED**

Run: `node --test tests/mobile-compact-ui.test.js`

Expected: FAIL.

- [ ] **Step 3: Implement mobile CSS**

Add the exact mobile rules without changing desktop layout. Keep touch targets usable while reducing the history-row height.

- [ ] **Step 4: Run test to verify GREEN**

Run: `node --test tests/mobile-compact-ui.test.js`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add styles.css tests/mobile-compact-ui.test.js
git commit -m "fix: compact mobile history and menu"
```

### Task 4: Rename category bulk action and refresh PWA cache

**Files:**
- Modify: `src/category-bulk-editor.js`
- Modify: `service-worker.js`
- Modify: all tests that assert `weekly-time-budget-shell-v6`
- Create: `tests/category-save-copy.test.js`

**Interfaces:**
- Produces: category bulk button text `저장`; shell cache `weekly-time-budget-shell-v7`.

- [ ] **Step 1: Write failing copy test**

Assert `category-bulk-editor.js` contains:

```html
<button id="category-bulk-apply" type="button" class="primary-button">저장</button>
```

and does not contain the previous button label.

- [ ] **Step 2: Run copy test to verify RED**

Run: `node --test tests/category-save-copy.test.js`

Expected: FAIL.

- [ ] **Step 3: Change copy and cache version**

Replace the final bulk-action label only. Change `SHELL_CACHE` to `weekly-time-budget-shell-v7` and update every existing v6 assertion to v7.

- [ ] **Step 4: Run focused tests**

Run: `node --test tests/category-save-copy.test.js tests/offline-app-integration.test.js tests/recorded-period-navigation-integration.test.js tests/recorded-period-pages.test.js tests/statistics-offline-rescue.test.js tests/statistics-monthly-timer-resume-regression.test.js`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/category-bulk-editor.js service-worker.js tests
git commit -m "fix: rename category save action and refresh shell"
```

### Task 5: Full verification and delivery

**Files:**
- Review all changed files.

- [ ] **Step 1: Run JavaScript syntax checks**

Run: `node --check src/persistent-timer.js && node --check src/persistent-timer-ui.js && node --check src/category-bulk-editor.js && node --check service-worker.js`

Expected: exit status 0.

- [ ] **Step 2: Run full suite**

Run: `npm test`

Expected: all tests pass with zero failures.

- [ ] **Step 3: Verify Pages artifact**

Run: `npm run prepare:pages`

Expected: `_site` contains updated JavaScript, CSS, and `weekly-time-budget-shell-v7`.

- [ ] **Step 4: Review diff**

Confirm no unrelated application behavior changed and no legacy active timer can become unusable.

- [ ] **Step 5: Open PR, wait for CI, squash merge, and deploy**

Create a PR to `main`, require successful GitHub Actions CI, squash merge, and verify the merged files exist on `main`. The `main` push triggers the existing GitHub Pages deployment workflow.
