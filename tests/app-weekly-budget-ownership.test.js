import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('app은 주간 예산 상태와 조회를 소유하지 않는다', async () => {
  const source = await read('src/app.js');
  assert.doesNotMatch(source, /weeklyBudget/);
  assert.doesNotMatch(source, /weeklyBudgets/);
  assert.doesNotMatch(source, /effectiveBudgetMinutes/);
  assert.doesNotMatch(source, /categoriesForSummary/);
});
