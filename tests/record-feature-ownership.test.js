import test from 'node:test';
import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('시간 기록 입력 화면은 독립 feature가 소유한다', async () => {
  const [app, html, worker] = await Promise.all([
    read('src/app.js'),
    read('index.html'),
    read('service-worker.js'),
  ]);

  await access(new URL('../src/record-feature.js', import.meta.url));
  assert.doesNotMatch(app, /function renderRecord\(/);
  assert.doesNotMatch(app, /#record-view/);
  assert.match(html, /src="\.\/src\/record-feature\.js"/);
  assert.ok(worker.includes('./src/record-feature.js'));
});
