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
  assert.doesNotMatch(ui, /DAY_KEYS|DAY_LABELS|normalizeDayWeights|effectiveDayWeights/);
});

test('주간 예산 저장 이벤트는 대분류별 예산만 전달한다', async () => {
  const ui = await read('src/time-budget-ui.js');
  assert.match(ui, /onSaveWeekly\(\{ budgetInputs \}\)/);
  assert.doesNotMatch(ui, /dayWeightInputs/);
});
