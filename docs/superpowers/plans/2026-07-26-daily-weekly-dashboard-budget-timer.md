# 일간·주간 대시보드, 시간 예산, 복구형 타이머 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 기록 날짜 중심의 일간·주간 대시보드, 오늘·이번 주 시간 예산 편집, 백그라운드·재시작 후 복구되는 단일 타이머를 기존 웹앱에 추가한다.

**Architecture:** 계산과 입력 의미는 `src/time-budget-domain.js`의 순수 함수로 고정하고, HTML 생성과 화면 상태는 `src/time-budget-ui.js`에 둔다. `src/app.js`는 Firebase 데이터 로딩·저장과 두 모듈의 연결을 담당하며, `src/persistent-timer.js`의 주입 가능한 컨트롤러가 Firestore와 localStorage를 조정한다. 기존 통계가 읽는 `weeklyBudgets.budgets`는 대분류별 유효 주간 예산의 완전한 스냅숏으로 유지하고, `explicitBudgetIds`로 빈칸과 명시적 0을 구분한다.

**Tech Stack:** ES modules, Firebase Authentication 11.10.0, Cloud Firestore 11.10.0, HTML/CSS, Node.js built-in test runner (`node --test`).

## Global Constraints

- 메뉴와 페이지 제목은 정확히 `시간 예산`으로 표시한다.
- 대시보드 기본 탭은 `일간`, 기본 날짜는 오늘이다.
- 일간 달력은 실제 기록이 있는 과거·오늘 날짜만 활성화하며 미래 날짜를 활성화하지 않는다.
- `전날`과 `다음날`은 하루 단위가 아니라 가장 가까운 기록 날짜로 이동하고, 이후 기록이 없으면 오늘로 이동한다.
- 주간 대시보드는 이번 주보다 미래로 이동하지 않는다.
- 시간 예산 화면은 `오늘 / 이번 주` 탭을 제공하고 두 탭 모두 하단 버튼 문구를 정확히 `저장`으로 한다.
- 오늘·이번 주 예산 입력은 시간 단위, 최소 0, 간격 0.5시간이다.
- 빈칸은 자동값, 숫자 0은 명시적 0시간으로 취급한다.
- 요일 비율은 모든 대분류에 공통으로 적용하고 입력 합계를 자동으로 100%로 정규화한다.
- 요일 비율을 한 번 저장하면 이후 주에 이월하되 과거 주는 저장 당시 스냅숏을 유지한다.
- 오늘 직접 예산은 같은 주의 주간 예산·비율 변경에도 유지하고 다음 주로 이월하지 않는다.
- 오늘 직접 예산은 일간 달성률만 바꾸며 주간 총예산을 자동 증감시키지 않는다.
- 사용자당 진행 중 타이머는 하나만 허용한다.
- 타이머는 백그라운드 JavaScript 실행에 의존하지 않고 절대 시작 시각으로 경과 시간을 복원한다.
- 새 런타임 의존성을 추가하지 않는다.
- 기존 기록 내역, 통계, 대분류 보관·삭제, 로그인 동작을 회귀시키지 않는다.
- 화면 폭 선택 버튼을 만들지 않고 360px 이상에서 가로 스크롤 없는 반응형 화면으로 구성한다.

---

## File Map

- Create: `src/time-budget-domain.js` — 비율 정규화, 주간 분배, 빈칸/0 파싱, 예산 우선순위, 기록 날짜 탐색.
- Create: `src/time-budget-ui.js` — 대시보드와 시간 예산 HTML, 사용자 정의 기록 날짜 달력, 화면 이벤트 바인딩.
- Create: `src/persistent-timer.js` — 타이머 직렬화, localStorage 복구, 원격 저장소를 주입받는 단일 타이머 컨트롤러.
- Create: `tests/time-budget-domain.test.js` — 예산·비율·날짜 탐색 순수 함수 테스트.
- Create: `tests/time-budget-ui.test.js` — 화면 문구, 달력 활성화, 미래 이동 제한, 빈칸/0 표시 계약 테스트.
- Create: `tests/persistent-timer.test.js` — 재시작·백그라운드·충돌·실패 복구 테스트.
- Create: `tests/time-budget-integration.test.js` — `app.js`, `index.html`, 통계, 삭제 처리, Firestore 경로 연결 계약 테스트.
- Modify: `src/app.js` — 상태 확장, Firestore 읽기·쓰기, 새 UI와 타이머 컨트롤러 연결.
- Modify: `index.html` — 메뉴명 변경과 새 모듈 로드.
- Modify: `styles.css` — 대시보드·예산·달력의 적응형 스타일.
- Modify: `src/category-delete-guard.js` — 완전 삭제 시 새 예산 문서와 활성 타이머에서 대분류 참조 제거.
- Modify only if a regression test proves necessary: `src/statistics-ui.js`, `src/domain.js` — 새 주간 스냅숏을 기존 통계가 그대로 읽도록 최소 호환 수정.
- Verify without changing unless required: `firestore.rules` — 현재 사용자 하위 wildcard 규칙이 신규 경로도 보호함을 계약 테스트로 확인.

---

### Task 1: 요일 비율과 빈칸·0 예산 의미를 순수 함수로 고정

**Files:**
- Create: `src/time-budget-domain.js`
- Create: `tests/time-budget-domain.test.js`

**Interfaces:**
- Produces: `DAY_KEYS`, `EQUAL_DAY_WEIGHTS`, `normalizeDayWeights(rawValues)`, `distributeWeeklyMinutes(totalMinutes, dayWeights)`, `parseOptionalHours(value)`, `buildWeeklyBudgetSnapshot(args)`, `resolveWeeklyBudgetMinutes(category, weekDocument)`, `resolveDailyBudget(args)`.
- Consumes: 대분류 객체 `{ id, name, defaultBudgetMinutes }`, 주간 문서 `{ budgets, explicitBudgetIds, dayWeights }`, 일간 문서 `{ overrides }`.

- [ ] **Step 1: 비율 정규화와 분 단위 합계 보정 실패 테스트 작성**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DAY_KEYS,
  normalizeDayWeights,
  distributeWeeklyMinutes,
} from '../src/time-budget-domain.js';

test('요일 상대값은 합계 100%로 정규화된다', () => {
  const weights = normalizeDayWeights({
    mon: 2, tue: 2, wed: 1, thu: 1, fri: 1, sat: 2, sun: 1,
  });
  assert.deepEqual(DAY_KEYS.map((key) => Math.round(weights[key] * 100)), [20, 20, 10, 10, 10, 20, 10]);
});

test('요일 값이 전부 비거나 0이면 균등 배분한다', () => {
  const weights = normalizeDayWeights({ mon: '', tue: 0, wed: '', thu: 0, fri: '', sat: 0, sun: '' });
  assert.equal(Math.round(Object.values(weights).reduce((sum, value) => sum + value, 0) * 1_000_000), 1_000_000);
  assert.deepEqual(DAY_KEYS.map((key) => Math.round(weights[key] * 700)), [100, 100, 100, 100, 100, 100, 100]);
});

