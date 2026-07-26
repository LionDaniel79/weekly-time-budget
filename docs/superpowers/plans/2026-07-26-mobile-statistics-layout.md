# 모바일 통계 화면 반응형 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 데스크톱 통계 표의 폭을 줄이고, 화면 폭 800px 이하에서는 모든 통계 표를 가로 스크롤 없는 카드형 목록으로 표시한다.

**Architecture:** 기존 통계 계산 함수와 Firestore 데이터 흐름은 변경하지 않는다. `src/statistics-ui.js`의 표 마크업에 `data-label`과 구분 클래스를 추가하고, 같은 파일의 스타일 미디어 쿼리에서 표 행을 카드로 재배치한다. 모바일 전환은 CSS만 사용하며 화면 크기 감지용 JavaScript나 재계산 로직을 추가하지 않는다.

**Tech Stack:** Vanilla JavaScript ES modules, HTML table markup, CSS media queries, Node.js built-in test runner

## Global Constraints

- 801px 이상에서는 기존 표 구조와 비교 기능을 유지한다.
- 800px 이하에서는 통계 표의 가로 스크롤을 제거한다.
- 통계 계산 방식, 예산 배분 방식, 표시 항목은 변경하지 않는다.
- 모바일 본문 글자 크기는 최소 14px 수준을 유지한다.
- 외부 CSS·차트·UI 라이브러리를 추가하지 않는다.
- HTML 의미 구조는 `table`, `thead`, `tbody`, `tr`, `td`를 유지한다.

---

### Task 1: 모바일 카드 전환 회귀 테스트 추가

**Files:**
- Create: `tests/mobile-statistics-layout.test.js`
- Read: `src/statistics-ui.js`

**Interfaces:**
- Consumes: `src/statistics-ui.js`가 생성하는 통계 표 마크업과 `injectStyles()`의 CSS 문자열
- Produces: 모바일 카드 마크업과 CSS 규칙을 고정하는 회귀 테스트

- [ ] **Step 1: 실패하는 소스 구조 테스트 작성**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const sourceUrl = new URL('../src/statistics-ui.js', import.meta.url);

async function source() {
  return readFile(sourceUrl, 'utf8');
}

test('모든 통계 표 셀은 모바일 항목명을 위한 data-label을 가진다', async () => {
  const code = await source();
  for (const label of [
    '대분류', '기간', '기간 예산', '실제 기록', '달성률', '차이',
    '기록 일수', '하루 평균', '전월 대비', '전년 대비', '전체',
  ]) {
    assert.match(code, new RegExp(`data-label=["']${label}["']`));
  }
});

test('800px 이하에서는 통계 표가 가로 스크롤 없는 카드형으로 전환된다', async () => {
  const code = await source();
  assert.match(code, /@media\(max-width:800px\)/);
  assert.match(code, /\.statistics-table-wrap\s*\{[^}]*overflow-x\s*:\s*visible/s);
  assert.match(code, /\.statistics-table\s*\{[^}]*min-width\s*:\s*0/s);
  assert.match(code, /\.statistics-table thead\s*\{[^}]*display\s*:\s*none/s);
  assert.match(code, /\.statistics-table tbody\s*\{[^}]*display\s*:\s*grid/s);
  assert.match(code, /\.statistics-table tr\s*\{[^}]*display\s*:\s*grid/s);
  assert.match(code, /\.statistics-table td::before\s*\{[^}]*content\s*:\s*attr\(data-label\)/s);
});

