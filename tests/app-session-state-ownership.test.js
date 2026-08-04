import test from 'node:test';
import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('캐시 스냅숏과 UI 상태 영속화는 독립 session state가 소유한다', async () => {
  const [app, worker] = await Promise.all([
    read('src/app.js'),
    read('service-worker.js'),
  ]);

  await access(new URL('../src/app-session-state.js', import.meta.url));
  assert.match(app, /createAppSessionState/);
  assert.doesNotMatch(app, /async function persistUiState\(/);
  assert.doesNotMatch(app, /async function restoreCachedState\(/);
  assert.doesNotMatch(app, /function applySnapshotToState\(/);
  assert.ok(worker.includes('./src/app-session-state.js'));
});
