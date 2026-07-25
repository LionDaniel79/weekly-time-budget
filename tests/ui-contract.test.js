import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('통계 탭은 통계 모듈이 직접 만들고 클릭 시 최신 데이터를 불러온다', async () => {
  const [indexHtml, statisticsSource] = await Promise.all([
    read('index.html'),
    read('src/statistics-ui.js'),
  ]);
  assert.doesNotMatch(indexHtml, /data-statistics-nav/);
  assert.match(statisticsSource, /button\.addEventListener\(['"]click['"]/);
  assert.match(statisticsSource, /renderStatistics\(\)/);
  assert.match(statisticsSource, /await loadStatisticsData\(\)/);
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
