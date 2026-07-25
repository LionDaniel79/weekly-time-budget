import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { detailedMonthlyBudgetComparison } from '../src/domain.js';

const categories = [{ id: 'reading', name: '독서', defaultBudgetMinutes: 420 }];
const referenceDate = new Date('2026-07-26T12:00:00+09:00');

test('현재 연도의 월간 비교는 현재 월까지만 계산한다', () => {
  const result = detailedMonthlyBudgetComparison([], categories, [], 2026, referenceDate);
  assert.equal(result.length, 7);
  assert.deepEqual(result.map((item) => item.month), [1, 2, 3, 4, 5, 6, 7]);
  assert.equal(result.some((item) => item.month >= 8), false);
});

test('과거 연도의 월간 비교는 12개월 전체를 계산한다', () => {
  const result = detailedMonthlyBudgetComparison([], categories, [], 2025, referenceDate);
  assert.equal(result.length, 12);
  assert.equal(result.at(-1).month, 12);
});

test('미래 연도의 월간 비교는 아직 통계에 포함하지 않는다', () => {
  const result = detailedMonthlyBudgetComparison([], categories, [], 2027, referenceDate);
  assert.deepEqual(result, []);
});

test('월간 비교 제목은 현재 연도에 12월을 고정 표시하지 않는다', async () => {
  const source = await readFile(new URL('../src/statistics-ui.js', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /1월~12월 비교/);
  assert.match(source, /monthlyComparisonLastMonth/);
});
