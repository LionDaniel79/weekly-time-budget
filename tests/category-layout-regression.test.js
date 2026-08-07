import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('대분류 관리는 등록·보관 목록을 전체 폭 전용 레이아웃으로 배치한다', async () => {
  const [feature, css] = await Promise.all([
    read('src/category-feature.js'),
    read('styles.css'),
  ]);

  assert.match(feature, /category-management-layout/);
  assert.doesNotMatch(feature, /<div class="grid grid-2">/);
  assert.match(
    css,
    /\.category-management-layout\s*\{[^}]*display:\s*grid[^}]*grid-template-columns:\s*minmax\(0,1fr\)/s,
  );
});
