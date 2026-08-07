import test from 'node:test';
import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('화면 전환과 내비게이션 DOM은 독립 app shell이 소유한다', async () => {
  const [app, html, worker] = await Promise.all([
    read('src/app.js'),
    read('index.html'),
    read('service-worker.js'),
  ]);

  await access(new URL('../src/app-shell.js', import.meta.url));
  assert.doesNotMatch(app, /function switchView\(/);
  assert.doesNotMatch(app, /\.nav-button|#mobile-menu|#page-title|\.sidebar/);
  assert.match(app, /weekly-time-budget:shell-state/);
  assert.match(html, /src="\.\/src\/app-shell\.js(?:\?v=\d+)?"/);
  assert.ok(worker.includes('./src/app-shell.js'));
});
