# 일간·주간 대시보드, 시간 예산, 복구형 타이머 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 기록 날짜 중심의 일간·주간 대시보드, 오늘·이번 주 시간 예산, 재시작 후 복구되는 단일 타이머를 기존 웹앱에 추가한다.

**Architecture:** 계산 규칙은 `src/time-budget-domain.js`, 화면 생성과 화면 상태는 `src/time-budget-ui.js`, 타이머 복구는 `src/persistent-timer.js`에 분리한다. `src/app.js`는 Firebase 읽기·쓰기와 세 모듈의 연결만 담당한다. 기존 통계가 읽는 `weeklyBudgets.budgets`는 유효 주간 예산의 완전한 스냅숏으로 유지하고, `explicitBudgetIds`로 빈칸과 명시적 0을 구분한다.

**Tech Stack:** ES modules, Firebase Authentication/Firestore 11.10.0, HTML/CSS, Node.js `node --test`.

## Global Constraints

- 메뉴·페이지 제목은 `시간 예산`이다.
- 대시보드 기본은 `일간 / 오늘`; 미래 날짜와 미래 주는 조회하지 않는다.
- 달력은 기록 있는 날짜만 활성화한다. 전날·다음날은 가장 가까운 기록 날짜로 이동하며 이후 기록이 없으면 오늘로 이동한다.
- 시간 예산은 `오늘 / 이번 주`; 두 저장 버튼 문구는 `저장`이다.
- 예산 입력은 0 이상, 0.5시간 단위다. 빈칸은 자동값, `0`은 명시적 0시간이다.
- 요일 비율은 모든 대분류 공통이며 자동으로 100% 정규화한다. 이후 주에 이월하지만 과거 주는 당시 스냅숏을 유지한다.
- 오늘 직접 예산은 같은 주의 주간 설정 변경에도 유지하고 다음 주로 이월하지 않는다. 주간 총예산도 바꾸지 않는다.
- 사용자당 타이머는 하나다. 경과 시간은 `현재 시각 - 절대 시작 시각`으로 계산한다.
- 새 런타임 의존성을 추가하지 않는다. 기존 통계·기록·대분류·로그인을 회귀시키지 않는다.
- 화면 폭 선택 버튼 없이 360px 이상에서 가로 스크롤 없는 반응형 화면을 제공한다.

## File Map

- Create: `src/time-budget-domain.js`, `src/time-budget-ui.js`, `src/persistent-timer.js`
- Create: `tests/time-budget-domain.test.js`, `tests/time-budget-ui.test.js`, `tests/persistent-timer.test.js`, `tests/time-budget-integration.test.js`
- Modify: `src/app.js`, `index.html`, `styles.css`, `src/category-delete-guard.js`
- Modify only if regression fails: `src/domain.js`, `src/statistics-ui.js`, their tests
- Verify: `firestore.rules`, Pages build

---

### Task 1: 시간 예산·날짜 탐색 도메인

**Files:** Create `src/time-budget-domain.js`, `tests/time-budget-domain.test.js`

**Interfaces:**

```js
DAY_KEYS
EQUAL_DAY_WEIGHTS
normalizeDayWeights(raw)                 // -> {mon..sun: 0..1}
distributeWeeklyMinutes(total, weights)  // -> {mon..sun: integer minutes}
parseOptionalHours(value)                // -> {explicit, minutes}
buildWeeklyBudgetSnapshot(args)          // -> {weekStart,budgets,explicitBudgetIds,dayWeights}
resolveDailyBudget(args)                 // -> {minutes,source:'direct'|'day-weight'}
recordedDateKeys(entries,today)
previousRecordedDate(dates,selected)
nextRecordedDateOrToday(dates,selected,today)
calendarMonthCells(year,month,dates,today)
summarizeDailyCategories(args)
```

- [ ] **Step 1: 실패 테스트 작성**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DAY_KEYS, normalizeDayWeights, distributeWeeklyMinutes, parseOptionalHours,
  buildWeeklyBudgetSnapshot, resolveDailyBudget, recordedDateKeys,
  previousRecordedDate, nextRecordedDateOrToday, calendarMonthCells,
} from '../src/time-budget-domain.js';

