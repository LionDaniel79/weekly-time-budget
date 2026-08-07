import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('통계 상태 복원은 메뉴를 다시 클릭하지 않고 feature에 직접 적용한다', async () => {
  const bootstrap = await read('src/statistics-bootstrap.js');
  assert.match(bootstrap, /weekly-time-budget:ui-state-restored[\s\S]*feature\.restore\(event\.detail\?\.statistics/);
  assert.doesNotMatch(bootstrap, /\.click\(\)|MutationObserver/);
});

test('통계 복원은 enter를 중복 호출하지 않고 view-changed가 진입을 소유한다', async () => {
  const bootstrap = await read('src/statistics-bootstrap.js');
  const restoreListener = bootstrap.match(/weekly-time-budget:ui-state-restored[\s\S]*?\n\s*\}\);/)?.[0] || '';
  assert.match(restoreListener, /feature\.restore/);
  assert.doesNotMatch(restoreListener, /feature\.enter\(\)/);
  assert.match(bootstrap, /weekly-time-budget:view-changed[\s\S]*nextView === 'statistics'[\s\S]*feature\.enter\(\)/);
});
