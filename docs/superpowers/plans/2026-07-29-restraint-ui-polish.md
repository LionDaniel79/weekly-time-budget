# 절제 목표 UI 정돈 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 대분류 추가 화면의 절제 체크박스와 제목을 한 줄로 정렬하고, 예산 이내 절제 진행 막대의 색을 일반 성장 목표와 같은 녹색으로 통일한다.

**Architecture:** 현재 HTML 구조와 목표 계산 로직은 유지하고 `styles.css`의 선택자 우선순위와 색상 선언만 수정한다. 회귀 테스트는 CSS 계약을 직접 검사하며, PWA가 변경된 CSS를 즉시 갱신하도록 서비스 워커 셸 캐시 버전을 한 단계 올린다.

**Tech Stack:** HTML/CSS, JavaScript ES modules, Node.js `node:test`, GitHub Actions, GitHub Pages PWA

## Global Constraints

- 체크박스와 `절제 목표` 문구는 같은 줄에 표시한다.
- 보조 설명은 제목 아래 줄에 유지한다.
- 예산 이내 절제 막대는 일반 성장 목표와 같은 `#2b7665`를 사용한다.
- 예산 초과 절제 막대는 기존 `#c23b36`을 유지한다.
- 목표 계산, 막대 너비, 대분류 데이터 구조는 변경하지 않는다.
- 서비스 워커 캐시 버전을 `weekly-time-budget-shell-v11`로 갱신한다.

---

### Task 1: UI 회귀 계약 추가

**Files:**
- Modify: `tests/restraint-ui-integration.test.js`

**Interfaces:**
- Consumes: `styles.css`의 절제 목표 CSS 클래스와 `service-worker.js`의 셸 캐시 이름
- Produces: 한 줄 배치, 정상 녹색, 초과 빨간색, PWA v11을 고정하는 회귀 테스트

- [ ] **Step 1: 실패 테스트 작성**

`tests/restraint-ui-integration.test.js`에 다음 검사를 추가한다.

```js
test('절제 목표 선택 제목은 체크박스 옆 한 줄에 배치한다', async () => {
  const css = await read('styles.css');
  assert.match(css, /\.form-grid label\.restraint-goal-option\s*\{[^}]*display:\s*flex/);
  assert.match(css, /\.restraint-goal-option\s+input\s*\{[^}]*flex:\s*0\s+0\s+auto/);
  assert.match(css, /\.restraint-goal-option\s+strong\s*\{[^}]*white-space:\s*nowrap/);
});

test('절제 정상 막대는 공통 녹색이고 초과 막대는 빨간색을 유지한다', async () => {
  const css = await read('styles.css');
  assert.match(css, /restraint-remaining[^}]*background:\s*#2b7665/);
  assert.match(css, /restraint-overage[^}]*background:\s*#c23b36/);
});
```

기존 PWA 테스트의 캐시 버전 기대값을 `weekly-time-budget-shell-v11`로 변경한다.

- [ ] **Step 2: RED 확인**

Run: `npm test`

Expected: 한 줄 배치 선택자와 녹색 선언, v11 캐시가 아직 없어 실패한다.

- [ ] **Step 3: RED 커밋**

```bash
git add tests/restraint-ui-integration.test.js tests

git commit -m "test: define restraint UI polish contracts"
```

---

### Task 2: 절제 선택 배치와 진행 막대 색상 수정

**Files:**
- Modify: `styles.css`

**Interfaces:**
- Consumes: 기존 `.restraint-goal-option`, `.restraint-remaining`, `.restraint-overage` 마크업 클래스
- Produces: 체크박스·제목 가로 배치와 정상 녹색 진행 막대

- [ ] **Step 1: 최소 CSS 구현**

기존 선언을 다음 계약에 맞게 수정한다.

```css
.progress.restraint-remaining > span,
.stat-bar-fill.restraint-remaining {
  background: #2b7665;
}

.form-grid label.restraint-goal-option {
  display: flex;
  gap: 10px;
  align-items: flex-start;
}

.restraint-goal-option input {
  width: auto;
  margin-top: 3px;
  flex: 0 0 auto;
}

.restraint-goal-option strong {
  white-space: nowrap;
}
```

`restraint-overage`의 `#c23b36` 선언은 그대로 둔다.

- [ ] **Step 2: 관련 테스트 실행**

Run: `node --test tests/restraint-ui-integration.test.js`

Expected: PASS

- [ ] **Step 3: 전체 테스트 실행**

Run: `npm test`

Expected: 서비스 워커 v11 계약만 남기고 UI 테스트는 PASS

- [ ] **Step 4: CSS 커밋**

```bash
git add styles.css tests/restraint-ui-integration.test.js

git commit -m "fix: align restraint option and unify progress color"
```

---

### Task 3: PWA 캐시 갱신과 최종 검증

**Files:**
- Modify: `service-worker.js`
- Modify: 서비스 워커 버전을 고정하는 관련 `tests/*.test.js`

**Interfaces:**
- Consumes: 현재 `weekly-time-budget-shell-v10`
- Produces: `weekly-time-budget-shell-v11`과 최신 CSS가 포함된 Pages 앱 셸

- [ ] **Step 1: 캐시 버전 갱신**

`service-worker.js`와 버전을 직접 검사하는 테스트의 문자열을 다음으로 변경한다.

```js
const SHELL_CACHE = 'weekly-time-budget-shell-v11';
```

- [ ] **Step 2: 전체 검증**

Run: `npm test`

Expected: 모든 테스트 PASS, 실패 0개

Run: `FIREBASE_API_KEY=test-api-key FIREBASE_AUTH_DOMAIN=test.firebaseapp.com FIREBASE_PROJECT_ID=test-project FIREBASE_STORAGE_BUCKET=test.firebasestorage.app FIREBASE_MESSAGING_SENDER_ID=123456789 FIREBASE_APP_ID=1:123456789:web:test npm run prepare:pages`

Expected: exit 0

Run:

```bash
test -f _site/styles.css
test -f _site/service-worker.js
grep -q 'weekly-time-budget-shell-v11' _site/service-worker.js
grep -q '#2b7665' _site/styles.css
```

Expected: exit 0

- [ ] **Step 3: 최종 커밋**

```bash
git add service-worker.js tests styles.css

git commit -m "chore: refresh PWA cache for restraint UI polish"
```

- [ ] **Step 4: PR 생성과 병합 준비**

`feat/restraint-ui-polish`에서 `main`을 대상으로 PR을 생성하고, 전체 테스트·Pages 산출물·PWA v11 검증 결과를 PR 본문에 기록한다.