test('상대 비율을 100%로 환산하고 총분을 보정한다', () => {
  const w = normalizeDayWeights({mon:2,tue:2,wed:1,thu:1,fri:1,sat:2,sun:1});
  assert.deepEqual(DAY_KEYS.map(k => Math.round(w[k]*100)), [20,20,10,10,10,20,10]);
  const days = distributeWeeklyMinutes(421, w);
  assert.deepEqual(DAY_KEYS.map(k => days[k]), [84,84,42,42,42,84,43]);
  assert.equal(Object.values(days).reduce((a,b)=>a+b,0), 421);
});

test('빈칸과 0을 구분하고 0.5시간 단위를 검사한다', () => {
  assert.deepEqual(parseOptionalHours(''), {explicit:false,minutes:null});
  assert.deepEqual(parseOptionalHours('0'), {explicit:true,minutes:0});
  assert.deepEqual(parseOptionalHours('1.5'), {explicit:true,minutes:90});
  assert.throws(() => parseOptionalHours('1.25'), /0.5시간 단위/);
});

test('주간 스냅숏과 오늘 직접 0을 보존한다', () => {
  const categories=[{id:'reading',defaultBudgetMinutes:420},{id:'thesis',defaultBudgetMinutes:900}];
  const week=buildWeeklyBudgetSnapshot({weekStart:'2026-07-20',categories,
    budgetInputs:{reading:'',thesis:'0'},dayWeightInputs:{mon:2,tue:2,wed:1,thu:1,fri:1,sat:2,sun:1}});
  assert.deepEqual(week.budgets,{reading:420,thesis:0});
  assert.deepEqual(week.explicitBudgetIds,['thesis']);
  assert.deepEqual(resolveDailyBudget({date:'2026-07-20',category:categories[0],weekDocument:week,
    dailyDocument:{overrides:{reading:0}}}),{minutes:0,source:'direct'});
});

test('가장 가까운 기록 날짜와 기록 달력만 제공한다', () => {
  const dates=recordedDateKeys([{date:'2026-07-20'},{date:'2026-07-24'},{date:'2026-07-27'}],'2026-07-26');
  assert.deepEqual(dates,['2026-07-20','2026-07-24']);
  assert.equal(previousRecordedDate(dates,'2026-07-24'),'2026-07-20');
  assert.equal(nextRecordedDateOrToday(dates,'2026-07-24','2026-07-26'),'2026-07-26');
  const cells=calendarMonthCells(2026,7,new Set(dates),'2026-07-26');
  assert.equal(cells.find(c=>c.date==='2026-07-20').enabled,true);
  assert.equal(cells.find(c=>c.date==='2026-07-21').enabled,false);
});
```

- [ ] **Step 2: 실패 확인** — Run `node --test tests/time-budget-domain.test.js`; expect `ERR_MODULE_NOT_FOUND`.

- [ ] **Step 3: 최소 구현 작성**

```js
export const DAY_KEYS=Object.freeze(['mon','tue','wed','thu','fri','sat','sun']);
export const EQUAL_DAY_WEIGHTS=Object.freeze(Object.fromEntries(DAY_KEYS.map(k=>[k,1/7])));

export function normalizeDayWeights(raw={}) {
  const values=Object.fromEntries(DAY_KEYS.map(k=>{
    const n=Number(raw[k]);
    if (Number.isFinite(n)&&n<0) throw new Error('요일 비율은 0 이상이어야 합니다.');
    return [k,Number.isFinite(n)&&n>0?n:0];
  }));
  const total=Object.values(values).reduce((a,b)=>a+b,0);
  return total?Object.fromEntries(DAY_KEYS.map(k=>[k,values[k]/total])):{...EQUAL_DAY_WEIGHTS};
}

