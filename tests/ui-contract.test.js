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
    '기록이 있는 달 기준 월평균 기록 시간',
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
  assert.match(statisticsSource, /summarizeWeeklyBudgetPeriod/);
  assert.match(statisticsSource, /summarizeRecordedMonthlyBudgetPeriod/);
  assert.match(statisticsSource, /summarizeRecordedYearlyBudgetPeriod/);
  assert.match(statisticsSource, /detailedRecordedMonthlyBudgetComparison/);
  assert.match(statisticsSource, /detailedRecordedYearlyBudgetComparison/);
  assert.match(statisticsSource, /weeklyBudgets/);
});

test('통계 탭은 주별 통계를 첫 항목으로 제공한다', async () => {
  const statisticsSource = await read('src/statistics-ui.js');
  assert.match(statisticsSource, /\[\['weekly','주별 통계'\]/);
  assert.match(statisticsSource, /이전 주/);
  assert.match(statisticsSource, /다음 주/);
  assert.match(statisticsSource, /data-week-offset/);
  assert.match(statisticsSource, /moveWeekStart/);
});

test('통계 화면의 기간 제목은 선택한 통계 기간을 표시한다', async () => {
  const statisticsSource = await read('src/statistics-ui.js');
  assert.match(statisticsSource, /예산 대비 통계/);
  assert.match(statisticsSource, /기록 월 비교/);
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

test('수동 입력은 시각 범위와 분 직접 입력 방식을 제공한다', async () => {
  const appSource = await read('src/app.js');
  assert.match(appSource, /manualInputMode:\s*MANUAL_INPUT_MODES\.TIME_RANGE/);
  assert.match(appSource, /manualCategoryId:\s*''/);
  assert.match(appSource, /data-manual-mode="time-range"/);
  assert.match(appSource, /data-manual-mode="duration"/);
  assert.match(appSource, /시작·종료 시각/);
  assert.match(appSource, /분 직접 입력/);
  assert.match(appSource, /id="manual-duration"/);
  assert.match(appSource, /<form id="manual-form" class="form-grid" novalidate>/);
});

test('방식 변경은 대분류를 유지하고 선택한 필드만 다시 그린다', async () => {
  const appSource = await read('src/app.js');
  assert.match(appSource, /state\.manualCategoryId\s*=\s*\$\('#manual-category'\)\?\.value/);
  assert.match(appSource, /state\.manualInputMode\s*=\s*button\.dataset\.manualMode/);
  assert.match(appSource, /state\.manualInputMode\s*===\s*MANUAL_INPUT_MODES\.DURATION/);
  assert.match(appSource, /class="time-fields"/);
  assert.match(appSource, /class="duration-input-row"/);
  assert.match(appSource, /renderRecord\(\)/);
});

test('분 직접 입력은 별도 source로 저장하고 오류 문구를 표시한다', async () => {
  const appSource = await read('src/app.js');
  assert.match(appSource, /createManualDurationEntry\(\{/);
  assert.match(appSource, /durationMinutes:\s*\$\('#manual-duration'\)\.value/);
  assert.match(appSource, /state\.manualCategoryId\s*=\s*categoryId/);
  assert.match(appSource, /alert\(error instanceof Error \? error\.message : String\(error\)\)/);
});

test('기존 시각 방식은 빈 시각과 잘못된 범위를 검사한다', async () => {
  const appSource = await read('src/app.js');
  assert.match(appSource, /if \(!startTime \|\| !endTime\)/);
  assert.match(appSource, /minutesBetween\(startTime, endTime\)/);
  assert.match(appSource, /시간 범위를 확인하세요/);
});

test('기록 내역은 공통 formatter를 사용한다', async () => {
  const appSource = await read('src/app.js');
  assert.match(appSource, /manualEntryTimeLabel\(entry,\s*formatMinutes\)/);
  assert.doesNotMatch(appSource, /\$\{entry\.startTime \|\| ''\}–\$\{entry\.endTime \|\| ''\}/);
});
