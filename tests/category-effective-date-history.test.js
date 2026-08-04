import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');
const history = await read('src/history-feature.js');
const statisticsView = await read('src/statistics-view.js');

test('기록 내역은 생성일 이전 비정상 기록을 필터링한다', () => {
  assert.match(history, /isEntryWithinCategoryEffectiveDate/);
  assert.match(history, /model\.entries\.filter/);
  assert.match(history, /최근 기록[\s\S]*?\$\{entries\.length\}건/);
});

test('통계는 생성일 규칙이 반영된 공통 기간 요약만 사용한다', () => {
  assert.match(statisticsView, /summarizeWeeklyBudgetPeriod/);
  assert.match(statisticsView, /summarizeRecordedMonthlyBudgetPeriod/);
  assert.match(statisticsView, /summarizeRecordedYearlyBudgetPeriod/);
  assert.doesNotMatch(statisticsView, /createdDate\s*[<>]=?/);
});

test('통계 비교는 기록이 존재하는 기간만 공통 상세 비교 함수로 만든다', () => {
  assert.match(statisticsView, /detailedRecordedMonthlyBudgetComparison/);
  assert.match(statisticsView, /detailedRecordedYearlyBudgetComparison/);
  assert.doesNotMatch(statisticsView, /Array\.from\(\{ length: 12 \}/);
});
