import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const app = await readFile(new URL('../src/app.js', import.meta.url), 'utf8');
const lifecycle = await readFile(new URL('../src/category-ui-patch.js', import.meta.url), 'utf8');
const bulk = await readFile(new URL('../src/category-bulk-editor.js', import.meta.url), 'utf8');

test('새 대분류 생성에만 현지 createdDate를 저장한다', () => {
  assert.match(app, /createdDate:\s*toDateKey\(new Date\(\)\)/);
  const updatePath = app.match(/if \(id\)[\s\S]*?else/)?.[0] || '';
  assert.doesNotMatch(updatePath, /createdDate/);
});

test('대분류 수정과 일괄 저장은 createdDate를 쓰지 않는다', () => {
  const render = app.match(/function renderCategories\([\s\S]*?\n}/)?.[0] || '';
  assert.doesNotMatch(render, /name=["']createdDate["']/);
  const batch = bulk.match(/batch\.set\([\s\S]*?\{ merge: true \}/)?.[0] || '';
  assert.doesNotMatch(batch, /createdDate/);
});

test('복원은 보관된 createdDate가 있을 때만 원래 값을 기록한다', () => {
  assert.match(lifecycle, /data\.createdDate !== undefined/);
  assert.match(lifecycle, /createdDate:\s*data\.createdDate/);
});
