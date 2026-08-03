import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('대시보드 기록 기간은 시간 예산 기능의 local-first 기록으로 계산한다', async () => {
  const source = await read('src/time-budget-feature.js');
  for (const token of [
    'buildRecordedPeriodIndex',
    'previousRecordedPeriod',
    'nextRecordedPeriodOrCurrent',
    'coerceRecordedPeriodSelection',
    'state.runtime.mergedEntries',
  ]) assert.ok(source.includes(token), token);
});

test('대시보드 주간 이동은 기록 기간 목적지를 직접 사용한다', async () => {
  const source = await read('src/time-budget-feature.js');
  assert.match(source, /onWeekMove:[\s\S]*previousWeekStart[\s\S]*nextWeekStart/);
  assert.doesNotMatch(source, /moveWeekStart/);
});

test('기록 기간 후처리 스크립트는 앱과 서비스 워커에서 제거된다', async () => {
  const [html, worker] = await Promise.all([read('index.html'), read('service-worker.js')]);
  assert.doesNotMatch(html, /recorded-period-navigation/);
  assert.doesNotMatch(worker, /recorded-period-navigation/);
});

test('대시보드 기록 기간 관련 모듈은 올바른 자바스크립트 문법이다', () => {
  for (const relative of [
    '../src/recorded-period-domain.js',
    '../src/time-budget-feature.js',
    '../src/time-budget-ui.js',
  ]) {
    const result = spawnSync(process.execPath, ['--check', fileURLToPath(new URL(relative, import.meta.url))], { encoding: 'utf8' });
    assert.equal(result.status, 0, `${relative}: ${result.stderr || result.stdout}`);
  }
});
