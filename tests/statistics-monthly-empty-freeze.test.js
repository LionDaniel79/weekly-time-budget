import test from 'node:test';
import assert from 'node:assert/strict';
import * as recordedPeriodDomain from '../src/recorded-period-domain.js';
import { readFile } from 'node:fs/promises';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('같은 목표 준수 문구는 DOM에 다시 쓰지 않는다', () => {
  assert.equal(typeof recordedPeriodDomain.setTextContentIfChanged, 'function');

  let writes = 0;
  let value = '—';
  const target = {
    get textContent() { return value; },
    set textContent(next) { writes += 1; value = next; },
  };

  assert.equal(recordedPeriodDomain.setTextContentIfChanged(target, '—'), false);
  assert.equal(writes, 0);
  assert.equal(recordedPeriodDomain.setTextContentIfChanged(target, '57점'), true);
  assert.equal(writes, 1);
  assert.equal(value, '57점');
});

test('빈 월간 통계 보정은 변경이 있을 때만 목표 준수 문구를 쓴다', async () => {
  const source = await read('src/recorded-period-navigation.js');
  assert.ok(source.includes('setTextContentIfChanged'));
  assert.doesNotMatch(source, /achievement\.textContent\s*=\s*['"]—['"]/);
});

test('월간 통계 멈춤 수정 코드를 배포하도록 앱 셸 캐시를 v13으로 올린다', async () => {
  const worker = await read('service-worker.js');
  assert.ok(worker.includes("weekly-time-budget-shell-v13"));
  assert.ok(worker.includes('./src/recorded-period-navigation.js'));
});
