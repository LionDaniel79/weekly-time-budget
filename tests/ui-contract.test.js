import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('통계 탭은 기본 화면 전환 체계에 포함된다', async () => {
  const [indexHtml, appSource] = await Promise.all([
    read('index.html'),
    read('src/app.js'),
  ]);
  assert.match(indexHtml, /data-view="statistics"/);
  assert.match(appSource, /views\s*=\s*\[[^\]]*['"]statistics['"]/s);
  assert.match(appSource, /statistics:\s*['"]통계['"]/);
});

test('대분류는 이름·기본예산·순서를 한 번에 적용한다', async () => {
  const appSource = await read('src/app.js');
  assert.match(appSource, /id="category-bulk-form"/);
  assert.match(appSource, /대분류 변경사항 적용/);
  assert.match(appSource, /saveCategoriesBulk/);
});

test('기록 저장 뒤 통계 화면은 최신 데이터를 다시 불러온다', async () => {
  const [appSource, statisticsSource] = await Promise.all([
    read('src/app.js'),
    read('src/statistics-ui.js'),
  ]);
  assert.match(appSource, /weekly-time-budget:data-changed/);
  assert.match(statisticsSource, /weekly-time-budget:data-changed/);
  assert.match(statisticsSource, /statisticsBound/);
});
