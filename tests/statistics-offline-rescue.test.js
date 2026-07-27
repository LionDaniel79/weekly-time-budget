import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('통계는 서버 조회가 멈춰도 기기 스냅숏으로 먼저 표시한다', async () => {
  const source = await read('src/statistics-offline-rescue.js');
  assert.ok(source.includes('getExistingOfflineRuntime'));
  assert.ok(source.includes('getSnapshot'));
  assert.ok(source.includes('mergedEntries'));
  assert.match(source, /Promise\.race\([\s\S]*timeoutPromise\(\)/);
  assert.match(source, /setTimeout\([\s\S]*STATISTICS_SERVER_TIMEOUT_MS/);
  assert.ok(source.includes('statisticsData'));
  assert.ok(source.includes('기기에 저장된 자료'));
});

test('통계 구조 요청은 무기한 대기하지 않고 재시도 화면으로 전환한다', async () => {
  const source = await read('src/statistics-offline-rescue.js');
  assert.ok(source.includes('통계를 다시 불러오기'));
  assert.ok(source.includes('statistics-rescue-retry'));
  assert.ok(source.includes('서버 응답이 늦어'));
});

test('오프라인 통계 구조가 앱과 서비스 워커에 포함된다', async () => {
  const [html, serviceWorker] = await Promise.all([
    read('index.html'),
    read('service-worker.js'),
  ]);
  assert.ok(html.includes('./src/statistics-offline-rescue.js'));
  assert.ok(serviceWorker.includes('./src/statistics-offline-rescue.js'));
  assert.ok(serviceWorker.includes('weekly-time-budget-shell-v3'));
});