test('요일별 자동 예산 합계는 주간 총분과 정확히 같다', () => {
  const weights = normalizeDayWeights({ mon: 2, tue: 2, wed: 1, thu: 1, fri: 1, sat: 2, sun: 1 });
  const result = distributeWeeklyMinutes(421, weights);
  assert.equal(Object.values(result).reduce((sum, value) => sum + value, 0), 421);
  assert.deepEqual(DAY_KEYS.map((key) => result[key]), [84, 84, 42, 42, 42, 84, 43]);
});
```

- [ ] **Step 2: 새 도메인 테스트가 모듈 부재로 실패하는지 확인**

Run: `node --test tests/time-budget-domain.test.js`

Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `src/time-budget-domain.js`.

- [ ] **Step 3: 비율 상수와 정규화·분배 최소 구현 작성**

```js
export const DAY_KEYS = Object.freeze(['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']);

export const EQUAL_DAY_WEIGHTS = Object.freeze(
  Object.fromEntries(DAY_KEYS.map((key) => [key, 1 / DAY_KEYS.length])),
);

export function normalizeDayWeights(rawValues = {}) {
  const values = Object.fromEntries(DAY_KEYS.map((key) => {
    const value = Number(rawValues[key]);
    if (Number.isFinite(value) && value < 0) throw new Error('요일 비율은 0 이상이어야 합니다.');
    return [key, Number.isFinite(value) && value > 0 ? value : 0];
  }));
  const total = Object.values(values).reduce((sum, value) => sum + value, 0);
  if (!total) return { ...EQUAL_DAY_WEIGHTS };
  return Object.fromEntries(DAY_KEYS.map((key) => [key, values[key] / total]));
}

export function distributeWeeklyMinutes(totalMinutes, dayWeights) {
  const total = Math.max(0, Math.round(Number(totalMinutes) || 0));
  let assigned = 0;
  return Object.fromEntries(DAY_KEYS.map((key, index) => {
    const minutes = index === DAY_KEYS.length - 1
      ? total - assigned
      : Math.round(total * Number(dayWeights[key] || 0));
    assigned += minutes;
    return [key, minutes];
  }));
}
```

- [ ] **Step 4: 비율 테스트 통과 확인**

Run: `node --test tests/time-budget-domain.test.js`

Expected: 3 tests PASS.

- [ ] **Step 5: 빈칸·0·0.5시간 단위 실패 테스트 추가**

```js
import { parseOptionalHours } from '../src/time-budget-domain.js';

test('빈칸과 명시적 0시간을 구분한다', () => {
  assert.deepEqual(parseOptionalHours(''), { explicit: false, minutes: null });
  assert.deepEqual(parseOptionalHours('0'), { explicit: true, minutes: 0 });
  assert.deepEqual(parseOptionalHours('1.5'), { explicit: true, minutes: 90 });
  assert.throws(() => parseOptionalHours('-0.5'), /0 이상/);
  assert.throws(() => parseOptionalHours('1.25'), /0.5시간 단위/);
});
```

- [ ] **Step 6: 입력 파서 최소 구현 및 테스트 실행**

```js
export function parseOptionalHours(value) {
  if (value === '' || value === null || value === undefined) {
    return { explicit: false, minutes: null };
  }
  const hours = Number(value);
  if (!Number.isFinite(hours) || hours < 0) throw new Error('예산은 0 이상이어야 합니다.');
  if (!Number.isInteger(hours * 2)) throw new Error('예산은 0.5시간 단위로 입력하세요.');
  return { explicit: true, minutes: Math.round(hours * 60) };
}
```

Run: `node --test tests/time-budget-domain.test.js`

Expected: all tests PASS.

- [ ] **Step 7: 주간 스냅숏과 일간 우선순위 실패 테스트 추가**

```js
import {
  buildWeeklyBudgetSnapshot,
  resolveDailyBudget,
  resolveWeeklyBudgetMinutes,
} from '../src/time-budget-domain.js';

test('주간 스냅숏은 유효 예산 전체와 명시 입력 ID를 함께 저장한다', () => {
  const snapshot = buildWeeklyBudgetSnapshot({
    weekStart: '2026-07-20',
    categories: [
      { id: 'reading', defaultBudgetMinutes: 420 },
      { id: 'thesis', defaultBudgetMinutes: 900 },
    ],
    budgetInputs: { reading: '', thesis: '0' },
    dayWeightInputs: { mon: 2, tue: 2, wed: 1, thu: 1, fri: 1, sat: 2, sun: 1 },
  });
  assert.deepEqual(snapshot.budgets, { reading: 420, thesis: 0 });
  assert.deepEqual(snapshot.explicitBudgetIds, ['thesis']);
  assert.equal(resolveWeeklyBudgetMinutes({ id: 'reading', defaultBudgetMinutes: 999 }, snapshot), 420);
});

test('일간 직접 설정은 자동 요일 예산보다 우선하고 0도 유지한다', () => {
  const category = { id: 'reading', defaultBudgetMinutes: 420 };
  const week = buildWeeklyBudgetSnapshot({
    weekStart: '2026-07-20',
    categories: [category],
    budgetInputs: { reading: '' },
    dayWeightInputs: { mon: 2, tue: 2, wed: 1, thu: 1, fri: 1, sat: 2, sun: 1 },
  });
  assert.deepEqual(resolveDailyBudget({ date: '2026-07-20', category, weekDocument: week, dailyDocument: null }), {
    minutes: 84,
    source: 'day-weight',
  });
  assert.deepEqual(resolveDailyBudget({
    date: '2026-07-20', category, weekDocument: week,
    dailyDocument: { overrides: { reading: 0 } },
  }), { minutes: 0, source: 'direct' });
});
```

- [ ] **Step 8: 스냅숏·예산 우선순위 구현 및 테스트 실행**

Implementation requirements:

```js
export function buildWeeklyBudgetSnapshot({
  weekStart,
  categories,
  budgetInputs = {},
  dayWeightInputs = {},
}) {
  const explicitBudgetIds = [];
  const budgets = Object.fromEntries(categories.map((category) => {
    const parsed = parseOptionalHours(budgetInputs[category.id]);
    if (parsed.explicit) explicitBudgetIds.push(category.id);
    return [category.id, parsed.explicit ? parsed.minutes : Number(category.defaultBudgetMinutes || 0)];
  }));
  return {
    weekStart,
    budgets,
    explicitBudgetIds,
    dayWeights: normalizeDayWeights(dayWeightInputs),
  };
}
```

Add `dayKeyForDate(date)` using Monday index 0, then use `distributeWeeklyMinutes()` inside `resolveDailyBudget()`; check `Object.hasOwn(dailyDocument?.overrides || {}, category.id)` so an override value of `0` is not mistaken for absence.

Run: `node --test tests/time-budget-domain.test.js`

Expected: all tests PASS.

- [ ] **Step 9: Task 1 commit**

```bash
git add src/time-budget-domain.js tests/time-budget-domain.test.js
git commit -m "feat: add time budget calculation domain"
```

---

### Task 2: 기록 날짜 탐색과 일간 요약 계산 추가

**Files:**
- Modify: `src/time-budget-domain.js`
- Modify: `tests/time-budget-domain.test.js`

**Interfaces:**
- Produces: `recordedDateKeys(entries, today)`, `previousRecordedDate(recordDates, selectedDate)`, `nextRecordedDateOrToday(recordDates, selectedDate, today)`, `calendarMonthCells(year, month, recordedDates, today)`, `summarizeDailyCategories(args)`.
- Consumes: Task 1의 `resolveDailyBudget()`.

- [ ] **Step 1: 가장 가까운 기록 날짜 이동 실패 테스트 작성**

```js
import {
  recordedDateKeys,
  previousRecordedDate,
  nextRecordedDateOrToday,
} from '../src/time-budget-domain.js';

