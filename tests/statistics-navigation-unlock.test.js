import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('통계 화면에서 다른 메뉴를 누르면 통계 자동 복원 목표를 즉시 해제한다', async () => {
  const source = await read('src/statistics-session-state.js');

  assert.ok(source.includes("closest('.nav-button[data-view]')"));
  assert.match(source, /const activeView = nav\.dataset\.view;/);
  assert.match(source, /desiredState = \{[\s\S]*activeView[\s\S]*\};/);
  assert.match(source, /if \(activeView !== 'statistics'\) \{[\s\S]*restoring = false;[\s\S]*return;[\s\S]*\}/);
});
