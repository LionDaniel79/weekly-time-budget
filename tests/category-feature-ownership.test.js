import test from 'node:test';
import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('대분류 화면은 독립 feature가 소유한다', async () => {
  const [app, html, worker] = await Promise.all([
    read('src/app.js'),
    read('index.html'),
    read('service-worker.js'),
  ]);

  await access(new URL('../src/category-feature.js', import.meta.url));
  assert.doesNotMatch(app, /function renderCategories\(/);
  assert.doesNotMatch(app, /#categories-view/);
  assert.match(html, /src="\.\/src\/category-feature\.js(?:\?v=\d+)?"/);
  assert.ok(worker.includes('./src/category-feature.js'));
});
