# Exclude Restraint Goals from Aggregate Time Metrics Implementation Plan

**Goal:** 절제 목표의 예산·실제 시간을 대시보드와 통계의 상위 시간 합계·평균·비교에서 제외하되, 개별 대분류와 목표 준수 점수에는 유지한다.

## Task 1 — Regression tests (RED)

- 새 테스트 `tests/restraint-time-totals-regression.test.js`를 만든다.
- 성장/절제 혼합 데이터로 일간·주간 대시보드 요약을 검증한다.
- 주별·월간·연간 통계 총합/평균과 월간·연간 비교를 검증한다.
- 절제 항목이 category summaries와 목표 준수 계산에 계속 남는지 검증한다.
- 절제만 있는 기간의 목표 준수 표시가 사라지지 않아야 한다는 UI 계약을 추가한다.
- 기존 카드/열 이름을 유지하고 안내 문구가 존재하는지 source contract로 고정한다.
- PR CI에서 현재 코드가 새 테스트를 실패시키는 것을 확인한다.

## Task 2 — Shared aggregate rule

- `src/goal-domain.js`에 `isIncludedInTimeTotals(goalType)`를 추가한다.
- `normalizeGoalType(goalType) !== 'restraint'`만 상위 시간 합계에 포함한다.

## Task 3 — Dashboard aggregates

- `src/time-budget-domain.js`의 `summarizeDailyCategories()`와 `summarizeWeeklyEffectiveCategories()`에서 category summaries 전체는 유지한다.
- `totalBudgetMinutes`, `totalActualMinutes`, `differenceMinutes`, `status`, `dailyAverageMinutes` 계산에는 성장 항목만 사용한다.
- 목표 준수 계산은 전체 category summaries로 유지한다.

## Task 4 — Statistics aggregates

- `src/domain.js`의 `finalizeBudgetSummary()`와 `combineBudgetSummaries()`에서 상위 시간 총합은 성장 항목만 사용한다.
- 기록 일수/기록 월·주 판정은 현재 기록 존재 기준을 유지한다.
- 비교 증감과 연간 월평균은 수정된 total actual을 그대로 사용한다.

## Task 5 — UI note and restraint-only compliance

- `src/time-budget-ui.js` 대시보드에 `※ 시간 합계와 평균은 절제 목표를 제외하여 계산합니다.` 안내를 추가한다.
- `src/statistics-view.js` 통계에도 동일 안내를 추가한다.
- 기존 지표 이름은 변경하지 않는다.
- `achievementText()`가 상위 시간 합계 0 여부로 목표 준수를 숨기지 않도록 `goalComplianceStatus`를 기준으로 표시한다.

## Task 6 — GREEN and delivery

- 새 회귀 테스트를 통과시킨다.
- `npm test`, Chromium Playwright, Pages artifact 검증을 모두 통과시킨다.
- diff를 재검토해 대분류 개별 수치·목표 준수 로직·주간 기간 규칙이 변경되지 않았는지 확인한다.
- PR을 열고 최종 CI가 성공하면 사용자 요청에 따라 병합/배포 단계로 진행한다.
