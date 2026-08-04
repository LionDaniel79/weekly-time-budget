import test from 'node:test';
import assert from 'node:assert/strict';
import { isArchivedCategoryVisibleInRange } from '../src/category-effective-date.js';

test('보관한 대분류는 보관일이 포함된 현재 대시보드 기간에서 숨긴다', () => {
  const category = { archivedAt: { seconds: Date.UTC(2026, 7, 4) / 1000 } };

  assert.equal(isArchivedCategoryVisibleInRange(category, '2026-08-04', '2026-08-04'), false);
  assert.equal(isArchivedCategoryVisibleInRange(category, '2026-08-03', '2026-08-09'), false);
});

test('보관 전 과거 대시보드에서는 기록 보존을 위해 대분류 이름을 유지한다', () => {
  const category = { archivedAt: { seconds: Date.UTC(2026, 7, 4) / 1000 } };

  assert.equal(isArchivedCategoryVisibleInRange(category, '2026-07-27', '2026-08-02'), true);
});

test('보관 시각이 없는 구형 보관 데이터는 현재 대시보드에 노출하지 않는다', () => {
  assert.equal(isArchivedCategoryVisibleInRange({}, '2026-08-04', '2026-08-04'), false);
});