export function parseOptionalHours(value) {
  if (value===''||value==null) return {explicit:false,minutes:null};
  const hours=Number(value);
  if (!Number.isFinite(hours)||hours<0) throw new Error('예산은 0 이상이어야 합니다.');
  if (!Number.isInteger(hours*2)) throw new Error('예산은 0.5시간 단위로 입력하세요.');
  return {explicit:true,minutes:Math.round(hours*60)};
}
```

Implement remaining exports with these exact rules:

- `distributeWeeklyMinutes`: 월~토 일반 반올림, 일요일은 `total-assigned`.
- `buildWeeklyBudgetSnapshot`: 빈칸은 category default, 명시 입력 ID만 `explicitBudgetIds`에 포함.
- `resolveDailyBudget`: `Object.hasOwn(overrides,id)`로 0을 보존; 아니면 주간 예산을 요일별 배분.
- `calendarMonthCells`: 월요일 시작 42셀 `{date,day,inMonth,enabled,isToday}`; `enabled=inMonth && date<=today && dates.has(date)`.
- `summarizeDailyCategories`: 직접/자동 출처, 실제 합계, 달성률, 남음/초과를 계산하고 기록 있는 보관 대분류도 포함.

- [ ] **Step 4: 테스트 통과** — Run `node --test tests/time-budget-domain.test.js tests/domain.test.js`; expect PASS.

- [ ] **Step 5: Commit**

```bash
git add src/time-budget-domain.js tests/time-budget-domain.test.js
git commit -m "feat: add time budget domain"
```

---

### Task 2: Firestore 상태·주간 스냅숏·저장 함수

**Files:** Modify `src/app.js:17-185`; Create `tests/time-budget-integration.test.js`

**State additions:** `archivedCategories:[]`, `weeklyBudgets:[]`, `dailyBudgets:[]`, `timeBudgetSettings:{defaultDayWeights:EQUAL_DAY_WEIGHTS}`. Keep `weeklyBudget` as current-week compatibility alias.

- [ ] **Step 1: 실패 계약 테스트 작성**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const read=p=>readFile(new URL(`../${p}`,import.meta.url),'utf8');

test('앱은 신규 예산 경로와 저장 함수를 연결한다', async()=>{
  const s=await read('src/app.js');
  for (const text of ['archivedCategories','weeklyBudgets','dailyBudgets','settings','timeBudget',
    'ensureCurrentWeekSnapshot','saveDailyBudgetOverrides','saveCurrentWeekBudget','explicitBudgetIds','dayWeights'])
    assert.match(s,new RegExp(text));
});
```

- [ ] **Step 2: 실패 확인** — Run `node --test tests/time-budget-integration.test.js`; expect FAIL.

- [ ] **Step 3: `loadData()` 확장**

Use one `Promise.all()` to load active categories ordered by `order`, archived categories, entries, all weekly budgets, all daily budgets, and `settings/timeBudget`. Map documents to `{id,...data}`. `allCategories()` merges active then archived without duplicate ID.

- [ ] **Step 4: `ensureCurrentWeekSnapshot()` 구현**

Rules:

1. 새 주 문서: 모든 활성 대분류의 현재 기본 예산을 `budgets`, `explicitBudgetIds:[]`, 최근 기본 비율을 `dayWeights`에 저장.
2. 기존 legacy 문서: missing `dayWeights`는 균등; missing `explicitBudgetIds`는 기존 `budgets` 키로 간주.
3. 현재 주에 새 대분류가 생기면 기본 예산만 추가하고 기존 스냅숏은 유지.
4. 실제 변경이 있을 때만 `{merge:true}` 저장하고 한 번 재로딩.

- [ ] **Step 5: 저장 함수 구현**

`saveDailyBudgetOverrides(inputs)`:

- `parseOptionalHours()`로 명시 입력만 sparse `overrides`에 저장.
- 빈칸은 해당 키 제거, `0`은 유지.
- overrides가 비면 `dailyBudgets/{today}` 삭제, 아니면 `{date,overrides,updatedAt}` 저장.

`saveCurrentWeekBudget({budgetInputs,dayWeightInputs})`:

- `buildWeeklyBudgetSnapshot()` 생성.
- Firestore batch로 `weeklyBudgets/{weekStart}`와 `settings/timeBudget.defaultDayWeights`를 함께 저장.
- `dailyBudgets`는 수정하지 않는다.

