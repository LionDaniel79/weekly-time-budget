import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('기록 기간 통합 모듈은 공통 인덱스와 local-first 기록을 사용한다', async () => {
  const source = await read('src/recorded-period-navigation.js');
  for (const token of [
    'buildRecordedPeriodIndex',
    'previousRecordedPeriod',
    'nextRecordedPeriodOrCurrent',
    'coerceRecordedPeriodSelection',
    'monthOptionStates',
    'recordedYearOptions',
    'coerceMonthlySelection',
    'getExistingOfflineRuntime',
    'mergedEntries',
  ]) assert.ok(source.includes(token), token);
  assert.ok(source.includes('weekly-time-budget:entries-changed'));
  assert.ok(source.includes('weekly-time-budget:data-changed'));
});

test('대시보드와 통계는 기록 기간 목적지와 disabled 상태를 사용한다', async () => {
  const source = await read('src/recorded-period-navigation.js');
  for (const token of [
    'data-week-direction',
    'data-rescue-week',
    'recordedPeriodTarget',
    'aria-disabled',
    'statistics-rescue-year',
    'statistics-rescue-month',
    'is-unavailable',
  ]) assert.ok(source.includes(token), token);
  assert.ok(source.includes("achievement.textContent = '—'"));
});

test('기간 인덱스가 준비되기 전에는 복원된 과거 기간을 보정하지 않는다', async () => {
  const source = await read('src/recorded-period-navigation.js');
  assert.ok(source.includes('periodsReady: false'));
  assert.match(source, /function patchDashboard\(\) \{\s*if \(!state\.periodsReady\) return;/);
  assert.match(source, /function patchStatistics\(\) \{\s*if \(!state\.periodsReady\) return;/);
  assert.match(source, /state\.periods = buildRecordedPeriodIndex[\s\S]*state\.periodsReady = true;/);
  assert.match(source, /onAuthStateChanged\([\s\S]*state\.periodsReady = false;/);
});

test('초기 로그인과 사용자 전환은 기간 조회를 사용자별로 다시 실행한다', async () => {
  const source = await read('src/recorded-period-navigation.js');
  for (const token of [
    'refreshUserId',
    'refreshSequence',
    'warmupAttempt',
    'scheduleWarmupRefresh',
    'auth.currentUser?.uid !== userId',
    'state.refreshPromise === promise',
  ]) assert.ok(source.includes(token), token);
  assert.match(source, /onAuthStateChanged\([\s\S]*state\.refreshSequence \+= 1;[\s\S]*state\.refreshPromise = null;[\s\S]*state\.warmupAttempt = 0;/);
});

test('통합 모듈은 통계와 시간 예산 기능보다 먼저 로드되고 앱 셸에 캐시된다', async () => {
  const [html, serviceWorker] = await Promise.all([
    read('index.html'),
    read('service-worker.js'),
  ]);
  const navigationIndex = html.indexOf('./src/recorded-period-navigation.js');
  const statisticsIndex = html.indexOf('./src/statistics-offline-rescue.js');
  const dashboardIndex = html.indexOf('./src/time-budget-feature.js');
  assert.ok(navigationIndex >= 0, 'recorded period navigation script is missing');
  assert.ok(navigationIndex < statisticsIndex, 'navigation must register before statistics handlers');
  assert.ok(navigationIndex < dashboardIndex, 'navigation must register before dashboard handlers');
  assert.ok(serviceWorker.includes('./src/recorded-period-domain.js'));
  assert.ok(serviceWorker.includes('./src/recorded-period-navigation.js'));
  assert.ok(serviceWorker.includes('weekly-time-budget-shell-v5'));
});

test('새 기록 기간 모듈은 올바른 자바스크립트 문법이다', () => {
  for (const relative of [
    '../src/recorded-period-domain.js',
    '../src/recorded-period-navigation.js',
  ]) {
    const result = spawnSync(process.execPath, ['--check', fileURLToPath(new URL(relative, import.meta.url))], { encoding: 'utf8' });
    assert.equal(result.status, 0, `${relative}: ${result.stderr || result.stdout}`);
  }
});
