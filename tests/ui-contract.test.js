import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('통계 모듈은 브라우저에서 읽을 수 있는 올바른 자바스크립트 문법이다', () => {
  const path = fileURLToPath(new URL('../src/statistics-ui.js', import.meta.url));
  const result = spawnSync(process.execPath, ['--check', path], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr || result.stdout);
});

test('통계 화면은 기록 내역과 동시에 보이지 않도록 독립 전환된다', async () => {
  const statisticsSource = await read('src/statistics-ui.js');
  assert.match(statisticsSource, /dataset\.view\s*=\s*['"]statistics['"]/);
  assert.match(statisticsSource, /closest\(\s*['"]\.nav-button['"]\s*\)/);
  assert.match(statisticsSource, /#statistics-view/);
  assert.match(statisticsSource, /classList\.add\(['"]hidden['"]\)/);
  assert.doesNotMatch(statisticsSource, /#history-view[^\n]*innerHTML/);
});

test('통계는 기록 구성비 대신 예산 대비 달성률을 표시한다', async () => {
  const statisticsSource = await read('src/statistics-ui.js');
  for (const label of [
    '기간 예산',
    '실제 기록',
    '달성률',
    '남음',
    '초과',
    '월평균 기록 시간',
    '기록 일수',
    '하루 평균',
    '전월 대비',
    '전년 대비',
    '월별 대분류 예산·실제',
    '연도별 대분류 예산·실제',
  ]) {
    assert.match(statisticsSource, new RegExp(label));
  }
  assert.doesNotMatch(statisticsSource, /전체 비율/);
  assert.doesNotMatch(statisticsSource, /categoryBreakdown/);
  assert.match(statisticsSource, /summarizeBudgetPeriod/);
  assert.match(statisticsSource, /detailedMonthlyBudgetComparison/);
  assert.match(statisticsSource, /detailedYearlyBudgetComparison/);
  assert.match(statisticsSource, /weeklyBudgets/);
});

test('통계 화면의 기간 제목은 주간 범위 대신 선택한 통계 기간을 표시한다', async () => {
  const statisticsSource = await read('src/statistics-ui.js');
  assert.match(statisticsSource, /예산 대비 통계/);
  assert.match(statisticsSource, /1월~12월 비교/);
  assert.match(statisticsSource, /전체 연도 비교/);
  assert.match(statisticsSource, /restoreWeeklyHeader/);
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
