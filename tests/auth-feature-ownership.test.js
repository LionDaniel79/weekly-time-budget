import test from 'node:test';
import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('로그인 화면과 인증 버튼 DOM은 독립 auth feature가 소유한다', async () => {
  const [app, html, worker] = await Promise.all([
    read('src/app.js'),
    read('index.html'),
    read('service-worker.js'),
  ]);

  await access(new URL('../src/auth-feature.js', import.meta.url));
  assert.doesNotMatch(app, /#login-view|#app-view|#user-name|#google-login|#logout|#config-warning/);
  assert.match(app, /weekly-time-budget:auth-state/);
  assert.match(html, /src="\.\/src\/auth-feature\.js"/);
  assert.ok(worker.includes('./src/auth-feature.js'));
});
