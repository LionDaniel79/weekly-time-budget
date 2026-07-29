import test from 'node:test';
import assert from 'node:assert/strict';
import {
  filterCategoriesActiveOnDate,
  isCategoryActiveInRange,
  isCategoryActiveOnDate,
  isEntryWithinCategoryEffectiveDate,
  normalizeCategoryCreatedDate,
  normalizeDateKey,
} from '../src/category-effective-date.js';

test('유효한 날짜 키만 정규화한다', () => {
  assert.equal(normalizeDateKey('2026-07-29'), '2026-07-29');
  assert.equal(normalizeDateKey('2026-02-30'), null);
  assert.equal(normalizeDateKey('invalid'), null);
});

test('생성일이 없는 기존 대분류는 과거 오늘 미래에 모두 활성이다', () => {
  const category = { id: 'legacy' };
  assert.equal(isCategoryActiveOnDate(category, '2020-01-01'), true);
  assert.equal(isCategoryActiveOnDate(category, '2026-07-29'), true);
  assert.equal(isCategoryActiveOnDate(category, '2030-12-31'), true);
});

test('새 대분류는 생성일부터 활성이다', () => {
  const category = { id: 'phone', createdDate: '2026-07-29' };
  assert.equal(isCategoryActiveOnDate(category, '2026-07-28'), false);
  assert.equal(isCategoryActiveOnDate(category, '2026-07-29'), true);
  assert.equal(isCategoryActiveOnDate(category, '2026-07-30'), true);
});

test('잘못된 생성일은 기존 데이터 보호를 위해 제한 없음으로 처리한다', () => {
  const category = { createdDate: '2026-02-30' };
  assert.equal(normalizeCategoryCreatedDate(category), null);
  assert.equal(isCategoryActiveOnDate(category, '2026-01-01'), true);
});

test('기간 종료일보다 늦게 생성된 대분류는 기간에서 제외한다', () => {
  const category = { createdDate: '2026-07-29' };
  assert.equal(isCategoryActiveInRange(category, '2026-07-01', '2026-07-28'), false);
  assert.equal(isCategoryActiveInRange(category, '2026-07-01', '2026-07-31'), true);
});

test('생성일 이전 비정상 기록만 제외한다', () => {
  const category = { createdDate: '2026-07-29' };
  assert.equal(isEntryWithinCategoryEffectiveDate({ date: '2026-07-28' }, category), false);
  assert.equal(isEntryWithinCategoryEffectiveDate({ date: '2026-07-29' }, category), true);
  assert.equal(isEntryWithinCategoryEffectiveDate({ date: '2020-01-01' }, null), true);
});

test('날짜별 필터는 원래 순서를 유지한다', () => {
  const categories = [
    { id: 'legacy' },
    { id: 'future', createdDate: '2026-07-30' },
    { id: 'today', createdDate: '2026-07-29' },
  ];
  assert.deepEqual(
    filterCategoriesActiveOnDate(categories, '2026-07-29').map((item) => item.id),
    ['legacy', 'today'],
  );
});