- [ ] **Step 6: 테스트 보강**

```js
test('주간 저장은 batch로 비율 설정까지 저장하고 오늘 예산은 건드리지 않는다',async()=>{
  const s=await read('src/app.js');
  assert.match(s,/writeBatch/);
  assert.match(s,/defaultDayWeights/);
  const body=s.slice(s.indexOf('async function saveCurrentWeekBudget'),s.indexOf('async function',s.indexOf('async function saveCurrentWeekBudget')+20));
  assert.doesNotMatch(body,/dailyBudgets/);
});
```

- [ ] **Step 7: 검증** — Run `node --test tests/time-budget-integration.test.js tests/domain.test.js tests/ui-contract.test.js`; expect PASS.

- [ ] **Step 8: Commit**

```bash
git add src/app.js tests/time-budget-integration.test.js
git commit -m "feat: persist daily and weekly budgets"
```

---

### Task 3: `오늘 / 이번 주` 시간 예산 UI

**Files:** Create `src/time-budget-ui.js`, `tests/time-budget-ui.test.js`; Modify `src/app.js`, `index.html`

**Interfaces:** `createTimeBudgetUiState(today)`, `renderTimeBudgetHtml(model)`, `bindTimeBudgetControls(args)`.

- [ ] **Step 1: 실패 UI 테스트 작성**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import {createTimeBudgetUiState,renderTimeBudgetHtml} from '../src/time-budget-ui.js';
const model={mode:'today',today:'2026-07-26',categories:[{id:'reading',name:'독서',defaultBudgetMinutes:420}],
 weekDocument:{budgets:{reading:420},explicitBudgetIds:[],dayWeights:{mon:.2,tue:.2,wed:.1,thu:.1,fri:.1,sat:.2,sun:.1}},
 dailyDocument:{overrides:{reading:0}}};

test('오늘/이번 주와 저장 문구를 제공한다',()=>{
  assert.deepEqual(createTimeBudgetUiState('2026-07-26'),{mode:'today',today:'2026-07-26'});
  const html=renderTimeBudgetHtml(model);
  assert.match(html,/data-budget-mode="today"/);
  assert.match(html,/data-budget-mode="week"/);
  assert.match(html,/name="reading"[^>]*value="0"/);
  assert.match(html,/>저장<\/button>/);
  assert.doesNotMatch(html,/이번 주 예산과 비율 저장/);
});

test('이번 주 화면은 7개 공통 비율을 표시한다',()=>{
  const html=renderTimeBudgetHtml({...model,mode:'week'});
  for(const k of ['mon','tue','wed','thu','fri','sat','sun']) assert.match(html,new RegExp(`name="day-weight-${k}"`));
  assert.match(html,/요일별 공통 배분 비율/);
  assert.match(html,/환산/);
});
```

- [ ] **Step 2: 실패 확인** — Run `node --test tests/time-budget-ui.test.js`; expect module missing.

- [ ] **Step 3: HTML 생성 구현**

Today mode:

- 모든 활성 대분류 표시; input `type=number min=0 step=0.5`.
- override 키가 있으면 0 포함 value 표시, 없으면 빈 value.
- 자동 계산값과 `직접 설정/요일 비율 적용` 보조 문구 표시.

Week mode:

- `explicitBudgetIds` 포함 ID만 value 표시; 나머지는 빈칸과 `기본 X시간`.
- 월~일 7개 숫자 입력과 정규화 미리보기.
- 폼 하나, 하단 버튼 `저장`.

Both:

- `role=tablist`, `aria-selected`, 사용자 문자열 escape, 44px 터치 가능한 버튼.

- [ ] **Step 4: 이벤트 바인딩 구현**

- 탭 클릭: state mode 변경 후 rerender.
- 오늘 submit: 원문 `{categoryId:value}`를 `onSaveDaily`에 전달.
- 이번 주 submit: `{budgetInputs,dayWeightInputs}`를 `onSaveWeekly`에 전달.
- 비율 input 이벤트: `normalizeDayWeights()`로 미리보기 즉시 갱신.
- 저장 중 버튼 `저장 중…`/disabled; 성공·실패 후 복구, 실패 시 입력 유지.

- [ ] **Step 5: 앱 연결·제목 변경**

- `app.js`의 기존 `renderBudget()`를 새 모듈로 교체.
- `titles.budget`과 `index.html` 메뉴를 `시간 예산`으로 변경.
- 새 UI는 `app.js` import로만 로드하며 side-effect script 태그를 추가하지 않는다.

- [ ] **Step 6: 검증** — Run `node --test tests/time-budget-ui.test.js tests/time-budget-integration.test.js tests/ui-contract.test.js`; expect PASS.

- [ ] **Step 7: Commit**

```bash
git add src/time-budget-ui.js src/app.js index.html tests/time-budget-ui.test.js tests/time-budget-integration.test.js
git commit -m "feat: add today and weekly budget editor"
```

---

### Task 4: 일간·주간 대시보드와 기록 달력

**Files:** Modify `src/time-budget-ui.js`, `src/app.js`, `tests/time-budget-ui.test.js`

**Interfaces:** `createDashboardUiState(today,currentWeekStart)`, `renderDashboardHtml(model)`, `bindDashboardControls(args)`.

- [ ] **Step 1: 실패 테스트 작성**

```js
import {createDashboardUiState,renderDashboardHtml} from '../src/time-budget-ui.js';