test('모바일 통계 스타일 변경 후에도 자바스크립트 문법이 유효하다', () => {
  const path = fileURLToPath(sourceUrl);
  const result = spawnSync(process.execPath, ['--check', path], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr || result.stdout);
});
```

- [ ] **Step 2: 테스트를 실행해 실패 확인**

Run:

```bash
node --test tests/mobile-statistics-layout.test.js
```

Expected: `data-label`, 모바일 카드 CSS 또는 `overflow-x: visible` 규칙이 없어 FAIL

- [ ] **Step 3: 테스트 파일 커밋**

```bash
git add tests/mobile-statistics-layout.test.js
git commit -m "test: define mobile statistics card layout"
```

---

### Task 2: 데스크톱 통계 표 폭 압축

**Files:**
- Modify: `src/statistics-ui.js` — `injectStyles()`의 기본 통계 표 스타일
- Test: `tests/mobile-statistics-layout.test.js`

**Interfaces:**
- Consumes: 기존 `.statistics-table`, `.achievement-cell`, `.matrix-cell` 클래스
- Produces: 801px 이상에서 더 조밀한 통계 표

- [ ] **Step 1: 데스크톱 표 폭 관련 실패 테스트 보강**

`tests/mobile-statistics-layout.test.js`에 다음 테스트를 추가한다.

```js
test('데스크톱 통계 표는 기존 760px보다 작은 최소 폭과 압축된 셀 여백을 사용한다', async () => {
  const code = await source();
  assert.doesNotMatch(code, /min-width\s*:\s*760px/);
  assert.doesNotMatch(code, /padding\s*:\s*12px 10px/);
  assert.match(code, /\.achievement-cell\s*\{[^}]*min-width\s*:\s*1[4-8]0px/s);
});
```

- [ ] **Step 2: 테스트를 실행해 실패 확인**

Run:

```bash
node --test tests/mobile-statistics-layout.test.js
```

Expected: 기존 `min-width:760px`, `padding:12px 10px`, `achievement-cell min-width:210px` 때문에 FAIL

- [ ] **Step 3: 기본 표 스타일을 압축**

`src/statistics-ui.js`의 `injectStyles()`에서 다음 원칙으로 수정한다.

```css
.achievement-cell{min-width:160px}
.achievement-line{grid-template-columns:minmax(80px,1fr) 52px;gap:7px}
.statistics-table{width:100%;border-collapse:collapse;min-width:620px;table-layout:auto}
.statistics-table th,.statistics-table td{
  padding:9px 7px;
  border-bottom:1px solid #e1e4de;
  text-align:right;
  white-space:normal;
  vertical-align:middle;
  font-size:.9rem;
}
.matrix-cell{display:grid;gap:2px;min-width:118px}
```

첫 번째 열은 이름이 잘리지 않도록 `min-width`를 유지하고, 수치 열은 필요한 경우 자연스럽게 줄바꿈하도록 한다.

- [ ] **Step 4: 테스트 실행**

Run:

```bash
node --test tests/mobile-statistics-layout.test.js
```

Expected: 데스크톱 압축 테스트 PASS, 아직 모바일 카드 테스트는 FAIL 가능

- [ ] **Step 5: 커밋**

```bash
git add src/statistics-ui.js tests/mobile-statistics-layout.test.js
git commit -m "style: compact desktop statistics tables"
```

---

### Task 3: 통계 셀에 모바일 레이블과 행렬 구분 클래스 추가

**Files:**
- Modify: `src/statistics-ui.js` — `categoryAchievementTable()`, `comparisonDetailTable()`, `categoryBudgetMatrix()`
- Test: `tests/mobile-statistics-layout.test.js`

**Interfaces:**
- Consumes: 각 렌더 함수의 기존 `summary`, `items`, `labelFormatter` 데이터
- Produces: CSS가 모바일 카드의 항목명을 표시할 수 있는 `data-label` 속성

- [ ] **Step 1: 월간·연간 대분류 달성 표 마크업 수정**

`categoryAchievementTable()`의 셀을 다음 형태로 만든다.

```js
<td data-label="대분류" class="statistics-card-title"><strong>${escapeHtml(row.name)}</strong></td>
<td data-label="기간 예산">${formatMinutes(row.budgetMinutes)}</td>
<td data-label="실제 기록">${formatMinutes(row.actualMinutes)}</td>
<td data-label="달성률" class="achievement-cell">...</td>
<td data-label="차이"><span class="difference ...">...</span></td>
```

- [ ] **Step 2: 기간별 상세 비교 표 마크업 수정**

`comparisonDetailTable()`에서 기간과 비교 열의 레이블을 동적으로 지정한다.

```js
<td data-label="기간" class="statistics-card-title"><strong>${labelFormatter(item[labelKey])}</strong></td>
<td data-label="기간 예산">${formatMinutes(item.totalBudgetMinutes)}</td>
<td data-label="실제 기록">${formatMinutes(item.totalActualMinutes)}</td>
<td data-label="달성률">${overallAchievementText(item)}</td>
<td data-label="기록 일수">${item.recordDays}일</td>
<td data-label="하루 평균">${formatMinutes(item.dailyAverageMinutes)}</td>
<td data-label="${changeLabel}">${formatChange(item)}</td>
```

- [ ] **Step 3: 대분류 행렬 표 마크업 수정**

`categoryBudgetMatrix()`의 표에 `statistics-matrix-table` 클래스를 추가한다. 각 대분류 셀의 레이블은 대분류 이름을 사용한다.

```js
<table class="statistics-table statistics-matrix-table">
...
<td data-label="기간" class="statistics-card-title">...</td>
<td data-label="${escapeHtml(categoryById.get(id)?.name || '삭제된 대분류')}">
  <div class="matrix-cell">...</div>
