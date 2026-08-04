import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('app은 대시보드와 시간 예산 DOM을 렌더링하지 않는다', async () => {
  const source = await read('src/app.js');
  assert.doesNotMatch(source, /function renderDashboard\(/);
  assert.doesNotMatch(source, /function renderBudget\(/);
  assert.doesNotMatch(source, /legacyGoalProgressHtml|legacyGoalDetail/);
  assert.doesNotMatch(source, /function saveWeeklyBudget\(/);
});

test('app의 전체 렌더는 기록을 갱신하고 기록 내역·대분류 상태를 발행한다', async () => {
  const source = await read('src/app.js');
  const start = source.indexOf('function renderAll()');
  const end = source.indexOf('\nfunction ', start + 1);
  const body = source.slice(start, end);
  assert.match(body, /renderRecord\(\)/);
  assert.match(body, /publishHistoryState\(\)/);
  assert.match(body, /publishCategoryState\(\)/);
  assert.doesNotMatch(body, /renderDashboard|renderBudget|renderHistory|renderCategories/);
});

test('기록 변경 이벤트에서 app은 기록 내역 상태만 다시 발행한다', async () => {
  const source = await read('src/app.js');
  const start = source.indexOf("document.addEventListener('weekly-time-budget:entries-changed'");
  const end = source.indexOf("document.addEventListener('weekly-time-budget:data-changed'", start);
  const body = source.slice(start, end);
  assert.match(body, /publishHistoryState\(\)/);
  assert.doesNotMatch(body, /renderDashboard|renderBudget|renderHistory/);
});
