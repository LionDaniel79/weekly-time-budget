import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const app = await readFile(new URL('../src/app.js', import.meta.url), 'utf8');
const timer = await readFile(new URL('../src/persistent-timer-ui.js', import.meta.url), 'utf8');

test('수동 입력은 날짜 변경 때 목록을 갱신하고 저장 직전 재검증한다', () => {
  assert.match(app, /refreshManualCategoryOptions/);
  assert.match(app, /manual-date[^\n]*addEventListener\(['"]change['"]/);
  assert.match(app, /isCategoryActiveOnDate\(category, date\)/);
  assert.match(app, /이 대분류는 추가일 이전 날짜에 기록할 수 없습니다\./);
});

test('영구 타이머는 현재 활성 목록과 시작일 검증을 사용한다', () => {
  assert.match(timer, /filterCategoriesActiveOnDate/);
  assert.match(timer, /isCategoryActiveOnDate\(category, startedDate\)/);
  assert.match(timer, /!activeCategories\.some/);
});

test('생성일 검증은 기존 타이머 복구 경로를 유지한다', () => {
  assert.match(timer, /controller\.recover\(\)/);
  assert.match(timer, /selectedId && !activeCategories\.some/);
  assert.match(timer, /isCategoryActiveOnDate\(category, startedDate\)/);
});
