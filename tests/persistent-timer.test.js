import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createPersistentTimerController,
  createTimerSnapshot,
  elapsedSeconds,
} from '../src/persistent-timer.js';

function memoryStorage() {
  const values = new Map();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  };
}

function remoteStore(initial = null) {
  let value = initial;
  const completed = [];
  return {
    completed,
    get: async () => value,
    set: async (next) => { value = next; },
    remove: async () => { value = null; },
    complete: async (timer, entry) => { completed.push({ timer, entry }); value = null; },
    current: () => value,
  };
}

test('절대 시작 시각으로 백그라운드 경과 시간을 계산한다', () => {
  const timer = createTimerSnapshot({ userId: 'u1', categoryId: 'reading', startedAt: 1_000, startedDate: '2026-07-26' });
  assert.equal(elapsedSeconds(timer, 3_601_000), 3600);
});

test('원격 타이머가 localStorage보다 우선한다', async () => {
  const storage = memoryStorage();
  storage.setItem('timer', JSON.stringify({ startedAt: 100, categoryId: 'local' }));
  const remote = remoteStore({ startedAt: 200, categoryId: 'remote', userId: 'u1', running: true });
  const controller = createPersistentTimerController({ remote, storage, storageKey: 'timer' });
  const timer = await controller.recover();
  assert.equal(timer.categoryId, 'remote');
  assert.equal(JSON.parse(storage.getItem('timer')).categoryId, 'remote');
});

test('새 타이머 시작 시 기존 원격 타이머를 복구한다', async () => {
  const existing = { userId: 'u1', categoryId: 'reading', startedAt: 1000, running: true };
  const controller = createPersistentTimerController({ remote: remoteStore(existing), storage: memoryStorage(), storageKey: 'timer', now: () => 5000 });
  const result = await controller.start({ userId: 'u1', categoryId: 'thesis' });
  assert.equal(result.recovered, true);
  assert.equal(result.timer.categoryId, 'reading');
});

test('시작 원격 저장 실패 시 localStorage만으로 시작하지 않는다', async () => {
  const storage = memoryStorage();
  const remote = remoteStore();
  remote.set = async () => { throw new Error('network'); };
  const controller = createPersistentTimerController({ remote, storage, storageKey: 'timer', now: () => 1000 });
  await assert.rejects(() => controller.start({ userId: 'u1', categoryId: 'reading' }), /network/);
  assert.equal(storage.getItem('timer'), null);
});

test('종료 성공 후에만 상태를 지우고 한 번의 원격 완료를 수행한다', async () => {
  let clock = 1000;
  const remote = remoteStore();
  const storage = memoryStorage();
  const controller = createPersistentTimerController({ remote, storage, storageKey: 'timer', now: () => clock });
  await controller.start({ userId: 'u1', categoryId: 'reading', startedDate: '2026-07-26' });
  clock = 61_000;
  const entry = await controller.stop((timer, timing) => ({ categoryId: timer.categoryId, durationMinutes: timing.durationMinutes }));
  assert.equal(entry.durationMinutes, 1);
  assert.equal(remote.completed.length, 1);
  assert.equal(controller.active, null);
  assert.equal(storage.getItem('timer'), null);
});

test('종료 저장 실패 시 진행 중 상태를 유지한다', async () => {
  const remote = remoteStore();
  remote.complete = async () => { throw new Error('save failed'); };
  const storage = memoryStorage();
  const controller = createPersistentTimerController({ remote, storage, storageKey: 'timer', now: () => 1000 });
  await controller.start({ userId: 'u1', categoryId: 'reading' });
  await assert.rejects(() => controller.stop(() => ({})), /save failed/);
  assert.equal(controller.active.categoryId, 'reading');
  assert.ok(storage.getItem('timer'));
});
