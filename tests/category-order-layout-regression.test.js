import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createAppDataSource } from '../src/app-data-source.js';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('대분류 행은 위아래 순서 버튼과 저장 콜백을 feature 내부에서 제공한다', async () => {
  const [feature, app, css] = await Promise.all([
    read('src/category-feature.js'),
    read('src/app.js'),
    read('styles.css'),
  ]);

  assert.match(feature, /category-order-actions/);
  assert.match(feature, /category-up/);
  assert.match(feature, /category-down/);
  assert.match(feature, /data-direction="-1"/);
  assert.match(feature, /data-direction="1"/);
  assert.match(feature, /onMove/);
  assert.match(app, /reorderItems/);
  assert.match(app, /saveCategoryOrder/);
  assert.match(app, /onMove:\s*moveCategory/);

  assert.match(
    css,
    /\.category-edit-row\s*\{[^}]*grid-template-columns:\s*minmax\(220px,\s*1fr\)\s+auto/s,
  );
  assert.doesNotMatch(
    css,
    /\.category-edit-row\s*\{[^}]*grid-template-columns:\s*minmax\(0,1fr\)\s+120px\s+auto/s,
  );
});

test('대분류 순서는 Firestore batch로 원자적으로 다시 번호를 매긴다', async () => {
  const writes = [];
  let committed = false;
  const firebase = {
    doc: (...parts) => parts.slice(1).join('/'),
    collection: () => ({ type: 'collection' }),
    writeBatch: () => ({
      set: (ref, payload, options) => writes.push({ ref, payload, options }),
      commit: async () => { committed = true; },
    }),
  };

  const source = createAppDataSource({ firebase, db: { id: 'db' } });
  await source.saveCategoryOrder('user-1', ['prayer', 'reading', 'exercise']);

  assert.deepEqual(writes.map((write) => write.payload), [
    { order: 1 },
    { order: 2 },
    { order: 3 },
  ]);
  assert.ok(writes.every((write) => write.options?.merge === true));
  assert.equal(committed, true);
});