test('전날과 다음날은 가장 가까운 기록 날짜로 이동한다', () => {
  const dates = recordedDateKeys([
    { date: '2026-07-20' },
    { date: '2026-07-20' },
    { date: '2026-07-24' },
    { date: '2026-07-26' },
    { date: '2026-07-27' },
  ], '2026-07-26');
  assert.deepEqual(dates, ['2026-07-20', '2026-07-24', '2026-07-26']);
  assert.equal(previousRecordedDate(dates, '2026-07-26'), '2026-07-24');
  assert.equal(nextRecordedDateOrToday(dates, '2026-07-20', '2026-07-26'), '2026-07-24');
  assert.equal(nextRecordedDateOrToday(dates, '2026-07-24', '2026-07-26'), '2026-07-26');
  assert.equal(nextRecordedDateOrToday(dates, '2026-07-26', '2026-07-26'), null);
});
```

- [ ] **Step 2: 실패 확인**

Run: `node --test tests/time-budget-domain.test.js`

Expected: FAIL because navigation exports are missing.

- [ ] **Step 3: 정렬·중복 제거·미래 제외 구현**

```js
export function recordedDateKeys(entries, today) {
  return [...new Set(entries.map((entry) => entry.date).filter((date) => date && date <= today))].sort();
}

export function previousRecordedDate(recordDates, selectedDate) {
  return [...recordDates].reverse().find((date) => date < selectedDate) || null;
}

export function nextRecordedDateOrToday(recordDates, selectedDate, today) {
  if (selectedDate >= today) return null;
  return recordDates.find((date) => date > selectedDate) || today;
}
```

Run: `node --test tests/time-budget-domain.test.js`

Expected: PASS.

- [ ] **Step 4: 기록 날짜만 활성화하는 달력 셀 실패 테스트 작성**

```js
import { calendarMonthCells } from '../src/time-budget-domain.js';

test('달력은 기록 날짜만 활성화하고 미래 날짜를 막는다', () => {
  const cells = calendarMonthCells(2026, 7, new Set(['2026-07-20', '2026-07-24', '2026-07-27']), '2026-07-26');
  assert.equal(cells.find((cell) => cell.date === '2026-07-20').enabled, true);
  assert.equal(cells.find((cell) => cell.date === '2026-07-21').enabled, false);
  assert.equal(cells.find((cell) => cell.date === '2026-07-27').enabled, false);
});
```

- [ ] **Step 5: 월요일 시작 6주 달력 셀 구현 및 테스트 실행**

Implementation requirements:

- 반환값은 42개 셀이다.
- 각 셀은 `{ date, day, inMonth, enabled, isToday }` 형태다.
- `enabled`는 `inMonth && date <= today && recordedDates.has(date)`일 때만 true다.
- 날짜 문자열 생성은 로컬 날짜를 사용해 UTC 변환으로 하루가 밀리지 않게 한다.

Run: `node --test tests/time-budget-domain.test.js`

Expected: PASS.

- [ ] **Step 6: 일간 대분류 요약 실패 테스트 작성**

```js
import { summarizeDailyCategories } from '../src/time-budget-domain.js';

test('일간 요약은 직접·자동 예산 출처와 보관 대분류 기록을 함께 표시한다', () => {
  const result = summarizeDailyCategories({
    date: '2026-07-20',
    categories: [
      { id: 'reading', name: '독서', defaultBudgetMinutes: 420 },
      { id: 'old', name: '과거 사역', defaultBudgetMinutes: 0, archived: true },
    ],
    entries: [
      { categoryId: 'reading', date: '2026-07-20', durationMinutes: 90 },
      { categoryId: 'old', date: '2026-07-20', durationMinutes: 30 },
    ],
    weekDocument: {
      budgets: { reading: 420, old: 0 },
      dayWeights: normalizeDayWeights({ mon: 1, tue: 1, wed: 1, thu: 1, fri: 1, sat: 1, sun: 1 }),
    },
    dailyDocument: { overrides: { reading: 120 } },
  });
  assert.deepEqual(result.categorySummaries.map(({ id, budgetMinutes, actualMinutes, budgetSource }) => ({ id, budgetMinutes, actualMinutes, budgetSource })), [
    { id: 'reading', budgetMinutes: 120, actualMinutes: 90, budgetSource: 'direct' },
    { id: 'old', budgetMinutes: 0, actualMinutes: 30, budgetSource: 'day-weight' },
  ]);
  assert.equal(result.totalBudgetMinutes, 120);
  assert.equal(result.totalActualMinutes, 120);
  assert.equal(result.percentage, 100);
});
```

- [ ] **Step 7: 일간 요약 구현 및 전체 도메인 테스트 실행**

Use the existing `calculateAchievement()` behavior from `src/domain.js` or reproduce the same status shape without changing its public contract. Include a category when it is active, has a positive budget, or has actual minutes on the selected date.

Run: `node --test tests/time-budget-domain.test.js tests/domain.test.js`

Expected: both files PASS.

- [ ] **Step 8: Task 2 commit**

```bash
git add src/time-budget-domain.js tests/time-budget-domain.test.js
git commit -m "feat: add recorded date navigation and daily summaries"
```

---

### Task 3: Firestore 상태와 주간·일간 예산 저장 연결

**Files:**
- Modify: `src/app.js:17-185`
- Create: `tests/time-budget-integration.test.js`

**Interfaces:**
- Consumes: `buildWeeklyBudgetSnapshot()`, `normalizeDayWeights()`, `EQUAL_DAY_WEIGHTS`.
- Produces inside `app.js`: `weeklyBudgetFor(weekStart)`, `dailyBudgetFor(date)`, `ensureCurrentWeekSnapshot()`, `saveDailyBudgetOverrides(inputs)`, `saveCurrentWeekBudget({ budgetInputs, dayWeightInputs })`.
- State additions: `archivedCategories`, `weeklyBudgets`, `dailyBudgets`, `timeBudgetSettings`.

- [ ] **Step 1: 신규 Firestore 경로와 상태 계약 실패 테스트 작성**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('앱은 시간 예산에 필요한 전체 사용자 데이터를 로드한다', async () => {
  const source = await read('src/app.js');
  for (const token of [
    "'archivedCategories'",
    "'weeklyBudgets'",
    "'dailyBudgets'",
    "'settings', 'timeBudget'",
  ]) assert.match(source, new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(source, /weeklyBudgets:\s*\[\]/);
  assert.match(source, /dailyBudgets:\s*\[\]/);
  assert.match(source, /timeBudgetSettings:/);
});
```

- [ ] **Step 2: 실패 확인**

Run: `node --test tests/time-budget-integration.test.js`

Expected: FAIL because state and collection reads are absent.

- [ ] **Step 3: `state`와 `loadData()` 확장**

Add imports from `time-budget-domain.js`, then change state to include:

```js
archivedCategories: [],
weeklyBudgets: [],
dailyBudgets: [],
timeBudgetSettings: { defaultDayWeights: { ...EQUAL_DAY_WEIGHTS } },
```

Load these sources in the same `Promise.all()` as categories and entries:

