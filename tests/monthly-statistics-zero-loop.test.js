import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

// textContent를 같은 값으로 다시 써도 childList mutation이 발생하므로 멱등성 검사가 필요하다.
test('0분 월간 통계의 목표 준수 보정은 DOM을 한 번만 변경한다', async () => {
  const source = await read('src/recorded-period-navigation.js');
  const start = source.indexOf('function patchZeroAchievement');
  const end = source.indexOf('function optionMarkup', start);
  const patch = source.slice(start, end);

  assert.match(patch, /achievement\.textContent\?\.trim\(\)\s*!==\s*['"]—['"]/);
  assert.match(patch, /achievement\.textContent\s*=\s*['"]—['"]/);
});

test('월간 통계 수정본을 최신 앱 셸로 배포한다', async () => {
  const worker = await read('service-worker.js');
  assert.ok(worker.includes("weekly-time-budget-shell-v14"));
  assert.ok(worker.includes('./src/recorded-period-navigation.js'));
  assert.ok(worker.includes('./src/statistics-offline-rescue.js'));
});
