import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('통계 화면은 캐시 우선 렌더러 하나만 실행한다', async () => {
  const html = await read('index.html');

  assert.ok(html.includes('./src/statistics-offline-rescue.js'));
  assert.ok(html.includes('./src/statistics-primary.css'));
  assert.ok(html.includes('./src/category-selection-memory.js'));
  assert.doesNotMatch(html, /<script[^>]+statistics-ui\.js/);
  assert.doesNotMatch(html, /<script[^>]+statistics-session-state\.js/);
});

test('단일 통계 렌더러 수정본은 PWA 셸 v14로 배포한다', async () => {
  const worker = await read('service-worker.js');

  assert.ok(worker.includes("weekly-time-budget-shell-v14"));
  assert.ok(worker.includes('./src/statistics-primary.css'));
  assert.ok(worker.includes('./src/category-selection-memory.js'));
});