```js
firebase.getDocs(firebase.collection(db, 'users', state.user.uid, 'archivedCategories')),
firebase.getDocs(firebase.collection(db, 'users', state.user.uid, 'weeklyBudgets')),
firebase.getDocs(firebase.collection(db, 'users', state.user.uid, 'dailyBudgets')),
firebase.getDoc(firebase.doc(db, 'users', state.user.uid, 'settings', 'timeBudget')),
```

Map archived items with `archived: true`; map weekly and daily documents with `{ id: doc.id, ...doc.data() }`. Keep `state.weeklyBudget` as the current-week compatibility alias so existing code and patches do not break.

- [ ] **Step 4: 데이터 로딩 계약 테스트 실행**

Run: `node --test tests/time-budget-integration.test.js`

Expected: PASS.

- [ ] **Step 5: 현재 주 스냅숏 생성 계약 테스트 추가**

```js
test('현재 주는 유효 예산 전체와 요일 비율 스냅숏을 보존한다', async () => {
  const source = await read('src/app.js');
  assert.match(source, /ensureCurrentWeekSnapshot/);
  assert.match(source, /explicitBudgetIds/);
  assert.match(source, /dayWeights/);
  assert.match(source, /defaultDayWeights/);
  assert.match(source, /buildWeeklyBudgetSnapshot/);
});
```

- [ ] **Step 6: `ensureCurrentWeekSnapshot()` 구현**

Rules:

1. 현재 주 문서가 없으면 모든 활성 대분류의 현재 기본 예산을 `budgets`에 복사하고 `explicitBudgetIds: []`, 최근 기본 비율을 `dayWeights`에 저장한다.
2. 기존 문서에 `dayWeights`가 없으면 균등 비율을 넣는다. 기능 도입 전 과거 비율을 추정하지 않는다.
3. 기존 문서에 `explicitBudgetIds`가 없으면 기존 `budgets` 키를 명시값으로 간주한다.
4. 현재 주에 새 대분류가 추가됐으면 그 대분류 기본 예산을 `budgets`에 추가하되 기존 값과 기존 비율은 바꾸지 않는다.
5. 변경이 있을 때만 `{ merge: true }`로 저장한다.
6. 인증 후 `loadData()` 다음에 `ensureCurrentWeekSnapshot()`을 실행하고, 실제 쓰기가 발생했다면 한 번만 다시 로드한다.

- [ ] **Step 7: 일간·주간 저장 계약 테스트 추가**

```js
test('오늘 저장은 sparse overrides를, 이번 주 저장은 비율 설정과 주간 스냅숏을 기록한다', async () => {
  const source = await read('src/app.js');
  assert.match(source, /saveDailyBudgetOverrides/);
  assert.match(source, /dailyBudgets/);
  assert.match(source, /overrides/);
  assert.match(source, /saveCurrentWeekBudget/);
  assert.match(source, /writeBatch/);
  assert.match(source, /settings[^\n]*timeBudget/);
  assert.match(source, /defaultDayWeights/);
});
```

- [ ] **Step 8: 저장 함수 구현**

`saveDailyBudgetOverrides(inputs)`:

- 모든 활성 대분류 입력을 `parseOptionalHours()`로 읽는다.
- 명시 입력만 `overrides`에 넣고 빈칸인 ID는 제거한다.
- 결과가 비면 오늘의 `dailyBudgets/{today}` 문서를 삭제한다.
- 결과가 있으면 `{ date: today, overrides, updatedAt }`를 덮어쓴다.
- 현재 주의 주간 문서는 수정하지 않는다.

`saveCurrentWeekBudget({ budgetInputs, dayWeightInputs })`:

- `buildWeeklyBudgetSnapshot()`으로 완전한 `budgets`, `explicitBudgetIds`, `dayWeights`를 만든다.
- Firestore batch에서 `weeklyBudgets/{weekStart}`와 `settings/timeBudget`을 함께 저장한다.
- 설정 문서에는 같은 `dayWeights`를 `defaultDayWeights`로 저장한다.
- 오늘 `dailyBudgets` 문서는 읽거나 쓰지 않는다.

After each save, call `loadData()` and `renderAll()`, then display `저장했습니다.` only after Firestore succeeds.

- [ ] **Step 9: 통합 계약과 기존 테스트 실행**

Run: `node --test tests/time-budget-integration.test.js tests/domain.test.js tests/ui-contract.test.js`

Expected: PASS.

- [ ] **Step 10: Task 3 commit**

```bash
git add src/app.js tests/time-budget-integration.test.js
git commit -m "feat: persist daily and weekly time budgets"
```

---

### Task 4: `오늘 / 이번 주` 시간 예산 화면 구현

**Files:**
- Create: `src/time-budget-ui.js`
- Create: `tests/time-budget-ui.test.js`
- Modify: `src/app.js:177-205` and current `renderBudget()` section
- Modify: `index.html:32-37,70-77`

**Interfaces:**
- Produces: `createTimeBudgetUiState(today)`, `renderTimeBudgetHtml(model)`, `bindTimeBudgetControls(args)`.
- Consumes: Task 3 save callbacks and Task 1 domain functions.

- [ ] **Step 1: 시간 예산 HTML 실패 테스트 작성**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { renderTimeBudgetHtml } from '../src/time-budget-ui.js';

const baseModel = {
  mode: 'today',
  today: '2026-07-26',
  categories: [
    { id: 'reading', name: '독서', defaultBudgetMinutes: 420 },
    { id: 'thesis', name: '논문', defaultBudgetMinutes: 900 },
  ],
  weekDocument: {
    budgets: { reading: 420, thesis: 900 },
    explicitBudgetIds: [],
    dayWeights: { mon: 0.2, tue: 0.2, wed: 0.1, thu: 0.1, fri: 0.1, sat: 0.2, sun: 0.1 },
  },
  dailyDocument: { overrides: { reading: 0 } },
};

test('시간 예산은 오늘과 이번 주 탭 및 저장 버튼을 제공한다', () => {
  const html = renderTimeBudgetHtml(baseModel);
  assert.match(html, /data-budget-mode="today"/);
  assert.match(html, /data-budget-mode="week"/);
  assert.match(html, />오늘</);
  assert.match(html, />이번 주</);
  assert.match(html, /<button[^>]*type="submit"[^>]*>저장<\/button>/);
  assert.doesNotMatch(html, /이번 주 예산과 비율 저장/);
});

