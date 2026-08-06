import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  previousSameWeekdayMinutes,
  roundedPreviousWeekBudgetMinutes,
  buildPreviousWeekBudgetDefaults,
} from '../src/time-budget-domain.js';
import { adjacentWeekStart } from '../src/recorded-period-domain.js';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

const entries = [
  { date: '2026-07-27', categoryId: 'bible', durationMinutes: 80 },
  { date: '2026-07-27', categoryId: 'bible', durationMinutes: 40 },
  { date: '2026-07-28', categoryId: 'bible', durationMinutes: 102 },
  { date: '2026-07-29', categoryId: 'bible', durationMinutes: 1 },
  { date: '2026-07-30', categoryId: 'sermon', durationMinutes: 221 },
  { date: '2026-08-03', categoryId: 'bible', durationMinutes: 999, deleted: true },
];

test('오늘 예산 기본값은 지난주 같은 요일의 실제 기록 합계다', () => {
  assert.equal(previousSameWeekdayMinutes(entries, 'bible', '2026-08-03'), 120);
  assert.equal(previousSameWeekdayMinutes(entries, 'sermon', '2026-08-03'), 0);
});

test('이번 주 기본값은 지난주 실제 합계를 30분 단위로 올림한다', () => {
  assert.equal(roundedPreviousWeekBudgetMinutes(entries, 'bible', '2026-08-03'), 240);
  assert.equal(roundedPreviousWeekBudgetMinutes(entries, 'sermon', '2026-08-03'), 240);
  assert.deepEqual(buildPreviousWeekBudgetDefaults({
    categories: [{ id: 'bible' }, { id: 'sermon' }, { id: 'prayer' }],
    entries,
    weekStart: '2026-08-03',
  }), { bible: 240, sermon: 240, prayer: 0 });
});

test('주별 통계는 기록 유무와 관계없이 한 주씩 앞뒤로 이동하고 현재 주를 넘지 않는다', () => {
  assert.equal(adjacentWeekStart('2026-07-20', 'next', '2026-08-03'), '2026-07-27');
  assert.equal(adjacentWeekStart('2026-07-27', 'next', '2026-08-03'), '2026-08-03');
  assert.equal(adjacentWeekStart('2026-08-03', 'next', '2026-08-03'), null);
  assert.equal(adjacentWeekStart('2026-07-27', 'previous', '2026-08-03'), '2026-07-20');
});

test('대분류 관리와 저장 흐름에서 기본 주간 예산을 제거한다', async () => {
  const [categoryFeature, app] = await Promise.all([
    read('src/category-feature.js'),
    read('src/app.js'),
  ]);
  assert.doesNotMatch(categoryFeature, /기본 주간 예산|name="hours"|defaultBudgetMinutes/);
  const saveStart = app.indexOf('async function saveCategory');
  const saveEnd = app.indexOf('async function archiveCategory', saveStart);
  assert.doesNotMatch(app.slice(saveStart, saveEnd), /defaultBudgetMinutes|budgetMinutes/);
});
