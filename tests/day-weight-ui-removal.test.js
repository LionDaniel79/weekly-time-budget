import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('시간 예산 화면은 요일별 공통 배분 비율 편집 UI를 제공하지 않는다', async () => {
  const ui = await read('src/time-budget-ui.js');
  assert.doesNotMatch(ui, /요일별 공통 배분 비율/);
  assert.doesNotMatch(ui, /day-weight-section|day-weight-grid|day-weight-preview/);
  assert.doesNotMatch(ui, /name=\"day-weight-/);
  assert.doesNotMatch(ui, /updateWeightPreview/);
});

test('주간 예산 저장은 기존 요일 배분값을 보존하고 설정 문서를 다시 쓰지 않는다', async () => {
  const [feature, dataSource] = await Promise.all([
    read('src/time-budget-feature.js'),
    read('src/app-data-source.js'),
  ]);
  assert.match(feature, /buildWeeklyBudgetSnapshot\([\s\S]*dayWeightInputs:\s*existing\.dayWeights/);
  assert.doesNotMatch(feature, /async function saveWeekly\(\{ budgetInputs, dayWeightInputs \}\)/);
  assert.match(feature, /이번 주 시간 예산을 저장했습니다/);

  const start = dataSource.indexOf('async saveWeeklyBudget');
  const end = dataSource.indexOf('async saveCategory', start);
  const saveWeeklySource = dataSource.slice(start, end);
  assert.doesNotMatch(saveWeeklySource, /settings/);
  assert.doesNotMatch(saveWeeklySource, /defaultDayWeights/);
});