test('오늘 입력은 직접 0을 표시하고 미설정 항목은 빈칸과 자동값을 표시한다', () => {
  const html = renderTimeBudgetHtml(baseModel);
  assert.match(html, /name="reading"[^>]*value="0"/);
  assert.match(html, /name="thesis"[^>]*value=""/);
  assert.match(html, /자동/);
});
```

- [ ] **Step 2: 실패 확인**

Run: `node --test tests/time-budget-ui.test.js`

Expected: FAIL with `ERR_MODULE_NOT_FOUND`.

- [ ] **Step 3: 오늘 탭 HTML 최소 구현**

`renderTimeBudgetHtml()` requirements:

- 상단 탭은 버튼이며 `aria-pressed`와 `.active`를 mode에 맞게 설정한다.
- 오늘 날짜를 한국어 형식으로 표시한다.
- 각 대분류 행에 이름, 자동 계산 보조값, `type="number" min="0" step="0.5"` 입력을 둔다.
- `dailyDocument.overrides`에 ID가 있으면 `0`도 value로 출력하고, 없으면 value는 빈 문자열이다.
- 폼 ID는 `daily-budget-form`, 제출 버튼은 정확히 `저장`이다.
- 사용자 문자열은 escape 함수로 처리한다.

Run: `node --test tests/time-budget-ui.test.js`

Expected: current tests PASS.

- [ ] **Step 4: 이번 주 탭 실패 테스트 추가**

```js
test('이번 주 탭은 대분류 예산과 7개 공통 요일 비율을 한 폼에서 저장한다', () => {
  const html = renderTimeBudgetHtml({ ...baseModel, mode: 'week' });
  assert.match(html, /id="weekly-budget-form"/);
  assert.match(html, /대분류별 이번 주 총예산/);
  assert.match(html, /요일별 공통 배분 비율/);
  for (const key of ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']) {
    assert.match(html, new RegExp(`name="day-weight-${key}"`));
  }
  assert.match(html, /환산/);
  assert.match(html, /<button[^>]*type="submit"[^>]*>저장<\/button>/);
});
```

- [ ] **Step 5: 이번 주 탭 HTML 구현**

Rules:

- 대분류 입력 value는 `explicitBudgetIds`에 포함될 때만 `budgets[id] / 60`; 아니면 빈칸이다.
- 빈칸 아래에는 `기본 X시간`을 표시한다.
- `0`은 value `0`으로 유지한다.
- 7개 요일 입력은 저장된 정규화 비율을 백분율 숫자로 표시한다.
- 입력 이벤트가 발생하면 `normalizeDayWeights()`를 호출해 환산된 실제 백분율을 즉시 다시 표시한다.
- 7개 값이 모두 비거나 0이면 화면 미리보기는 균등 비율을 표시한다.

- [ ] **Step 6: 이벤트 바인딩 계약 테스트 추가**

```js
import { createTimeBudgetUiState } from '../src/time-budget-ui.js';

test('시간 예산 UI 상태의 기본 탭은 오늘이다', () => {
  assert.deepEqual(createTimeBudgetUiState('2026-07-26'), { mode: 'today', today: '2026-07-26' });
});
```

`bindTimeBudgetControls()` must:

- 탭 클릭 시 `uiState.mode`를 갱신하고 rerender한다.
- 오늘 폼 제출 시 각 대분류의 원문 문자열을 `onSaveDaily(inputs)`에 전달한다.
- 이번 주 폼 제출 시 `{ budgetInputs, dayWeightInputs }`를 `onSaveWeekly()`에 전달한다.
- 저장 중 버튼을 비활성화하고 `저장 중…`을 표시한 뒤 성공·실패 모두 원래 상태로 복구한다.
- 오류는 `alert(error.message)`로 표시하고 입력값을 지우지 않는다.

- [ ] **Step 7: `app.js`의 기존 `renderBudget()` 교체**

In `renderAll()`, call new `renderTimeBudget()` wrapper. Build the model from active categories, current week document, today daily document, and `state.timeBudgetUi`. Call `bindTimeBudgetControls()` with Task 3 callbacks.

Change titles:

```js
budget: '시간 예산',
```

Change `index.html` navigation text from `이번 주 예산` to `시간 예산`, and add `src/time-budget-ui.js` only through imports from `app.js`; do not add a second side-effect script tag.

- [ ] **Step 8: UI와 기존 계약 테스트 실행**

Run: `node --test tests/time-budget-ui.test.js tests/time-budget-integration.test.js tests/ui-contract.test.js`

Expected: PASS.

- [ ] **Step 9: Task 4 commit**

```bash
git add src/time-budget-ui.js src/app.js index.html tests/time-budget-ui.test.js tests/time-budget-integration.test.js
git commit -m "feat: add today and weekly time budget editor"
```

---

### Task 5: 일간·주간 대시보드와 기록 날짜 달력 구현

**Files:**
- Modify: `src/time-budget-ui.js`
- Modify: `src/app.js` current `renderDashboard()` section
- Modify: `tests/time-budget-ui.test.js`
- Modify: `tests/time-budget-integration.test.js`

**Interfaces:**
- Produces: `createDashboardUiState(today, weekStart)`, `renderDashboardHtml(model)`, `bindDashboardControls(args)`.
- Consumes: Task 2 navigation, calendar, daily summary functions; existing `summarizeCategories()` for weekly summary.

- [ ] **Step 1: 일간 대시보드 HTML 실패 테스트 작성**

```js
import { renderDashboardHtml } from '../src/time-budget-ui.js';

test('대시보드 일간 탭은 기록 날짜 이동과 달력 및 일간 달성률을 표시한다', () => {
  const html = renderDashboardHtml({
    mode: 'daily',
    selectedDate: '2026-07-24',
    today: '2026-07-26',
    calendarYear: 2026,
    calendarMonth: 7,
    recordDates: ['2026-07-20', '2026-07-24'],
    dailySummary: {
      totalBudgetMinutes: 120,
      totalActualMinutes: 90,
      percentage: 75,
      categorySummaries: [{
        id: 'reading', name: '독서', budgetMinutes: 120, actualMinutes: 90,
        percentage: 75, status: 'remaining', differenceMinutes: -30, budgetSource: 'direct',
      }],
    },
  });
  assert.match(html, /data-dashboard-mode="daily"/);
  assert.match(html, /data-dashboard-mode="weekly"/);
  assert.match(html, />전날</);
  assert.match(html, />다음날</);
  assert.match(html, /기록 날짜 선택/);
  assert.match(html, /직접 설정/);
  assert.match(html, /75%/);
});
```

- [ ] **Step 2: 실패 확인**

Run: `node --test tests/time-budget-ui.test.js`

Expected: FAIL because dashboard exports are missing.

- [ ] **Step 3: 일간 대시보드와 달력 HTML 구현**

Requirements:

- 탭 순서는 `일간`, `주간`; 기본은 `일간`이다.
- `전날` 버튼은 `previousRecordedDate()`가 null이면 disabled다.
- `다음날` 버튼은 `nextRecordedDateOrToday()`가 null이면 disabled다.
- 별도 `오늘` 버튼은 선택 날짜가 오늘이면 disabled다.
- 사용자 정의 달력은 월 이동 버튼, 월 제목, 월~일 헤더, 42개 날짜 셀을 렌더링한다.
- 기록 날짜 셀만 `button data-dashboard-date="YYYY-MM-DD"`로 활성화한다.
- 기록 없는 날짜와 미래 날짜는 `disabled` 속성을 가진다.
- 전체 카드에는 `전체 적용 예산`, `실제 기록`, `달성률`을 표시한다.
- 대분류 행에는 예산 출처 `직접 설정` 또는 `요일 비율 적용`을 표시한다.
- 예산 0이고 실제 기록이 있으면 달성률 대신 `예산 미설정`을 표시한다.

- [ ] **Step 4: 주간 대시보드 실패 테스트 추가**

```js
test('주간 대시보드는 이번 주보다 미래 이동을 막는다', () => {
  const html = renderDashboardHtml({
    mode: 'weekly',
    selectedWeekStart: '2026-07-20',
    currentWeekStart: '2026-07-20',
    weeklySummary: { totalBudgetMinutes: 420, totalActualMinutes: 210, percentage: 50, categorySummaries: [] },
  });
  assert.match(html, />전주</);
  assert.match(html, /data-week-direction="next"[^>]*disabled/);
  assert.match(html, /이번 주 예산/);
  assert.match(html, /50%/);
});
```

- [ ] **Step 5: 주간 HTML 구현**

Use selected week’s stored `budgets` directly to build categories passed to existing `summarizeCategories()`. Never use today’s `dailyBudgets` in weekly summary. The next button is disabled when `selectedWeekStart >= currentWeekStart`.

- [ ] **Step 6: 대시보드 이벤트와 상태 구현**

`createDashboardUiState(today, currentWeekStart)` returns:

```js
{
  mode: 'daily',
  selectedDate: today,
  selectedWeekStart: currentWeekStart,
  calendarYear: Number(today.slice(0, 4)),
  calendarMonth: Number(today.slice(5, 7)),
}
```

`bindDashboardControls()` behavior:

- 탭 클릭: mode 갱신 후 rerender.
- 전날: 가장 가까운 이전 기록 날짜.
- 다음날: 다음 기록 날짜, 없으면 오늘.
- 오늘: selectedDate를 오늘로 설정.
- 달력 날짜: 활성 버튼의 날짜만 선택.
- 달력 월 이동: 미래 월로 이동하지 못하게 제한.
- 전주/다음 주: `moveWeekStart()`를 사용하되 currentWeekStart를 넘지 않도록 제한.

- [ ] **Step 7: `app.js`에서 대시보드 모델 조립**

Build `allCategories` by active categories first and archived categories second, without duplicate IDs. Use all categories for historical daily names and active categories for current automatic budgets. Use `weeklyBudgetFor(getWeekRange(selectedDate).start)` and `dailyBudgetFor(selectedDate)`. For legacy week documents without `dayWeights`, use equal weights.

Replace current `renderDashboard()` body with `renderDashboardHtml()` and `bindDashboardControls()`. Update `#week-label` according to the selected daily date or selected weekly range while the dashboard is visible; existing statistics module continues to own the label while statistics is visible.

