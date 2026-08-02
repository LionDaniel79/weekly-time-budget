import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('대시보드 기록 기간 모듈은 공통 인덱스와 local-first 기록을 사용한다', async () => {
  const source = await read('src/recorded-period-navigation.js');
  for (const token of ['buildRecordedPeriodIndex', 'previousRecordedPeriod', 'nextRecordedPeriodOrCurrent', 'coerceRecordedPeriodSelection', 'getExistingOfflineRuntime', 'mergedEntries']) {
    assert.ok(source.includes(token), token);
  }
  assert.doesNotMatch(source, /statistics-view|statistics-rescue|patchStatistics/);
});

test('대시보드와 통계 캐시를 모두 확인해 최신 기록 기간을 만든다', async () => {
  const source = await read('src/recorded-period-navigation.js');
  assert.ok(source.includes('snapshot?.entries'));
  assert.ok(source.includes('snapshot?.statisticsData?.entries'));
  assert.match(source, /cachedRemoteEntries\(snapshot\)[\s\S]*runtime\.mergedEntries/);
});

test('대시보드는 기록 기간 목적지와 disabled 상태를 사용한다', async () => {
  const source = await read('src/recorded-period-navigation.js');
  for (const token of ['data-week-direction', 'recordedPeriodTarget', 'aria-disabled']) assert.ok(source.includes(token), token);
  assert.doesNotMatch(source, /data-rescue-week|statistics-rescue-year|statistics-rescue-month/);
});

test('기간 인덱스가 준비되기 전에는 복원된 대시보드 기간을 보정하지 않는다', async () => {
  const source = await read('src/recorded-period-navigation.js');
  assert.ok(source.includes('periodsReady: false'));
  assert.match(source, /function patchDashboard\(\) \{\s*if \(!state\.periodsReady\) return;/);
  assert.match(source, /state\.periods = buildRecordedPeriodIndex[\s\S]*state\.periodsReady = true;/);
});

test('기간 인덱스 준비 전에는 기존 대시보드 주 이동 핸들러가 실행되지 않는다', async () => {
  const source = await read('src/recorded-period-navigation.js');
  assert.match(source, /function dashboardClick\(event\)[\s\S]*blockUntilPeriodsReady\(event\)/);
  assert.doesNotMatch(source, /function statisticsWeekClick|document\.addEventListener\('change'/);
});

test('초기 로그인과 사용자 전환은 기간 조회를 사용자별로 다시 실행한다', async () => {
  const source = await read('src/recorded-period-navigation.js');
  for (const token of ['refreshUserId', 'refreshSequence', 'warmupAttempt', 'scheduleWarmupRefresh', 'auth.currentUser?.uid !== userId']) assert.ok(source.includes(token), token);
});

test('대시보드 기간 모듈과 새 통계 bootstrap은 순서대로 로드되고 앱 셸에 캐시된다', async () => {
  const [html, worker] = await Promise.all([read('index.html'), read('service-worker.js')]);
  const navigationIndex = html.indexOf('./src/recorded-period-navigation.js');
  const statisticsIndex = html.indexOf('./src/statistics-bootstrap.js');
  assert.ok(navigationIndex >= 0 && statisticsIndex > navigationIndex);
  assert.ok(worker.includes('./src/recorded-period-navigation.js'));
  assert.ok(worker.includes('./src/statistics-bootstrap.js'));
  assert.ok(worker.includes('weekly-time-budget-shell-v16'));
});

test('기록 기간과 통계 상태 모듈은 올바른 자바스크립트 문법이다', () => {
  for (const relative of ['../src/recorded-period-domain.js', '../src/recorded-period-navigation.js', '../src/statistics-state.js']) {
    const result = spawnSync(process.execPath, ['--check', fileURLToPath(new URL(relative, import.meta.url))], { encoding: 'utf8' });
    assert.equal(result.status, 0, `${relative}: ${result.stderr || result.stdout}`);
  }
});
