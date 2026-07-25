import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('통계 화면은 기록 내역과 동시에 보이지 않도록 독립 전환된다', async () => {
  const statisticsSource = await read('src/statistics-ui.js');
  assert.match(statisticsSource, /dataset\.view\s*=\s*['"]statistics['"]/);
  assert.match(statisticsSource, /closest\(\s*['"]\.nav-button['"]\s*\)/);
  assert.match(statisticsSource, /#statistics-view/);
  assert.match(statisticsSource, /classList\.add\(['"]hidden['"]\)/);
  assert.doesNotMatch(statisticsSource, /#history-view[^\n]*innerHTML/);
});

test('확정된 통계 표시 항목을 모두 제공한다', async () => {
  const statisticsSource = await read('src/statistics-ui.js');
  for (const label of [
    '전체 비율',
    '월평균 기록 시간',
    '기록 일수',
    '하루 평균',
    '전월 대비',
    '전년 대비',
    '월별 대분류 합계',
    '연도별 대분류 합계',
  ]) {
    assert.match(statisticsSource, new RegExp(label));
  }
  assert.match(statisticsSource, /detailedMonthlyComparison/);
  assert.match(statisticsSource, /detailedYearlyComparison/);
});

test('대분류는 이름·기본예산·순서를 한 번에 적용한다', async () => {
  const [indexHtml, editorSource] = await Promise.all([
    read('index.html'),
    read('src/category-bulk-editor.js'),
  ]);
  assert.match(indexHtml, /category-bulk-editor\.js/);
  assert.match(editorSource, /대분류 변경사항 적용/);
  assert.match(editorSource, /writeBatch/);
  assert.match(editorSource, /defaultBudgetMinutes/);
  assert.match(editorSource, /order:\s*index\s*\+\s*1/);
});