- [ ] **Step 8: 일간·주간 UI 테스트와 전체 도메인 테스트 실행**

Run: `node --test tests/time-budget-ui.test.js tests/time-budget-domain.test.js tests/time-budget-integration.test.js tests/domain.test.js`

Expected: PASS.

- [ ] **Step 9: Task 5 commit**

```bash
git add src/time-budget-ui.js src/app.js tests/time-budget-ui.test.js tests/time-budget-integration.test.js
git commit -m "feat: add daily and weekly dashboard navigation"
```

---

### Task 6: 복구 가능한 단일 타이머 컨트롤러 구현

**Files:**
- Create: `src/persistent-timer.js`
- Create: `tests/persistent-timer.test.js`

**Interfaces:**
- Produces: `ACTIVE_TIMER_STORAGE_KEY`, `createActiveTimer(data)`, `elapsedTimerSeconds(timer, now)`, `loadLocalTimer(storage, userId)`, `saveLocalTimer(storage, timer)`, `clearLocalTimer(storage)`, `createPersistentTimerController(options)`.
- Controller options: `{ userId, remote, storage, now, onChange }`.
- Remote interface: `{ read(), write(timer), finish(timer, entry), remove() }`.
- Controller methods: `{ restore(), start(data), finish(), cancel(), current(), elapsedSeconds() }`.

- [ ] **Step 1: 직렬화와 절대시각 경과 계산 실패 테스트 작성**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createActiveTimer,
  elapsedTimerSeconds,
  loadLocalTimer,
  saveLocalTimer,
} from '../src/persistent-timer.js';

function memoryStorage() {
  const data = new Map();
  return {
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => data.set(key, value),
    removeItem: (key) => data.delete(key),
  };
}

test('타이머는 절대 시작 시각과 사용자 정보를 저장하고 복원한다', () => {
  const timer = createActiveTimer({
    userId: 'u1', categoryId: 'reading', note: '독서',
    startedAt: 1_000, startDate: '2026-07-26',
  });
  const storage = memoryStorage();
  saveLocalTimer(storage, timer);
  assert.deepEqual(loadLocalTimer(storage, 'u1'), timer);
  assert.equal(elapsedTimerSeconds(timer, 3_601_000), 3600);
});
```

- [ ] **Step 2: 실패 확인**

Run: `node --test tests/persistent-timer.test.js`

Expected: FAIL with `ERR_MODULE_NOT_FOUND`.

- [ ] **Step 3: 데이터 생성·로컬 저장·경과 계산 구현**

`createActiveTimer()` must reject missing user/category and non-finite startedAt. Store `status: 'running'`. `loadLocalTimer()` must catch malformed JSON, clear it, and return null; it must return null for another user’s timer.

Run: `node --test tests/persistent-timer.test.js`

Expected: PASS.

- [ ] **Step 4: 컨트롤러 복구·단일 실행 실패 테스트 작성**

```js
import { createPersistentTimerController } from '../src/persistent-timer.js';

