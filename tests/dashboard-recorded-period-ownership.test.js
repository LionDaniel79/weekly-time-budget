import test from 'node:test';
import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('시간 예산 기능이 대시보드 기록 주 이동을 직접 소유한다', async () => {
  const source = await read('src/time-budget-feature.js');
  for (const token of [
    'buildRecordedPeriodIndex',
    'previousRecordedPeriod',
    'nextRecordedPeriodOrCurrent',
    'coerceRecordedPeriodSelection',
    'previousWeekStart',
    'nextWeekStart',
  ]) assert.ok(source.includes(token), token);
  assert.doesNotMatch(source, /moveWeekStart/);
});

test('주간 대시보드 버튼은 기록 기간 목적지에 따라 비활성화된다', async () => {
  const source = await read('src/time-budget-ui.js');
  assert.ok(source.includes('model.previousWeekStart'));
  assert.ok(source.includes('model.nextWeekStart'));
  assert.ok(source.includes('aria-disabled'));
});

test('기록 기간 후처리 모듈은 실행·캐시·배포 대상에서 제거된다', async () => {
  const [html, worker, workflow] = await Promise.all([
    read('index.html'),
    read('service-worker.js'),
    read('.github/workflows/ci.yml'),
  ]);
  for (const source of [html, worker, workflow]) {
    assert.doesNotMatch(source, /recorded-period-navigation\.js/);
  }
  await assert.rejects(access(new URL('../src/recorded-period-navigation.js', import.meta.url)));
});
