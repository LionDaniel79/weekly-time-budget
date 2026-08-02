import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('통계 상태 복원은 메뉴를 다시 클릭하지 않고 feature에 직접 적용한다', async () => {
  const bootstrap = await read('src/statistics-bootstrap.js');
  assert.match(bootstrap, /weekly-time-budget:ui-state-restored[\s\S]*feature\.restore\(event\.detail\?\.statistics/);
  assert.doesNotMatch(bootstrap, /\.click\(\)|MutationObserver/);
});

test('통계가 보이는 복원 상태에서는 직접 enter하여 캐시를 불러온다', async () => {
  const bootstrap = await read('src/statistics-bootstrap.js');
  assert.match(bootstrap, /event\.detail\?\.activeView === 'statistics'[\s\S]*feature\.enter\(\)/);
});
