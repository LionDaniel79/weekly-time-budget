import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('단일 통계 렌더러가 월간 선택 DOM을 전담한다', async () => {
  const source = await read('src/recorded-period-navigation.js');
  const patchStart = source.indexOf('function patchMonthlyStatistics');
  const patchEnd = source.indexOf('function patchStatistics', patchStart);
  const patchSource = source.slice(patchStart, patchEnd);
  assert.match(
    patchSource,
    /if \(view\.dataset\.statisticsRescue !== undefined\) return;/,
    '캐시 우선 통계 화면에서는 전역 MutationObserver가 월 선택 DOM을 다시 만들면 안 됩니다.',
  );

  const changeStart = source.indexOf("document.addEventListener('change'");
  const changeEnd = source.indexOf("for (const eventName", changeStart);
  const changeSource = source.slice(changeStart, changeEnd);
  const ownershipGuard = changeSource.indexOf('statisticsRescue !== undefined');
  const readinessBlock = changeSource.indexOf('blockUntilPeriodsReady(event)');
  assert.ok(ownershipGuard >= 0, '월 선택 change 이벤트에도 단일 렌더러 소유권 검사가 필요합니다.');
  assert.ok(
    readinessBlock < 0 || ownershipGuard < readinessBlock,
    '단일 렌더러의 월 선택은 기록 기간 준비 여부와 무관하게 자체 처리해야 합니다.',
  );
});

test('월간 통계 소유권 수정본은 PWA 셸 v15로 배포한다', async () => {
  const worker = await read('service-worker.js');
  assert.ok(worker.includes("weekly-time-budget-shell-v15"));
  assert.ok(worker.includes('./src/recorded-period-navigation.js'));
});
