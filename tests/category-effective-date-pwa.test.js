import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('서비스 워커는 생성일 도메인과 v12 셸을 캐시한다', async () => {
  const source = await readFile(new URL('../service-worker.js', import.meta.url), 'utf8');
  assert.match(source, /weekly-time-budget-shell-v13/);
  assert.match(source, /\.\/src\/category-effective-date\.js/);
});

test('CI는 Pages 산출물의 생성일 도메인을 확인한다', async () => {
  const source = await readFile(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8');
  assert.match(source, /test -f _site\/src\/category-effective-date\.js/);
});