test('대시보드 기본은 일간 오늘이고 기록 날짜 달력을 표시한다',()=>{
  assert.deepEqual(createDashboardUiState('2026-07-26','2026-07-20'),{
    mode:'daily',selectedDate:'2026-07-26',selectedWeekStart:'2026-07-20',calendarYear:2026,calendarMonth:7});
  const html=renderDashboardHtml({mode:'daily',selectedDate:'2026-07-24',today:'2026-07-26',
    calendarYear:2026,calendarMonth:7,recordDates:['2026-07-20','2026-07-24'],
    dailySummary:{totalBudgetMinutes:120,totalActualMinutes:90,percentage:75,categorySummaries:[]}});
  assert.match(html,/>전날</); assert.match(html,/>다음날</); assert.match(html,/기록 날짜 선택/); assert.match(html,/75%/);
});

test('이번 주에서 다음 주 버튼은 비활성화된다',()=>{
  const html=renderDashboardHtml({mode:'weekly',selectedWeekStart:'2026-07-20',currentWeekStart:'2026-07-20',
    weeklySummary:{totalBudgetMinutes:420,totalActualMinutes:210,percentage:50,categorySummaries:[]}});
  assert.match(html,/data-week-direction="next"[^>]*disabled/);
});
```

- [ ] **Step 2: 실패 확인** — Run `node --test tests/time-budget-ui.test.js`; expect missing exports.

- [ ] **Step 3: 일간 HTML·달력 구현**

- 탭 `일간/주간`, 전날/다음날/오늘, 사용자 정의 월 달력.
- 기록 날짜만 `<button data-dashboard-date>` 활성화; 기록 없음·미래는 native disabled.
- 전체 적용 예산/실제 기록/달성률, 대분류별 실제/예산/달성률/예산 출처 표시.
- 예산 0에 실제가 있으면 `예산 미설정`.

- [ ] **Step 4: 주간 HTML 구현**

- 전주/다음 주, 선택 범위, 전체 달성률과 대분류별 달성률.
- `selectedWeekStart >= currentWeekStart`이면 다음 주 disabled.
- 일간 override는 주간 요약에 사용하지 않는다.

- [ ] **Step 5: 이벤트 구현**

- 전날=`previousRecordedDate`; 다음날=`nextRecordedDateOrToday`; 오늘 버튼은 today.
- 달력 월 이동은 미래 월 금지; 활성 날짜만 선택.
- 주 이동은 기존 `moveWeekStart()` 사용, currentWeekStart 초과 금지.

- [ ] **Step 6: 앱 모델 조립**

- 과거 이름은 active+archived 대분류로 해석.
- 자동 예산은 선택 날짜의 주간 문서와 일간 문서로 `summarizeDailyCategories()` 계산.
- 주간 요약은 선택 주 문서 `budgets`와 기존 `summarizeCategories()` 사용.
- legacy 주 문서의 missing dayWeights는 균등.
- 대시보드가 보일 때만 `#week-label`을 선택 기간으로 갱신; 통계 화면의 제목 제어는 기존 모듈에 맡긴다.

