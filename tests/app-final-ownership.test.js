import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('local-first 기록 변경은 app-entry-service가 단독 소유한다', async () => {
  const [app, service] = await Promise.all([read('src/app.js'), read('src/app-entry-service.js')]);
  for (const token of ['saveEntryLocalFirst', 'retryEntry', 'deletePending', 'deleteEntry']) assert.ok(service.includes(token), token);
  for (const token of ['saveEntryLocalFirst', '.repository.retryEntry(', '.store.deletePending(']) assert.ok(!app.includes(token), token);
  assert.match(app, /entryService\.saveEntry/);
  assert.match(app, /entryService\.deleteEntry/);
  assert.match(app, /entryService\.retryEntry/);
});

test('Firebase 초기화와 인증 구독은 app-bootstrap이 단독 소유한다', async () => {
  const [app, bootstrap] = await Promise.all([read('src/app.js'), read('src/app-bootstrap.js')]);
  for (const token of ['firebase-app.js', 'firebase-auth.js', 'firebase-firestore.js', 'onAuthStateChanged', 'setPersistence']) assert.ok(bootstrap.includes(token), token);
  for (const token of ['firebase-app.js', 'firebase-auth.js', 'firebase-firestore.js', 'onAuthStateChanged', 'setPersistence']) assert.ok(!app.includes(token), token);
  assert.match(app, /createAppBootstrap/);
});

test('app.js는 화면과 인프라 사이의 조정자로만 남는다', async () => {
  const app = await read('src/app.js');
  assert.ok(app.length < 12000, `app.js is still too large: ${app.length}`);
  assert.doesNotMatch(app, /function formatClock|categoryOptionHtml|optionHtml|calculateGoalComplianceScore|summarizeWeeklyBudgetPeriod/);
});
