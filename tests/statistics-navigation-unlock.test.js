import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('통계 화면에서 다른 메뉴로 이동하면 통계 기능을 즉시 leave 처리한다', async () => {
  const [events, bootstrap] = await Promise.all([
    read('src/view-change-events.js'), read('src/statistics-bootstrap.js'),
  ]);
  assert.match(events, /nav-button\[data-view\]/);
  assert.match(events, /weekly-time-budget:view-changed/);
  assert.match(bootstrap, /const nextView = event\.detail\?\.view[\s\S]*if \(nextView === currentView\) return;[\s\S]*if \(nextView === 'statistics'\) feature\.enter\(\);[\s\S]*else feature\.leave\(\);/);
  assert.doesNotMatch(bootstrap, /button\.click\(\)|stopImmediatePropagation/);
});