</td>
<td data-label="전체" class="statistics-matrix-total">...</td>
```

동적 대분류 이름은 속성에 넣기 전에 반드시 `escapeHtml()`을 적용한다.

- [ ] **Step 4: 테스트 실행**

Run:

```bash
node --test tests/mobile-statistics-layout.test.js
```

Expected: `data-label` 테스트 PASS, 모바일 CSS 테스트는 아직 FAIL

- [ ] **Step 5: 커밋**

```bash
git add src/statistics-ui.js tests/mobile-statistics-layout.test.js
git commit -m "feat: label statistics cells for mobile cards"
```

---

### Task 4: 800px 이하 통계 표를 카드형으로 전환

**Files:**
- Modify: `src/statistics-ui.js` — `injectStyles()`의 `@media(max-width:800px)` 블록
- Test: `tests/mobile-statistics-layout.test.js`

**Interfaces:**
- Consumes: Task 3의 `data-label`, `statistics-card-title`, `statistics-matrix-table`, `statistics-matrix-total`
- Produces: 가로 스크롤 없는 모바일 카드형 통계 화면

- [ ] **Step 1: 모바일 카드 CSS 구현**

기존 모바일 미디어 쿼리를 다음 규칙으로 교체·확장한다.

```css
@media(max-width:800px){
  .statistics-controls>*{flex:1;min-width:120px}
  .comparison-row{grid-template-columns:1fr}
  .comparison-values{text-align:left}

  .statistics-table-wrap{
    overflow-x:visible;
    margin-top:12px;
  }
  .statistics-table{
    display:block;
    width:100%;
    min-width:0;
  }
  .statistics-table thead{display:none}
  .statistics-table tbody{
    display:grid;
    gap:12px;
    width:100%;
  }
  .statistics-table tr{
    display:grid;
    width:100%;
    padding:14px;
    border:1px solid #dde3de;
    border-radius:14px;
    background:#fffdf7;
    box-sizing:border-box;
  }
  .statistics-table td,
  .statistics-table td:first-child{
    position:static;
    display:grid;
    grid-template-columns:minmax(92px,38%) minmax(0,1fr);
    gap:10px;
    align-items:center;
    width:100%;
    min-width:0;
    padding:8px 0;
    border:0;
    border-bottom:1px solid #edf0ec;
    text-align:right;
    white-space:normal;
    font-size:.875rem;
    background:transparent;
  }
  .statistics-table td:last-child{border-bottom:0}
  .statistics-table td::before{
    content:attr(data-label);
    color:#6d7873;
    font-size:.8rem;
    font-weight:700;
    text-align:left;
  }
  .statistics-table .statistics-card-title{
    display:block;
    padding:0 0 10px;
    margin-bottom:2px;
    border-bottom:1px solid #dfe4df;
    text-align:left;
    font-size:1rem;
  }
  .statistics-table .statistics-card-title::before{display:none}
  .achievement-cell{min-width:0}
  .achievement-line{
    grid-template-columns:minmax(0,1fr) 52px;
    width:100%;
  }
  .matrix-cell{
    min-width:0;
    text-align:right;
    white-space:normal;
  }
  .statistics-matrix-table td:not(.statistics-card-title){
    align-items:start;
  }
  .statistics-matrix-total{
    margin-top:4px;
    padding-top:11px !important;
    border-top:1px solid #d7ddd8 !important;
  }
}
```

- [ ] **Step 2: 작은 화면에서 탭과 요약 카드 간격 보정**

같은 미디어 쿼리에 다음을 추가한다.

```css
.statistics-tabs{gap:6px}
.statistics-tabs .tab-button{flex:1 1 calc(50% - 6px);padding:9px 8px}
.statistics-summary{grid-template-columns:1fr 1fr;gap:10px}
.statistics-summary .card{padding:14px}
.statistics-card{padding:16px}
.statistics-explanation,.statistics-note{font-size:.82rem}
```

360px 이하에서는 요약 카드도 한 열로 전환한다.

```css
@media(max-width:360px){
  .statistics-summary{grid-template-columns:1fr}
}
```

- [ ] **Step 3: 모바일 레이아웃 테스트 실행**

Run:

```bash
node --test tests/mobile-statistics-layout.test.js
```

Expected: 모든 모바일 레이아웃 테스트 PASS

- [ ] **Step 4: 전체 테스트 실행**

Run:

```bash
npm test
```

Expected: 기존 통계 계산·화면 분리·미래 월 제외 테스트를 포함해 0 failures

- [ ] **Step 5: 커밋**

```bash
git add src/statistics-ui.js tests/mobile-statistics-layout.test.js
git commit -m "feat: render statistics tables as mobile cards"
```

---

### Task 5: 최종 회귀 검증과 적용

**Files:**
- Verify: `src/statistics-ui.js`
- Verify: `tests/mobile-statistics-layout.test.js`
- Verify: `tests/ui-structure.test.js`
- Verify: `tests/future-months.test.js`

**Interfaces:**
- Consumes: Task 1~4의 완성된 마크업과 CSS
- Produces: 개발 브랜치에 병합 가능한 검증된 변경

- [ ] **Step 1: 자바스크립트 구문 검사**

Run:

```bash
node --check src/statistics-ui.js
```

Expected: 출력 없이 exit 0

- [ ] **Step 2: 전체 테스트 재실행**

Run:

```bash
npm test
```

Expected: 0 failures

- [ ] **Step 3: 요구사항 소스 검토**

다음을 직접 확인한다.

```bash
grep -n "data-label" src/statistics-ui.js
grep -n "overflow-x:visible\|min-width:0\|td::before" src/statistics-ui.js
grep -n "min-width:760px\|min-width:700px" src/statistics-ui.js
```

Expected:
- 모든 표 렌더 함수에 `data-label` 존재
- 모바일 카드 핵심 CSS 존재
- 기존 760px·700px 강제 최소 너비 없음

- [ ] **Step 4: PR 생성 및 CI 확인**

```bash
git push -u origin agent/mobile-statistics-layout
```

PR 기준:
- Base: `agent/build-mvp`
- Head: `agent/mobile-statistics-layout`
- 제목: `feat: improve mobile statistics layout`

Expected: GitHub Actions CI success

- [ ] **Step 5: 개발 브랜치 병합**

CI가 성공한 뒤 PR을 `agent/build-mvp`에 병합한다.
