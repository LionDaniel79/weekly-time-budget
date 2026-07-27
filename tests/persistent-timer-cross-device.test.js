import test from 'node:test';
import assert from 'node:assert/strict';
import { createPersistentTimerController } from '../src/persistent-timer.js';

function memoryStorage(initial) {
  const values = new Map(initial ? [['timer', JSON.stringify(initial)]] : []);
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  };
}

test('다른 기기에서 시작된 새 원격 타이머는 오래된 로컬 타이머보다 우선한다', async () => {
  const local = {
    userId: 'u1', categoryId: 'old', startedAt: 100, resumedAt: 100,
    accumulatedMs: 0, running: true, stateChangedAt: 900,
  };
  const remoteTimer = {
    userId: 'u1', categoryId: 'new', startedAt: 500, resumedAt: 500,
    accumulatedMs: 0, running: true, stateChangedAt: 600,
  };
  let updated = false;
  const remote = {
    get: async () => remoteTimer,
    set: async () => {},
    update: async () => { updated = true; },
    remove: async () => {},
    complete: async () => {},
  };
  const storage = memoryStorage(local);
  const controller = createPersistentTimerController({ remote, storage, storageKey: 'timer' });
  const recovered = await controller.recover();
  assert.equal(recovered.categoryId, 'new');
  assert.equal(updated, false);
  assert.equal(JSON.parse(storage.getItem('timer')).categoryId, 'new');
});
