import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('대분류와 원격 기록 쓰기는 app data source가 소유한다', async () => {
  const [app, dataSource] = await Promise.all([
    read('src/app.js'),
    read('src/app-data-source.js'),
  ]);

  assert.doesNotMatch(app, /firebase\.(addDoc|setDoc|deleteDoc)\(/);
  assert.match(app, /dataSource\.saveCategory\(/);
  assert.match(app, /dataSource\.deleteCategory\(/);
  assert.match(app, /dataSource\.deleteEntry\(/);
  assert.match(dataSource, /async saveCategory\(/);
  assert.match(dataSource, /async deleteCategory\(/);
  assert.match(dataSource, /async deleteEntry\(/);
});
