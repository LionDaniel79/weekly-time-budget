import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolveDailyBudget } from '../src/time-budget-domain.js';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

const forbidden = /defaultDayWeights|dayWeights|DAY_KEYS|EQUAL_DAY_WEIGHTS|normalizeDayWeights|effectiveDayWeights|day-weight|요일 비율|공통 배분 비율/;

test('요일 비율 관련 UI·상태·저장·계산 코드를 모두 제거한다', async () => {
  const files = await Promise.all([
    'src/time-budget-ui.js',
    'src/time-budget-feature.js',
    'src/time-budget-domain.js',
    'src/app-data-source.js',
    'src/persistent-timer-ui.js',
  ].map(read));
  for (const source of files) assert.doesNotMatch(source, forbidden);
});

test('직접 일간 예산이 없으면 주간 예산을 7일 균등 배분한다', () => {
  const category = { id: 'reading', defaultBudgetMinutes: 700 };
  const weekDocument = { budgets: { reading: 700 } };
  const values = ['2026-08-03','2026-08-04','2026-08-05','2026-08-06','2026-08-07','2026-08-08','2026-08-09']
    .map((date) => resolveDailyBudget({ category, date, weekDocument, dailyDocument: null }).minutes);
  assert.deepEqual(values, [100, 100, 100, 100, 100, 100, 100]);
});

test('균등 배분의 나머지는 주 앞쪽 날짜부터 1분씩 배정한다', () => {
  const category = { id: 'reading', defaultBudgetMinutes: 10 };
  const weekDocument = { budgets: { reading: 10 } };
  const values = ['2026-08-03','2026-08-04','2026-08-05','2026-08-06','2026-08-07','2026-08-08','2026-08-09']
    .map((date) => resolveDailyBudget({ category, date, weekDocument, dailyDocument: null }).minutes);
  assert.deepEqual(values, [2, 2, 2, 1, 1, 1, 1]);
});
