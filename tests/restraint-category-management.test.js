import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('절제 체크박스는 대분류 추가 폼에만 제공한다', async () => {
  const source = await read('src/category-feature.js');
  const start = source.indexOf('function renderCategories()');
  const block = source.slice(start);
  assert.ok(block.includes('name="restraint"'));
  assert.ok(block.includes('절제 목표'));
  assert.equal((block.match(/name="restraint"/g) || []).length, 1);
});

test('새 대분류만 정규화된 goalType을 저장한다', async () => {
  const [app, feature, dataSource] = await Promise.all([
    read('src/app.js'), read('src/category-feature.js'), read('src/app-data-source.js'),
  ]);
  assert.match(app, /async function saveCategory\(\{ id, name, goalType \}\)/);
  assert.match(app, /goalType: normalizeGoalType\(goalType\)/);
  assert.match(dataSource, /async saveCategory/);
  assert.match(feature, /data\.get\('restraint'\) === 'on' \? 'restraint' : 'growth'/);
});

test('수정과 일괄 저장은 목표 방식을 덮어쓰지 않는다', async () => {
  const [feature, bulk] = await Promise.all([read('src/category-feature.js'), read('src/category-bulk-editor.js')]);
  const editSubmit = feature.slice(feature.indexOf("root.querySelectorAll('.category-edit-row')"));
  assert.ok(!editSubmit.includes('goalType:'));
  assert.ok(!bulk.includes('goalType:'));
});

test('보관은 목표 방식을 복사하고 복원은 정규화해 보존한다', async () => {
  const source = await read('src/app-data-source.js');
  assert.match(source, /archivedCategories[\s\S]*\.\.\.snapshot\.data\(\)/);
  assert.match(source, /restoreCategory[\s\S]*goalType: normalizeGoalType\(data\.goalType\)/);
});