- [ ] **Step 7: 검증** — Run `node --test tests/time-budget-ui.test.js tests/time-budget-domain.test.js tests/time-budget-integration.test.js tests/domain.test.js`; expect PASS.

- [ ] **Step 8: Commit**

```bash
git add src/time-budget-ui.js src/app.js tests/time-budget-ui.test.js
git commit -m "feat: add daily and weekly dashboards"
```

---

### Task 5: 복구 가능한 단일 타이머 도메인

**Files:** Create `src/persistent-timer.js`, `tests/persistent-timer.test.js`

**Interfaces:**

```js
createActiveTimer({userId,categoryId,note,startedAt,startDate})
elapsedTimerSeconds(timer,now)
loadLocalTimer(storage,userId)
saveLocalTimer(storage,timer)
clearLocalTimer(storage)
createPersistentTimerController({userId,remote,storage,now,onChange})
// remote: read(), write(timer), finish(timer,entry), remove()
// controller: restore(), start(data), finish(), cancel(), current(), elapsedSeconds()
```

- [ ] **Step 1: 실패 테스트 작성**

```js
import test from 'node:test'; import assert from 'node:assert/strict';
import {createActiveTimer,elapsedTimerSeconds,createPersistentTimerController} from '../src/persistent-timer.js';
const memoryStorage=()=>{const m=new Map();return{getItem:k=>m.get(k)??null,setItem:(k,v)=>m.set(k,v),removeItem:k=>m.delete(k)}};

test('절대 시작 시각으로 백그라운드 시간을 계산한다',()=>{
  const t=createActiveTimer({userId:'u1',categoryId:'reading',note:'',startedAt:1000,startDate:'2026-07-26'});
  assert.equal(elapsedTimerSeconds(t,3601000),3600);
});

test('원격 타이머가 있으면 새 타이머를 만들지 않는다',async()=>{
  const t=createActiveTimer({userId:'u1',categoryId:'reading',note:'',startedAt:1000,startDate:'2026-07-26'}); let writes=0;
  const c=createPersistentTimerController({userId:'u1',storage:memoryStorage(),now:()=>5000,
    remote:{read:async()=>t,write:async()=>{writes++},finish:async()=>{},remove:async()=>{}}});
  await c.restore(); assert.deepEqual(await c.start({categoryId:'thesis',startDate:'2026-07-26'}),t); assert.equal(writes,0);
});

test('종료 실패 시 상태를 유지하고 성공 후에만 지운다',async()=>{
  let fail=true; const c=createPersistentTimerController({userId:'u1',storage:memoryStorage(),now:()=>61000,
    remote:{read:async()=>null,write:async()=>{},finish:async()=>{if(fail)throw new Error('network')},remove:async()=>{}}});
  await c.start({categoryId:'reading',note:'',startDate:'2026-07-26',startedAt:1000});
  await assert.rejects(c.finish(),/network/); assert.ok(c.current()); fail=false;
  const entry=await c.finish(); assert.equal(entry.durationMinutes,1); assert.equal(c.current(),null);
});
```

- [ ] **Step 2: 실패 확인** — Run `node --test tests/persistent-timer.test.js`; expect module missing.

- [ ] **Step 3: 구현**

- local JSON 오류는 삭제 후 null; 다른 userId는 null.
- restore: local 후보 후 remote 조회; 유효 remote 우선, remote null은 stale local 삭제.
- remote read 실패 시 local 후보 유지하되 새 타이머를 중복 시작하지 않는다.
- start: remote write 성공 후에만 current/local 설정.
- finish entry: startDate, 정확한 duration, local HH:MM, source `timer`; remote finish 성공 후에만 clear.
- cancel: remote remove 성공 후에만 clear; 기록은 생성하지 않는다.

