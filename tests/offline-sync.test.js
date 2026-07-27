import test from 'node:test';
import assert from 'node:assert/strict';
import { createOfflineSyncCoordinator } from '../src/offline-sync.js';

class FakeDocumentTarget extends EventTarget {
  constructor() {
    super();
    this.visibilityState = 'visible';
  }
}

test('동시에 여러 flush 요청이 와도 한 Promise만 실행한다', async () => {
  let calls = 0;
  let release;
  const wait = new Promise((resolve) => { release = resolve; });
  const results = [];
  const coordinator = createOfflineSyncCoordinator({
    userId: 'u1',
    repository: {
      flushPendingEntries: async () => {
        calls += 1;
        await wait;
        return { syncedCount: 1, pendingCount: 0, failedCount: 0 };
      },
    },
    eventTarget: new EventTarget(),
    documentTarget: new FakeDocumentTarget(),
    onResult: (result) => results.push(result),
  });

  const first = coordinator.flush('online');
  const second = coordinator.flush('visible');
  assert.equal(first, second);
  release();
  await first;
  assert.equal(calls, 1);
  assert.equal(results.length, 1);
  assert.equal(results[0].reason, 'online');
});

test('online과 앱 복귀 이벤트가 자동 flush를 요청한다', async () => {
  const eventTarget = new EventTarget();
  const documentTarget = new FakeDocumentTarget();
  const reasons = [];
  const coordinator = createOfflineSyncCoordinator({
    userId: 'u1',
    repository: {
      flushPendingEntries: async () => ({ syncedCount: 0, pendingCount: 0, failedCount: 0 }),
    },
    eventTarget,
    documentTarget,
    onResult: (_result, reason) => reasons.push(reason),
  });

  coordinator.start({ flushOnStart: false });
  eventTarget.dispatchEvent(new Event('online'));
  await new Promise((resolve) => setTimeout(resolve, 0));
  documentTarget.visibilityState = 'visible';
  documentTarget.dispatchEvent(new Event('visibilitychange'));
  await new Promise((resolve) => setTimeout(resolve, 0));
  coordinator.stop();

  assert.deepEqual(reasons, ['online', 'visible']);
});
