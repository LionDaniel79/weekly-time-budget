import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('시간 예산 feature는 공통 인프라 상태만 소비한다', async () => {
  const source = await read('src/time-budget-feature.js');
  assert.match(source, /weekly-time-budget:infrastructure-state/);
  assert.doesNotMatch(source, /firebaseConfig|gstatic\.com\/firebasejs|onAuthStateChanged|getOfflineRuntime/);
  assert.doesNotMatch(source, /MutationObserver|stopImmediatePropagation|switchOwnedView|schedulePatch/);
});

test('공통 data source가 시간 예산 읽기와 쓰기를 소유한다', async () => {
  const source = await read('src/app-data-source.js');
  assert.match(source, /loadTimeBudgetData/);
  assert.match(source, /saveDailyBudget/);
  assert.match(source, /saveWeeklyBudget/);
  assert.match(source, /ensureCurrentWeekBudget/);
});

test('app coordinator가 사용자별 인프라 상태를 발행한다', async () => {
  const source = await read('src/app.js');
  assert.match(source, /weekly-time-budget:infrastructure-state/);
  assert.match(source, /dataSource/);
  assert.match(source, /offlineRuntime/);
});
