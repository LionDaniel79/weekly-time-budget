import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('통계 모듈은 브라우저에서 읽을 수 있는 올바른 자바스크립트 문법이다', () => {
  for (const relative of ['../src/statistics-state.js', '../src/statistics-data-source.js', '../src/statistics-view.js', '../src/statistics-feature.js', '../src/statistics-bootstrap.js']) {
    const path = fileURLToPath(new URL(relative, import.meta.url));
    const result = spawnSync(process.execPath, ['--check', path], { encoding: 'utf8' });
    assert.equal(result.status, 0, `${relative}: ${result.stderr || result.stdout}`);
  }
});

test('통계 화면은 기본 앱 전환과 단일 feature 경계로 독립 전환된다', async () => {
  const [events, bootstrap, feature] = await Promise.all([
    read('src/view-change-events.js'), read('src/statistics-bootstrap.js'), read('src/statistics-feature.js'),
  ]);
  assert.match(events, /weekly-time-budget:view-changed/);
  assert.match(bootstrap, /feature\.enter\(\)|feature\.leave\(\)/);
  assert.match(feature, /root\.addEventListener\('click', onClick\)/);
  assert.doesNotMatch(feature, /#history-view|MutationObserver|stopImmediatePropagation/);
});

test('통계는 기록 구성비 대신 예산 대비 달성률을 표시한다', async () => {
  const source = await read('src/statistics-view.js');
  for (const label of ['기간 예산', '실제 기록', '달성률', '남음', '초과', '기록이 있는 달 기준 월평균', '기록 일수', '하루 평균', '전월 대비', '전년 대비']) {
    assert.match(source, new RegExp(label));
  }
  assert.doesNotMatch(source, /전체 비율|categoryBreakdown/);
  for (const token of ['summarizeWeeklyBudgetPeriod', 'summarizeRecordedMonthlyBudgetPeriod', 'summarizeRecordedYearlyBudgetPeriod', 'detailedRecordedMonthlyBudgetComparison', 'detailedRecordedYearlyBudgetComparison', 'weeklyBudgets']) {
    assert.ok(source.includes(token), token);
  }
});

test('통계 탭은 주별 통계를 첫 항목으로 제공한다', async () => {
  const source = await read('src/statistics-view.js');
  const weekly = source.indexOf("weekly: '주별 통계'");
  const monthly = source.indexOf("monthly: '월간 통계'");
  assert.ok(weekly >= 0 && monthly > weekly);
  assert.match(source, /이전 주/);
  assert.match(source, /다음 주/);
  assert.match(source, /data-statistics-week/);
});

test('통계 화면의 기간 제목은 선택한 통계 기간을 표시한다', async () => {
  const source = await read('src/statistics-view.js');
  assert.match(source, /예산 대비 통계/);
  assert.match(source, /기록 월 비교/);
  assert.match(source, /전체 연도 비교/);
  assert.match(source, /headerText/);
});

test('대분류는 이름·기본예산·순서를 한 번에 저장한다', async () => {
  const [indexHtml, editorSource] = await Promise.all([
    read('index.html'),
    read('src/category-bulk-editor.js'),
  ]);
  assert.match(indexHtml, /category-bulk-editor\.js/);
  assert.match(editorSource, />저장<\/button>/);
  assert.match(editorSource, /writeBatch/);
  assert.match(editorSource, /defaultBudgetMinutes/);
  assert.match(editorSource, /order:\s*index\s*\+\s*1/);
});

test('수동 입력은 시각 범위와 분 직접 입력 방식을 제공한다', async () => {
  const appSource = await read('src/record-feature.js');
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
  const appSource = await read('src/record-feature.js');
  assert.match(appSource, /state\.manualCategoryId\s*=\s*\$\('#manual-category'\)\?\.value/);
  assert.match(appSource, /state\.manualInputMode\s*=\s*button\.dataset\.manualMode/);
  assert.match(appSource, /state\.manualInputMode\s*===\s*MANUAL_INPUT_MODES\.DURATION/);
  assert.match(appSource, /class="time-fields"/);
  assert.match(appSource, /class="duration-input-row"/);
  assert.match(appSource, /renderRecord\(\)/);
});

test('분 직접 입력은 별도 source로 저장하고 오류 문구를 표시한다', async () => {
  const appSource = await read('src/record-feature.js');
  assert.match(appSource, /createManualDurationEntry\(\{/);
  assert.match(appSource, /durationMinutes:\s*\$\('#manual-duration'\)\.value/);
  assert.match(appSource, /state\.manualCategoryId\s*=\s*categoryId/);
  assert.match(appSource, /alert\(error instanceof Error \? error\.message : String\(error\)\)/);
});

test('기존 시각 방식은 빈 시각과 잘못된 범위를 검사한다', async () => {
  const appSource = await read('src/record-feature.js');
  assert.match(appSource, /if \(!startTime \|\| !endTime\)/);
  assert.match(appSource, /minutesBetween\(startTime, endTime\)/);
  assert.match(appSource, /시간 범위를 확인하세요/);
});

test('기록 내역은 공통 formatter를 사용한다', async () => {
  const historySource = await read('src/history-feature.js');
  assert.match(historySource, /manualEntryTimeLabel\(entry,\s*formatMinutes\)/);
  assert.doesNotMatch(historySource, /\$\{entry\.startTime \|\| ''\}–\$\{entry\.endTime \|\| ''\}/);
});
