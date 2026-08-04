import test from 'node:test';
import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('원격 대분류·기록 조회는 독립 app data source가 소유한다', async () => {
  const [app, html, worker] = await Promise.all([
    read('src/app.js'),
    read('index.html'),
    read('service-worker.js'),
  ]);

  await access(new URL('../src/app-data-source.js', import.meta.url));
  assert.match(app, /createAppDataSource/);
  assert.match(app, /dataSource\.loadUserData\(state\.user\.uid\)/);
  assert.doesNotMatch(app, /firebase\.getDocs\(/);
  assert.doesNotMatch(app, /firebase\.query\(firebase\.collection/);
  assert.match(html, /src="\.\/src\/app\.js"/);
  assert.ok(worker.includes('./src/app-data-source.js'));
});
