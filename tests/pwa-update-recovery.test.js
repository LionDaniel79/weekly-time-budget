import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('서비스 워커가 교체되면 한 번만 새 화면으로 다시 시작한다', async () => {
  const source = await read('src/service-worker-registration.js');
  assert.match(source, /navigator\.serviceWorker\.addEventListener\(['"]controllerchange['"]/);
  assert.match(source, /location\.reload\(\)/);
  assert.match(source, /registration\.update\(\)/);
  assert.match(source, /refreshing/);
});

test('업데이트 복구 코드를 배포하도록 앱 셸 캐시를 v12로 올린다', async () => {
  const worker = await read('service-worker.js');
  assert.ok(worker.includes("weekly-time-budget-shell-v12"));
  assert.ok(worker.includes('./src/service-worker-registration.js'));
});
