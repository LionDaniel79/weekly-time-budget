import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('예산 마이그레이션은 실제 데이터가 바뀐 경우에만 data-changed를 발행한다', async () => {
  const source = await read('src/previous-results-budget-migration.js');
  assert.match(source, /let changed = false/);
  assert.match(source, /changed = true/);
  assert.match(source, /if \(changed\)[\s\S]*weekly-time-budget:data-changed/);
});

test('일반 data-changed 갱신은 사용자의 현재 화면 상태를 다시 복원하지 않는다', async () => {
  const source = await read('src/app.js');
  const listener = source.match(/document\.addEventListener\('weekly-time-budget:data-changed',[\s\S]*?\n\}\);/m)?.[0] || '';
  assert.ok(listener, 'data-changed listener should exist');
  assert.doesNotMatch(listener, /restoreVisibleState\(/);
});

test('대시보드와 시간예산은 원격 데이터 갱신을 기다리기 전에 현재 상태를 즉시 그린다', async () => {
  const source = await read('src/time-budget-feature.js');
  assert.match(source, /weekly-time-budget:view-changed[\s\S]*renderActiveView\(\);[\s\S]*await loadData\(\)/);
  assert.match(source, /weekly-time-budget:infrastructure-state[\s\S]*renderActiveView\(\);[\s\S]*await loadData\(\)/);
});

test('화면 전환 이벤트는 app shell 하나만 클릭에서 발행한다', async () => {
  const [html, worker] = await Promise.all([read('index.html'), read('service-worker.js')]);
  assert.doesNotMatch(html, /view-change-events\.js/);
  assert.doesNotMatch(worker, /\.\/src\/view-change-events\.js/);
});
