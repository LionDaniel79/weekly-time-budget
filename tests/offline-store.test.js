import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { OFFLINE_DB_SCHEMA } from '../src/offline-store.js';
import { createMemoryOfflineStore } from './helpers/fake-offline-store.js';

test('오프라인 저장소 스키마는 사용자별 대기함·스냅숏·화면 상태를 가진다', () => {
  assert.equal(OFFLINE_DB_SCHEMA.name, 'weekly-time-budget-offline');
  assert.equal(OFFLINE_DB_SCHEMA.version, 1);
  assert.deepEqual(OFFLINE_DB_SCHEMA.stores, ['pendingEntries', 'userSnapshots', 'uiState']);
  assert.deepEqual(OFFLINE_DB_SCHEMA.pendingIndexes, ['userId', 'userCreatedAt', 'userCategory']);
});

test('메모리 저장소 계약은 사용자별 데이터를 격리한다', async () => {
  const store = await createMemoryOfflineStore();
  await store.putPending({ localId: 'a', userId: 'u1', categoryId: 'reading', createdAt: 1, status: 'pending', entry: {} });
  await store.putPending({ localId: 'b', userId: 'u2', categoryId: 'reading', createdAt: 2, status: 'pending', entry: {} });
  await store.putPending({ localId: 'c', userId: 'u1', categoryId: 'thesis', createdAt: 3, status: 'pending', entry: {} });

  assert.deepEqual((await store.getPending('u1')).map((item) => item.localId), ['a', 'c']);
  assert.equal(await store.countPending('u1'), 2);
  assert.equal(await store.countPendingByCategory('u1', 'reading'), 1);
  assert.equal(await store.countPendingByCategory('u2', 'reading'), 1);

  await store.patchSnapshot('u1', { categories: [{ id: 'reading' }] });
  await store.patchSnapshot('u1', { entries: [{ id: 'a' }] });
  assert.deepEqual(await store.getSnapshot('u1'), {
    userId: 'u1',
    categories: [{ id: 'reading' }],
    entries: [{ id: 'a' }],
  });
  assert.equal(await store.getSnapshot('u2'), null);

  await store.putUiState('u1', { activeView: 'record' });
  assert.deepEqual(await store.getUiState('u1'), { activeView: 'record' });
  assert.equal(await store.getUiState('u2'), null);

  assert.equal(await store.deletePendingByCategory('u1', 'reading'), 1);
  assert.deepEqual((await store.getPending('u1')).map((item) => item.localId), ['c']);
});

test('브라우저 IndexedDB 구현은 사용자 인덱스와 부분 스냅숏 갱신을 제공한다', async () => {
  const source = await readFile(new URL('../src/offline-store.js', import.meta.url), 'utf8');
  for (const token of [
    "createObjectStore('pendingEntries'",
    "createObjectStore('userSnapshots'",
    "createObjectStore('uiState'",
    "createIndex('userId'",
    "createIndex('userCreatedAt'",
    "createIndex('userCategory'",
    'patchSnapshot',
    'deletePendingByCategory',
  ]) assert.ok(source.includes(token), token);
});
