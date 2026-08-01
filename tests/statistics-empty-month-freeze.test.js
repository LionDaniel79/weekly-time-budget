import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('빈 월간 통계의 목표 준수 보정은 같은 문구를 다시 쓰지 않는다', async () => {
  const source = await read('src/recorded-period-navigation.js');
  const start = source.indexOf('function patchZeroAchievement');
  const end = source.indexOf('function optionMarkup', start);
  const patchSource = source.slice(start, end);

  assert.ok(start >= 0 && end > start, 'patchZeroAchievement 함수가 필요합니다.');
  assert.match(patchSource, /achievement\.textContent\s*!==\s*['"]—['"]/);
  assert.match(patchSource, /achievement\.textContent\s*=\s*['"]—['"]/);
});

test('월간 통계 멈춤 수정 코드를 배포하도록 앱 셸 캐시를 v13으로 올린다', async () => {
  const worker = await read('service-worker.js');
  assert.ok(worker.includes("weekly-time-budget-shell-v13"));
  assert.ok(worker.includes('./src/recorded-period-navigation.js'));
});
