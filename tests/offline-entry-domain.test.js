import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createPendingEntry,
  classifySyncError,
  mergeRemoteAndPendingEntries,
} from '../src/offline-entry-domain.js';

test('pending 기록은 사용자와 Firestore에 사용할 동일 ID를 보존한다', () => {
  const value = createPendingEntry({
    userId: 'u1',
    localId: 'entry-1',
    createdAt: 1000,
    entry: {
      categoryId: 'reading',
      date: '2026-07-27',
      durationMinutes: 30,
    },
  });

  assert.equal(value.localId, 'entry-1');
  assert.equal(value.userId, 'u1');
  assert.equal(value.categoryId, 'reading');
  assert.equal(value.entry.id, 'entry-1');
  assert.equal(value.status, 'pending');
  assert.equal(value.attempts, 0);
});

test('pending과 failed 기록이 같은 ID의 원격 기록보다 우선한다', () => {
  const result = mergeRemoteAndPendingEntries(
    [
      { id: 'a', date: '2026-07-25', createdAt: 1000 },
      { id: 'b', date: '2026-07-26', createdAt: 2000 },
    ],
    [
      { localId: 'b', createdAt: 2000, status: 'pending', entry: { id: 'b', date: '2026-07-26' } },
      { localId: 'c', createdAt: 3000, status: 'failed', entry: { id: 'c', date: '2026-07-27' } },
    ],
  );

  assert.deepEqual(result.map((item) => [item.id, item.syncStatus]), [
    ['c', 'failed'],
    ['b', 'pending'],
    ['a', 'synced'],
  ]);
});

test('네트워크 오류만 자동 재시도 대상으로 분류한다', () => {
  assert.equal(classifySyncError({ code: 'unavailable' }), 'retryable');
  assert.equal(classifySyncError({ code: 'firestore/deadline-exceeded' }), 'retryable');
  assert.equal(classifySyncError({ code: 'auth/network-request-failed' }), 'retryable');
  assert.equal(classifySyncError(new Error('Failed to fetch')), 'retryable');
  assert.equal(classifySyncError({ code: 'permission-denied' }), 'permanent');
  assert.equal(classifySyncError({ code: 'invalid-argument' }), 'permanent');
});