test('원격 타이머가 있으면 새 타이머를 만들지 않고 복구한다', async () => {
  const remoteTimer = createActiveTimer({
    userId: 'u1', categoryId: 'reading', note: '', startedAt: 1_000, startDate: '2026-07-26',
  });
  let writes = 0;
  const controller = createPersistentTimerController({
    userId: 'u1', storage: memoryStorage(), now: () => 5_000,
    remote: {
      read: async () => remoteTimer,
      write: async () => { writes += 1; },
      finish: async () => {},
      remove: async () => {},
    },
  });
  assert.deepEqual(await controller.restore(), remoteTimer);
  assert.deepEqual(await controller.start({ categoryId: 'thesis', note: '', startDate: '2026-07-26' }), remoteTimer);
  assert.equal(writes, 0);
});
```

- [ ] **Step 5: 컨트롤러 restore/start 구현**

Rules:

- `restore()` reads local first for immediate candidate, then awaits remote.
- Valid remote value wins over local and overwrites local.
- Remote null clears stale local.
- Remote read failure preserves a valid local candidate but marks it as provisional through `onChange(timer, { provisional: true })`; it must not create a second timer.
- `start()` calls `restore()` first; if a timer exists, return it without `remote.write()`.
- A new timer becomes current only after `remote.write()` succeeds; then save local and call `onChange()`.
- If remote write fails, current remains null and local storage stays empty.

- [ ] **Step 6: 종료 성공·실패·취소 테스트 작성**

```js
test('종료 성공 후에만 상태를 지우고 실패하면 재시도 가능하게 유지한다', async () => {
  const storage = memoryStorage();
  let fail = true;
  const controller = createPersistentTimerController({
    userId: 'u1', storage, now: () => 61_000,
    remote: {
      read: async () => null,
      write: async () => {},
      finish: async () => { if (fail) throw new Error('network'); },
      remove: async () => {},
    },
  });
  await controller.start({ categoryId: 'reading', note: '', startDate: '2026-07-26', startedAt: 1_000 });
  await assert.rejects(controller.finish(), /network/);
  assert.ok(controller.current());
  fail = false;
  const entry = await controller.finish();
  assert.equal(entry.durationMinutes, 1);
  assert.equal(controller.current(), null);
});
```

Also test `cancel()` calls only `remote.remove()`, creates no entry, and clears state only after remove succeeds.

- [ ] **Step 7: finish/cancel 구현 및 테스트 실행**

Entry returned to `remote.finish()`:

```js
{
  categoryId: timer.categoryId,
  note: timer.note,
  date: timer.startDate,
  durationMinutes: Math.max(1, Math.round((now() - timer.startedAt) / 60000)),
  startTime: local HH:MM derived from timer.startedAt,
  endTime: local HH:MM derived from now(),
  source: 'timer',
}
```

Only after `remote.finish()` succeeds: clear local, set current null, call `onChange(null)`.

Run: `node --test tests/persistent-timer.test.js`

Expected: PASS.

- [ ] **Step 8: Task 6 commit**

```bash
git add src/persistent-timer.js tests/persistent-timer.test.js
git commit -m "feat: add persistent single timer controller"
```

---

### Task 7: Firestore activeTimer와 기존 타이머 UI 연결

**Files:**
- Modify: `src/app.js` timer state, authentication load, `timerForm()`, `bindTimer()`
- Modify: `tests/time-budget-integration.test.js`
- Modify: `tests/ui-contract.test.js`

**Interfaces:**
- Consumes: `createPersistentTimerController()` from Task 6.
- Produces: Firestore remote adapter with `read`, `write`, `finish`, `remove`.

- [ ] **Step 1: activeTimer 연결 실패 계약 테스트 작성**

```js
test('앱은 사용자 activeTimer를 복구하고 원자적으로 종료한다', async () => {
  const source = await read('src/app.js');
  assert.match(source, /createPersistentTimerController/);
  assert.match(source, /activeTimer[^\n]*current/);
  assert.match(source, /localStorage/);
  assert.match(source, /visibilitychange/);
  assert.match(source, /writeBatch/);
  assert.match(source, /timerController\.restore/);
  assert.match(source, /timerController\.finish/);
});
```

- [ ] **Step 2: 실패 확인**

Run: `node --test tests/time-budget-integration.test.js`

Expected: FAIL.

- [ ] **Step 3: 인증 사용자별 컨트롤러 생성**

After Firebase initialization and after `state.user` is set, create a controller using:

```js
const activeTimerRef = firebase.doc(db, 'users', user.uid, 'activeTimer', 'current');
```

Remote adapter:

- `read`: `getDoc(activeTimerRef)`; convert Firestore Timestamp with `.toMillis()` or accept numeric legacy values.
- `write`: `setDoc(activeTimerRef, timer)`.
- `remove`: `deleteDoc(activeTimerRef)`.
- `finish`: create a new entry document reference, then batch set entry with `createdAt: serverTimestamp()` and batch delete activeTimer; commit once.

`onChange` sets `state.timer`, restarts only the display interval, and calls `renderRecord()`.

- [ ] **Step 4: 로그인·복구 순서 구현**

On authenticated load:

1. `await loadData()` and ensure current week snapshot.
2. `await timerController.restore()`.
3. `renderAll()`.

On logout, clear only in-memory controller reference and display interval. Do not delete Firestore activeTimer, because logout must not discard a running timer.

- [ ] **Step 5: 기존 `bindTimer()`를 컨트롤러 호출로 교체**

Start:

- require selected category.
- call `timerController.start({ categoryId, note, startDate: toDateKey(new Date()) })`.
- disable action while awaiting Firestore.
- if an existing timer is returned, show it instead of replacing it.

Finish:

- call `timerController.finish()`.
- only after success call `loadData()` and `renderAll()`.
- if failure, alert `타이머 기록을 저장하지 못했습니다. 다시 시도하세요.` and keep running state.

Cancel:

- require confirmation.
- call `timerController.cancel()`.
- if remote removal fails, retain timer and show an error.

- [ ] **Step 6: 백그라운드·화면 복귀 처리**

Keep `setInterval()` only for visible text refresh. Add:

```js
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && state.timer) updateTimerDisplay();
});
window.addEventListener('pageshow', () => {
  if (state.timer) updateTimerDisplay();
});
```

`updateTimerDisplay()` must call controller `elapsedSeconds()` and never increment a local counter.

- [ ] **Step 7: 기존 선택 유지와 타이머 문구 회귀 테스트 갱신**

Update `tests/ui-contract.test.js` to assert:

- selected category comes from `state.timer.categoryId` while running.
- timer start does not reset to `선택하세요`.
- timer display uses absolute elapsed function.
- active timer cleanup is not performed on logout.

Run: `node --test tests/persistent-timer.test.js tests/time-budget-integration.test.js tests/ui-contract.test.js`

Expected: PASS.

- [ ] **Step 8: Task 7 commit**

```bash
git add src/app.js tests/time-budget-integration.test.js tests/ui-contract.test.js
git commit -m "fix: restore timers after background and reload"
```

---

### Task 8: 삭제·보관·통계와 신규 예산 데이터의 호환성 보장

**Files:**
- Modify: `src/category-delete-guard.js`
- Modify: `tests/time-budget-integration.test.js`
- Modify only if failing: `src/domain.js`, `src/statistics-ui.js`, `tests/domain.test.js`, `tests/ui-contract.test.js`
- Verify: `firestore.rules`

**Interfaces:**
- Consumes: 주간 문서 `budgets`, `explicitBudgetIds`; 일간 문서 `overrides`; active timer `categoryId`.
- Produces: 완전 삭제 후 해당 대분류의 모든 신규 참조 제거.

- [ ] **Step 1: 완전 삭제 신규 참조 정리 실패 테스트 작성**

```js
test('대분류 완전 삭제는 주간·일간 예산과 활성 타이머 참조도 제거한다', async () => {
  const source = await read('src/category-delete-guard.js');
  assert.match(source, /dailyBudgets/);
  assert.match(source, /overrides/);
  assert.match(source, /explicitBudgetIds/);
  assert.match(source, /activeTimer/);
  assert.match(source, /categoryId/);
});
```

- [ ] **Step 2: 실패 확인**

Run: `node --test tests/time-budget-integration.test.js`

Expected: FAIL.

- [ ] **Step 3: `permanentlyDelete()` 확장**

Fetch in parallel:

- matching entries,
- all weeklyBudgets,
- all dailyBudgets,
- `activeTimer/current`.

For every weekly document:

- remove `budgets[categoryId]` if present.
- remove category ID from `explicitBudgetIds`.
- preserve `dayWeights` and unrelated fields.

For every daily document:

- remove `overrides[categoryId]` if present.
- delete the daily document if overrides becomes empty; otherwise merge the reduced overrides.

If active timer category matches, delete activeTimer. Existing localStorage is cleared on next controller reconciliation when Firestore returns null.

Keep 450-operation batching.

- [ ] **Step 4: 보관 동작 확인**

Do not remove weekly or daily budget history when archiving. The dashboard loads `archivedCategories`, so historical names remain visible. Add a source contract assertion that `archiveCategory()` only moves the category document and does not edit entries, weeklyBudgets, or dailyBudgets.

- [ ] **Step 5: 기존 통계 호환 테스트 추가**

Add to `tests/domain.test.js`:

```js
test('explicitBudgetIds와 dayWeights가 추가된 주간 문서도 기존 통계 예산을 그대로 사용한다', () => {
  const result = summarizeBudgetPeriod(
    [{ categoryId: 'reading', durationMinutes: 60, date: '2026-07-20' }],
    [{ id: 'reading', name: '독서', defaultBudgetMinutes: 999 }],
    [{
      id: '2026-07-20', weekStart: '2026-07-20', budgets: { reading: 420 },
      explicitBudgetIds: [], dayWeights: { mon: 1 / 7, tue: 1 / 7, wed: 1 / 7, thu: 1 / 7, fri: 1 / 7, sat: 1 / 7, sun: 1 / 7 },
    }],
    '2026-07-20', '2026-07-26',
  );
  assert.equal(result.totalBudgetMinutes, 420);
});
```

Do not change statistics code if this passes. If it fails, make the smallest change so statistics reads only `week.budgets` and ignores metadata fields.

- [ ] **Step 6: Firestore 규칙 계약 확인**

Add assertion:

```js
test('Firestore 규칙은 신규 사용자 하위 경로를 본인 uid로 제한한다', async () => {
  const rules = await read('firestore.rules');
  assert.match(rules, /match \/users\/\{userId\}\/\{document=\*\*\}/);
  assert.match(rules, /request\.auth\.uid == userId/);
});
```

The existing wildcard rule already covers `weeklyBudgets`, `dailyBudgets`, `settings/timeBudget`, and `activeTimer/current`; do not replace it with duplicated narrower matches.

- [ ] **Step 7: 호환 테스트 실행**

Run: `node --test tests/time-budget-integration.test.js tests/domain.test.js tests/ui-contract.test.js`

Expected: PASS.

- [ ] **Step 8: Task 8 commit**

```bash
git add src/category-delete-guard.js tests/time-budget-integration.test.js tests/domain.test.js
git commit -m "fix: clean time budget references on category deletion"
```

---

### Task 9: 반응형 화면, 접근성, 전체 회귀 검증

**Files:**
- Modify: `styles.css`
- Modify: `tests/time-budget-ui.test.js`
- Modify: `tests/ui-contract.test.js`
- Verify: `index.html`, all changed JavaScript files, Pages build.

**Interfaces:**
- Consumes: Task 4·5 HTML class names.
- Produces: 360px 이상에서 가로 스크롤 없는 적응형 배치.

- [ ] **Step 1: 적응형 CSS 계약 실패 테스트 작성**

```js
test('시간 예산과 대시보드는 화면 선택 버튼 없이 적응형 스타일을 사용한다', async () => {
  const [styles, index, ui] = await Promise.all([
    read('styles.css'), read('index.html'), read('src/time-budget-ui.js'),
  ]);
  assert.doesNotMatch(index + ui, /넓은 화면|모바일 화면/);
  assert.match(styles, /\.time-budget-tabs/);
  assert.match(styles, /\.day-weight-grid/);
  assert.match(styles, /\.record-calendar/);
  assert.match(styles, /@media\s*\(max-width:\s*600px\)/);
  assert.match(styles, /minmax\(0,\s*1fr\)/);
  assert.match(styles, /max-width:\s*100%/);
});
```

- [ ] **Step 2: 실패 확인**

Run: `node --test tests/time-budget-ui.test.js`

Expected: FAIL because styles are absent.

- [ ] **Step 3: 넓은 화면 스타일 구현**

Required classes and behavior:

- `.time-budget-tabs`, `.dashboard-tabs`: flex, wrap, 44px minimum button height.
- `.budget-category-row`: grid columns `minmax(0, 1fr) minmax(120px, 180px)`.
- `.day-weight-grid`: `repeat(7, minmax(0, 1fr))`.
- `.dashboard-period-nav`: previous/date/next grid.
- `.record-calendar`: `max-width: 420px; width: 100%`.
- `.record-calendar-grid`: 7 columns; disabled dates visibly muted; enabled dates retain 44px touch target.
- `.daily-summary-row`: no fixed minimum width.
- All new controls use `box-sizing: border-box; max-width: 100%`.

- [ ] **Step 4: 모바일 스타일 구현**

Inside `@media(max-width: 600px)`:

- category rows become one-column cards.
- day weights use `repeat(2, minmax(0, 1fr))` at 360px; a third column is allowed only when it fits.
- period navigation date label occupies the full first row.
- summary cards become one column.
- calendar remains within viewport and date buttons do not exceed their cells.
- save button is full width.

Do not add a UI switch for viewport mode.

- [ ] **Step 5: 접근성 계약 확인**

Update HTML generators so:

- tab containers have `role="tablist"` and buttons have `aria-selected`.
- calendar month navigation buttons have explicit `aria-label`.
- disabled calendar dates use native `disabled`.
- direct/automatic budget source text is not color-only.
- inputs have category-specific `aria-label`.
- active timer status has `aria-live="polite"`.

Add string assertions to `tests/time-budget-ui.test.js`.

- [ ] **Step 6: JavaScript 문법 검사 테스트 확대**

Add to `tests/ui-contract.test.js`:

```js
for (const relativePath of [
  '../src/app.js',
  '../src/time-budget-domain.js',
  '../src/time-budget-ui.js',
  '../src/persistent-timer.js',
  '../src/category-delete-guard.js',
]) {
  const path = fileURLToPath(new URL(relativePath, import.meta.url));
  const result = spawnSync(process.execPath, ['--check', path], { encoding: 'utf8' });
  assert.equal(result.status, 0, `${relativePath}: ${result.stderr || result.stdout}`);
}
```

- [ ] **Step 7: 전체 자동 테스트 실행**

Run: `npm test`

Expected: all tests PASS with exit code 0.

- [ ] **Step 8: Pages 산출물 생성 확인**

Run: `npm run prepare:pages`

Expected:

- exit code 0,
- `_site/index.html`, `_site/styles.css`, `_site/src/time-budget-domain.js`, `_site/src/time-budget-ui.js`, `_site/src/persistent-timer.js` exist,
- `_site/index.html` navigation contains `시간 예산`.

- [ ] **Step 9: 수동 브라우저 검증**

Run: `npm start`

Verify at desktop width and iPhone-sized responsive mode:

1. 대시보드 기본 탭이 일간·오늘이다.
2. 기록 있는 날짜만 달력에서 선택된다.
3. 전날·다음날이 가장 가까운 기록 날짜로 이동한다.
4. 오늘과 이번 주에서 미래 이동이 비활성화된다.
5. 오늘 예산 빈칸은 자동값, 0은 직접 0으로 저장된다.
6. 이번 주 요일 상대값이 즉시 100%로 환산된다.
7. 이번 주 저장 후 오늘 직접 예산이 유지된다.
8. 타이머 시작 후 화면 잠금 또는 앱 전환 뒤 복귀해도 경과 시간이 맞다.
9. 페이지 새로고침 후 진행 중 타이머가 복구된다.
10. 타이머 종료 실패를 재현하면 실행 상태가 남고 재시도할 수 있다.
11. 360px에서 가로 스크롤이 없다.
12. 통계와 기록 내역이 기존처럼 동작한다.

- [ ] **Step 10: 최종 commit**

```bash
git add styles.css index.html src tests
git commit -m "feat: complete responsive time budget dashboard"
```

- [ ] **Step 11: 최종 브랜치 검증**

Run:

```bash
npm test
npm run prepare:pages
node --check src/app.js
node --check src/time-budget-domain.js
node --check src/time-budget-ui.js
node --check src/persistent-timer.js
```

Expected: every command exits 0. Do not open or merge a PR until this exact final verification passes.
