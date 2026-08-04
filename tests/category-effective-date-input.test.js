import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const record = await readFile(new URL('../src/record-feature.js', import.meta.url), 'utf8');
const timer = await readFile(new URL('../src/persistent-timer-ui.js', import.meta.url), 'utf8');

test('수동 입력은 날짜 변경 때 목록을 갱신하고 저장 직전 재검증한다', () => {
  assert.match(record, /refreshManualCategoryOptions/);
  assert.match(record, /manual-date[^\n]*addEventListener\(['"]change['"]/);
  assert.match(record, /isCategoryActiveOnDate\(category, date\)/);
  assert.match(record, /이 대분류는 추가일 이전 날짜에 기록할 수 없습니다\./);
});

test('영구 타이머는 현재 활성 목록과 시작일 검증을 사용한다', () => {
  assert.match(timer, /filterCategoriesActiveOnDate/);
  assert.match(timer, /const category = state\.categories\.find\(/);
  assert.match(timer, /isCategoryActiveOnDate\(category, startedDate\)/);
  assert.match(timer, /!activeCategories\.some/);
});

test('보관 대분류 선택지는 진행 중 타이머 복구 때만 유지한다', () => {
  assert.match(timer, /activeTimer\?\.categoryId === selectedId/);
  assert.match(timer, /controller\.recover\(\)/);
  assert.match(timer, /isCategoryActiveOnDate\(category, startedDate\)/);
});

test('진행 중 타이머가 없으면 비활성 마지막 선택과 미리보기를 지운다', () => {
  assert.match(timer, /if \(!timer && selectedId && \(!selectedCategory \|\| !isCategoryActiveOnDate\(selectedCategory, currentDate\)\)\)/);
  assert.match(timer, /localStorage\.removeItem\(LAST_CATEGORY_KEY\)/);
  assert.match(timer, /state\.previewBaseline = null/);
});
