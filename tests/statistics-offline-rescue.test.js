import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('통계는 서버 조회가 멈춰도 사용자별 기기 스냅숏을 먼저 표시한다', async () => {
  const source = await read('src/statistics-data-source.js');
  assert.ok(source.includes('runtimeForUser(userId)'));
  assert.ok(source.includes('getSnapshot(userId)'));
  assert.ok(source.includes('mergedEntries'));
  assert.match(source, /Promise\.race\(\[request, timeoutAfter\(timeoutMs\)\]\)/);
  assert.ok(source.includes('statisticsData'));
});

test('통계 구조 요청은 제한시간 후 캐시 경고와 재시도 화면을 제공한다', async () => {
  const [dataSource, view] = await Promise.all([read('src/statistics-data-source.js'), read('src/statistics-view.js')]);
  assert.ok(dataSource.includes('서버 응답이 늦어'));
  assert.ok(view.includes('통계를 다시 불러오기'));
  assert.ok(view.includes('data-statistics-retry'));
});

test('통계 데이터는 사용자 ID를 모든 캐시·서버 경로에 전달한다', async () => {
  const source = await read('src/statistics-data-source.js');
  assert.match(source, /readCache\(userId\)/);
  assert.match(source, /readServer\(userId\)/);
  assert.match(source, /users', userId/);
  assert.match(source, /patchSnapshot\(userId/);
});

test('새 통계 bootstrap과 상태·뷰·feature만 앱 셸에 포함된다', async () => {
  const [html, worker] = await Promise.all([read('index.html'), read('service-worker.js')]);
  assert.match(html, /src="\.\/src\/statistics-bootstrap\.js(?:\?v=\d+)?"/);
  assert.doesNotMatch(html, /recorded-period-navigation|statistics-offline-rescue|statistics-ui|statistics-session-state|statistics-mobile-overflow/);
  for (const file of ['./src/statistics-state.js', './src/statistics-data-source.js', './src/statistics-view.js', './src/statistics-feature.js', './src/statistics-bootstrap.js']) {
    assert.ok(worker.includes(file), file);
  }
  assert.ok(worker.includes('weekly-time-budget-shell-${APP_BUILD}'));
});
