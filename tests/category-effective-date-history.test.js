import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const history = await readFile(new URL('../src/category-ui-patch.js', import.meta.url), 'utf8');
const statistics = await readFile(new URL('../src/statistics-ui.js', import.meta.url), 'utf8');
const rescue = await readFile(new URL('../src/statistics-offline-rescue.js', import.meta.url), 'utf8');

test('기록 내역은 생성일 이전 비정상 기록을 필터링한다', () => {
  assert.match(history, /isEntryWithinCategoryEffectiveDate/);
  assert.match(history, /entriesSnapshot\.docs[\s\S]*?\.filter\(/);
  assert.match(history, /최근 기록[\s\S]*?\$\{entries\.length\}건/);
});

test('오프라인 통계는 공통 기간 요약만 사용한다', () => {
  assert.match(rescue, /summarizeWeeklyBudgetPeriod/);
  assert.match(rescue, /summarizeRecordedMonthlyBudgetPeriod/);
  assert.match(rescue, /summarizeRecordedYearlyBudgetPeriod/);
  assert.doesNotMatch(rescue, /createdDate\s*[<>]=?/);
});

test('통계 비교 표는 생성 전 칸을 0시간으로 만들지 않는다', () => {
  assert.match(statistics, /if \(!category\)/);
  assert.match(statistics, /<span class="muted">—<\/span>/);
});
