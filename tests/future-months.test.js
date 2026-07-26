import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('월간 비교는 DOM 후처리 없이 기록이 존재하는 달만 직접 렌더링한다', async () => {
  const [indexHtml, statisticsSource] = await Promise.all([
    read('index.html'),
    read('src/statistics-ui.js'),
  ]);
  assert.doesNotMatch(indexHtml, /current-month-statistics\.js/);
  assert.match(statisticsSource, /detailedRecordedMonthlyBudgetComparison/);
  assert.match(statisticsSource, /기록 월 비교/);
  assert.doesNotMatch(statisticsSource, /visibleComparisonMonthCount/);
});