- [ ] **Step 4: 검증** — Run `node --test tests/persistent-timer.test.js`; expect PASS.

- [ ] **Step 5: Commit**

```bash
git add src/persistent-timer.js tests/persistent-timer.test.js
git commit -m "feat: add persistent timer controller"
```

---

### Task 6: Firestore activeTimer와 기존 타이머 UI 연결

**Files:** Modify `src/app.js`, `tests/time-budget-integration.test.js`, `tests/ui-contract.test.js`

- [ ] **Step 1: 실패 계약 테스트 추가**

```js
test('앱은 activeTimer를 복구하고 batch로 기록 완료한다',async()=>{
  const s=await read('src/app.js');
  for(const text of ['createPersistentTimerController','activeTimer','current','visibilitychange','timerController.restore','timerController.finish','writeBatch'])
    assert.match(s,new RegExp(text.replace('.','\\.')));
});
```

- [ ] **Step 2: Firestore remote adapter 구현**

Path: `users/{uid}/activeTimer/current`.

- `read`: getDoc; Timestamp는 `.toMillis()`.
- `write`: setDoc timer.
- `remove`: deleteDoc.
- `finish`: 새 entry ref를 만들고 batch set(entry+createdAt) + batch delete(activeTimer) 후 commit.

- [ ] **Step 3: 로그인 복구 순서**

`loadData()` → `ensureCurrentWeekSnapshot()` → 사용자별 controller 생성 → `controller.restore()` → `renderAll()`.

Logout은 메모리 interval만 정리하고 Firestore activeTimer를 삭제하지 않는다.

- [ ] **Step 4: `bindTimer()` 교체**

- 시작: 대분류 검사, Firestore 저장 대기 중 버튼 disabled; 기존 activeTimer면 그것을 복구.
- 종료: controller.finish 성공 후 load/render; 실패 시 `다시 시도` 안내와 실행 상태 유지.
- 취소: 확인 후 controller.cancel; 삭제 실패 시 상태 유지.
- running select는 `state.timer.categoryId`를 계속 표시.

- [ ] **Step 5: 화면 복귀 갱신**

```js
document.addEventListener('visibilitychange',()=>{if(!document.hidden&&state.timer)updateTimerDisplay()});
window.addEventListener('pageshow',()=>{if(state.timer)updateTimerDisplay()});
```

`setInterval`은 표시만 갱신하고 카운터를 누적하지 않는다.

- [ ] **Step 6: 검증** — Run `node --test tests/persistent-timer.test.js tests/time-budget-integration.test.js tests/ui-contract.test.js`; expect PASS.

- [ ] **Step 7: Commit**

```bash
git add src/app.js tests/time-budget-integration.test.js tests/ui-contract.test.js
git commit -m "fix: restore timers after background and reload"
```

---

### Task 7: 삭제·통계·보안 호환성과 반응형 CSS

**Files:** Modify `src/category-delete-guard.js`, `styles.css`, tests; modify stats only on failing regression.

- [ ] **Step 1: 삭제·규칙 실패 계약 테스트 추가**

```js
test('완전 삭제는 신규 예산과 타이머 참조를 정리한다',async()=>{
  const s=await read('src/category-delete-guard.js');
  for(const text of ['dailyBudgets','overrides','explicitBudgetIds','activeTimer','categoryId']) assert.match(s,new RegExp(text));
});

test('Firestore 신규 경로는 사용자 wildcard 규칙으로 보호된다',async()=>{
  const r=await read('firestore.rules');
  assert.match(r,/match \/users\/\{userId\}\/\{document=\*\*\}/);
  assert.match(r,/request\.auth\.uid == userId/);
});
```

- [ ] **Step 2: `permanentlyDelete()` 확장**

- weeklyBudgets: `budgets[id]`와 `explicitBudgetIds` 제거.
- dailyBudgets: `overrides[id]` 제거; empty 문서는 삭제.
- matching activeTimer 삭제.
- archive는 예산·기록을 수정하지 않는다.
- 기존 450-operation batch 제한 유지.

