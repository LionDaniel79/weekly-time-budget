import test from 'node:test';
import assert from 'node:assert/strict';
import { createOfflineEntryRepository } from '../src/offline-entry-repository.js';
import { createMemoryOfflineStore } from './helpers/fake-offline-store.js';

const entry = {
  categoryId: 'reading',
  date: '2026-07-27',
  durationMinutes: 30,
  source: 'manual',
};

test('기기 저장 후 원격 성공이면 대기함을 제거한다', async () => {
  const store = await createMemoryOfflineStore();
  const writes = [];
  const repository = createOfflineEntryRepository({
    store,
    createId: () => 'entry-1',
    now: () => 1000,
    remote: { save: async (record) => writes.push(record) },
  });

  const result = await repository.saveEntryLocalFirst({ userId: 'u1', entry });
  assert.equal(result.status, 'synced');
  assert.equal(result.localId, 'entry-1');
  assert.equal(writes[0].localId, 'entry-1');
  assert.equal(await store.countPending('u1'), 0);
});

test('기기 저장 후 UI 콜백 실패가 원격 동기화를 막지 않는다', async () => {
  const store = await createMemoryOfflineStore();
  let writes = 0;
  const repository = createOfflineEntryRepository({
    store,
    createId: () => 'entry-ui-callback',
    now: () => 1000,
    remote: { save: async () => { writes += 1; } },
  });

  const result = await repository.saveEntryLocalFirst({
    userId: 'u1',
    entry,
    onLocalSaved: async () => { throw new Error('render failed'); },
  });

  assert.equal(result.status, 'synced');
  assert.equal(writes, 1);
  assert.equal(await store.countPending('u1'), 0);
});

test('네트워크 실패면 기록을 pending으로 유지한다', async () => {
  const store = await createMemoryOfflineStore();
  const repository = createOfflineEntryRepository({
    store,
    createId: () => 'entry-2',
    now: () => 1000,
    remote: {
      save: async () => {
        const error = new Error('offline');
        error.code = 'unavailable';
        throw error;
      },
    },
  });

  const result = await repository.saveEntryLocalFirst({ userId: 'u1', entry });
  assert.equal(result.status, 'queued');
  assert.equal(result.pendingCount, 1);
  assert.equal((await store.getPendingById('entry-2')).status, 'pending');
});

test('권한 오류는 failed로 표시하고 자동 flush에서 건너뛴다', async () => {
  const store = await createMemoryOfflineStore();
  let calls = 0;
  const repository = createOfflineEntryRepository({
    store,
    createId: () => 'entry-3',
    now: () => 1000,
    remote: {
      save: async () => {
        calls += 1;
        const error = new Error('denied');
        error.code = 'permission-denied';
        throw error;
      },
    },
  });

  const result = await repository.saveEntryLocalFirst({ userId: 'u1', entry });
  assert.equal(result.status, 'failed');
  assert.equal((await store.getPendingById('entry-3')).status, 'failed');
  await repository.flushPendingEntries('u1');
  assert.equal(calls, 1);
});

test('동일 localId 재시도는 같은 원격 문서 대상을 사용한다', async () => {
  const store = await createMemoryOfflineStore();
  let shouldFail = true;
  const ids = [];
  const repository = createOfflineEntryRepository({
    store,
    createId: () => 'unused',
    now: () => 1000,
    remote: {
      save: async (record) => {
        ids.push(record.localId);
        if (shouldFail) {
          shouldFail = false;
          const error = new Error('offline');
          error.code = 'unavailable';
          throw error;
        }
      },
    },
  });

  const first = await repository.saveEntryLocalFirst({ userId: 'u1', localId: 'stable-id', entry });
  assert.equal(first.status, 'queued');
  const flushed = await repository.flushPendingEntries('u1');
  assert.equal(flushed.syncedCount, 1);
  assert.deepEqual(ids, ['stable-id', 'stable-id']);
  assert.equal(await store.countPending('u1'), 0);
});

test('원격 기록과 대기 기록을 합칠 때 대기 상태를 유지한다', async () => {
  const store = await createMemoryOfflineStore();
  await store.putPending({
    localId: 'pending-1', userId: 'u1', categoryId: 'reading', status: 'pending', createdAt: 2000,
    entry: { ...entry, id: 'pending-1' }, attempts: 0,
  });
  const repository = createOfflineEntryRepository({ store, remote: { save: async () => {} } });
  const merged = await repository.listMergedEntries('u1', [{ ...entry, id: 'remote-1', createdAt: 1000 }]);
  assert.deepEqual(merged.map((item) => item.syncStatus), ['pending', 'synced']);
});