- [ ] **Step 3: 통계 호환 테스트 추가**

`tests/domain.test.js`에서 metadata가 붙은 주간 문서의 `budgets`가 기존 `summarizeBudgetPeriod()`에 동일하게 반영되는지 검사한다. 통과하면 통계 코드를 변경하지 않는다. 실패할 때만 metadata를 무시하고 `budgets`만 읽도록 최소 수정한다.

- [ ] **Step 4: 반응형 CSS 계약 테스트 추가**

```js
test('신규 화면은 선택 버튼 없는 적응형 CSS를 사용한다',async()=>{
  const [css,html,ui]=await Promise.all([read('styles.css'),read('index.html'),read('src/time-budget-ui.js')]);
  assert.doesNotMatch(html+ui,/넓은 화면|모바일 화면/);
  for(const token of ['.time-budget-tabs','.dashboard-tabs','.day-weight-grid','.record-calendar','minmax(0, 1fr)','@media(max-width:600px)'])
    assert.match(css,new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')));
});
```

- [ ] **Step 5: CSS 구현**

- 넓은 화면: category row `minmax(0,1fr) minmax(120px,180px)`, day weights 7열, calendar max 420px.
- 모바일 600px: category/summary 1열, day weights 2열, 기간 날짜는 첫 행 전체, save full width.
- 모든 input/button 44px touch target, `max-width:100%`, `box-sizing:border-box`; fixed min-width 금지.
- 탭 `role=tablist/aria-selected`, 달력 disabled native, timer `aria-live=polite`.

- [ ] **Step 6: 검증** — Run `node --test tests/time-budget-integration.test.js tests/time-budget-ui.test.js tests/domain.test.js tests/ui-contract.test.js`; expect PASS.

- [ ] **Step 7: Commit**

```bash
git add src/category-delete-guard.js styles.css tests
git commit -m "feat: complete responsive budget dashboard integration"
```

---

### Task 8: 전체 회귀·Pages 산출물 검증

**Files:** Verify all changed files and generated `_site`.

- [ ] **Step 1: 문법 검사 계약 확대**

In `tests/ui-contract.test.js`, run `node --check` for:

```js
['src/app.js','src/time-budget-domain.js','src/time-budget-ui.js','src/persistent-timer.js','src/category-delete-guard.js']
```

- [ ] **Step 2: 전체 테스트** — Run `npm test`; expect exit 0 and all tests PASS.

- [ ] **Step 3: Pages build** — Run `npm run prepare:pages`; expect exit 0 and these files:

```text
_site/index.html
_site/styles.css
_site/src/time-budget-domain.js
_site/src/time-budget-ui.js
_site/src/persistent-timer.js
```

- [ ] **Step 4: 수동 브라우저 검증** — Run `npm start` and verify:

1. 일간 오늘 기본, 기록 날짜만 활성, 가장 가까운 기록 날짜 이동.
2. 일간·주간 미래 이동 차단.
3. 오늘/이번 주 빈칸과 0 구분, 비율 자동 환산, 버튼 `저장`.
4. 주간 설정 변경 후 오늘 직접 예산 유지.
5. 새 주에는 이전 오늘 override가 이월되지 않고 비율은 이월.
6. 잠금·앱 전환·새로고침 후 타이머 경과와 선택 대분류 복구.
7. 종료 실패 시 타이머 유지, 성공 후 한 건만 기록.
8. 360px 가로 스크롤 없음.
9. 통계·기록 내역·보관·완전 삭제·로그인 회귀 없음.

- [ ] **Step 5: 최종 검증**

```bash
npm test
npm run prepare:pages
node --check src/app.js
node --check src/time-budget-domain.js
node --check src/time-budget-ui.js
node --check src/persistent-timer.js
```

Expected: every command exits 0. PR 생성·병합 전 이 결과를 다시 확인한다.

- [ ] **Step 6: Final commit if verification added files**

```bash
git add tests src index.html styles.css
if ! git diff --cached --quiet; then git commit -m "test: verify time budget dashboard release"; fi
```
