import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createPersistentTimerController,
  createTimerSnapshot,
  elapsedMilliseconds,
  elapsedSeconds,
  normalizeTimerSnapshot,
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
    update: async (next) => { value = next; },
    remove: async () => { value = null; },
    complete: async (timer, entry) => { completed.push({ timer, entry }); value = null; },
    current: () => value,
  };
}

test('기존 실행 중 타이머를 일시정지 모델로 정규화한다', () => {
  const timer = normalizeTimerSnapshot({ userId: 'u1', categoryId: 'work', startedAt: 1_000, running: true });
  assert.equal(timer.accumulatedMs, 0);
  assert.equal(timer.resumedAt, 1_000);
  assert.equal(timer.pausedAt, null);
  assert.equal(timer.stateChangedAt, 1_000);
  assert.equal(timer.running, true);
});

test('실행 중에는 현재 구간을 더하고 일시정지 중에는 누적시간만 계산한다', () => {
  assert.equal(elapsedMilliseconds({ startedAt: 1_000, resumedAt: 2_000, accumulatedMs: 3_000, running: true }, 7_000), 8_000);
  assert.equal(elapsedMilliseconds({ startedAt: 1_000, accumulatedMs: 3_000, running: false }, 7_000), 3_000);
});

test('절대 시작 시각으로 백그라운드 경과 시간을 계산한다', () => {
  const timer = createTimerSnapshot({ userId: 'u1', categoryId: 'reading', startedAt: 1_000, startedDate: '2026-07-26' });
  assert.equal(elapsedSeconds(timer, 3_601_000), 3600);
});

test('원격 타이머가 localStorage보다 최신이면 원격 상태가 우선한다', async () => {
  const storage = memoryStorage();
  storage.setItem('timer', JSON.stringify({ startedAt: 100, stateChangedAt: 100, categoryId: 'local', running: true }));
  const remote = remoteStore({ startedAt: 200, stateChangedAt: 200, categoryId: 'remote', userId: 'u1', running: true });
  const controller = createPersistentTimerController({ remote, storage, storageKey: 'timer' });
  const timer = await controller.recover();
  assert.equal(timer.categoryId, 'remote');
  assert.equal(JSON.parse(storage.getItem('timer')).categoryId, 'remote');
});

test('로컬 일시정지 상태가 더 최신이면 원격에 다시 반영한다', async () => {
  const storage = memoryStorage();
  storage.setItem('timer', JSON.stringify({
    userId: 'u1', categoryId: 'local', startedAt: 100, accumulatedMs: 150, running: false, pausedAt: 300, stateChangedAt: 300,
  }));
  const remote = remoteStore({
    userId: 'u1', categoryId: 'remote', startedAt: 100, accumulatedMs: 0, resumedAt: 100, running: true, stateChangedAt: 200,
  });
  const controller = createPersistentTimerController({ remote, storage, storageKey: 'timer' });
  const timer = await controller.recover();
  assert.equal(timer.categoryId, 'local');
  assert.equal(timer.running, false);
  assert.equal(remote.current().stateChangedAt, 300);
});

test('원격 타이머가 없으면 오프라인에서 만든 로컬 타이머를 유지한다', async () => {
  const storage = memoryStorage();
  storage.setItem('timer', JSON.stringify({ userId: 'u1', startedAt: 100, categoryId: 'local', running: true }));
  const remote = remoteStore(null);
  const controller = createPersistentTimerController({ remote, storage, storageKey: 'timer' });
  const timer = await controller.recover();
  assert.equal(timer.categoryId, 'local');
  assert.equal(remote.current().categoryId, 'local');
});

test('새 타이머 시작 시 기존 원격 타이머를 복구한다', async () => {
  const existing = { userId: 'u1', categoryId: 'reading', startedAt: 1000, running: true };
  const controller = createPersistentTimerController({ remote: remoteStore(existing), storage: memoryStorage(), storageKey: 'timer', now: () => 5000 });
  const result = await controller.start({ userId: 'u1', categoryId: 'thesis' });
  assert.equal(result.recovered, true);
  assert.equal(result.timer.categoryId, 'reading');
});

test('동시 시작 경쟁에서 다른 기기가 만든 타이머를 복구한다', async () => {
  const storage = memoryStorage();
  const remoteTimer = { userId: 'u1', categoryId: 'reading', startedAt: 2000, running: true };
  let reads = 0;
  const remote = {
    get: async () => { reads += 1; return reads === 1 ? null : remoteTimer; },
    set: async () => { throw new Error('active-timer-conflict'); },
    update: async () => {},
    remove: async () => {},
    complete: async () => {},
  };
  const controller = createPersistentTimerController({ remote, storage, storageKey: 'timer', now: () => 5000 });
  const result = await controller.start({ userId: 'u1', categoryId: 'thesis' });
  assert.equal(result.recovered, true);
  assert.equal(result.timer.categoryId, 'reading');
  assert.equal(JSON.parse(storage.getItem('timer')).categoryId, 'reading');
});

test('원격 연결이 끊겨도 localStorage로 타이머를 시작한다', async () => {
  const storage = memoryStorage();
  const offline = Object.assign(new Error('network offline'), { code: 'unavailable' });
  const remote = {
    get: async () => { throw offline; },
    set: async () => { throw offline; },
    update: async () => { throw offline; },
    remove: async () => {},
    complete: async () => {},
  };
  const controller = createPersistentTimerController({ remote, storage, storageKey: 'timer', now: () => 1000 });
  const result = await controller.start({ userId: 'u1', categoryId: 'reading' });
  assert.equal(result.remotePending, true);
  assert.equal(controller.active.startedAt, 1000);
  assert.ok(storage.getItem('timer'));
});

test('타이머를 멈춘 동안 시간이 증가하지 않고 계속 후 새 구간만 더한다', async () => {
  let clock = 1_000;
  const controller = createPersistentTimerController({ remote: remoteStore(), storage: memoryStorage(), storageKey: 'timer', now: () => clock });
  await controller.start({ userId: 'u1', categoryId: 'reading' });
  clock = 61_000;
  await controller.pause();
  assert.equal(controller.active.running, false);
  assert.equal(controller.elapsedSeconds(), 60);
  clock = 121_000;
  assert.equal(controller.elapsedSeconds(), 60);
  await controller.resume();
  assert.equal(controller.active.running, true);
  clock = 181_000;
  assert.equal(controller.elapsedSeconds(), 120);
});

test('일시정지 원격 저장이 일시적 실패여도 로컬 일시정지를 유지한다', async () => {
  let clock = 1_000;
  const storage = memoryStorage();
  const remote = remoteStore();
  await createPersistentTimerController({ remote, storage, storageKey: 'seed', now: () => clock }).start({ userId: 'u1', categoryId: 'unused' });
  remote.update = async () => { throw Object.assign(new Error('offline'), { code: 'unavailable' }); };
  const controller = createPersistentTimerController({ remote: remoteStore(), storage, storageKey: 'timer', now: () => clock });
  await controller.start({ userId: 'u1', categoryId: 'reading' });
  controller.active;
  const failingRemote = controller;
  // controller가 사용하는 원격 어댑터를 별도로 구성해 재시도 가능한 실패를 검증한다.
  const retryRemote = remoteStore();
  retryRemote.update = async () => { throw Object.assign(new Error('offline'), { code: 'unavailable' }); };
  const retryController = createPersistentTimerController({ remote: retryRemote, storage: memoryStorage(), storageKey: 'retry', now: () => clock });
  await retryController.start({ userId: 'u1', categoryId: 'reading' });
  clock = 61_000;
  const result = await retryController.pause();
  assert.equal(result.remotePending, true);
  assert.equal(retryController.active.running, false);
  assert.equal(retryController.elapsedSeconds(), 60);
  assert.equal(failingRemote.active.running, true);
});

test('일시정지 원격 저장이 영구 실패하면 변경 전 실행 상태로 되돌린다', async () => {
  let clock = 1_000;
  const storage = memoryStorage();
  const remote = remoteStore();
  const controller = createPersistentTimerController({ remote, storage, storageKey: 'timer', now: () => clock });
  await controller.start({ userId: 'u1', categoryId: 'reading' });
  remote.update = async () => { throw new Error('permission-denied'); };
  clock = 61_000;
  await assert.rejects(() => controller.pause(), /permission-denied/);
  assert.equal(controller.active.running, true);
  assert.equal(JSON.parse(storage.getItem('timer')).running, true);
});

test('일시정지 상태에서 종료하면 멈춘 시간을 제외한 누적시간만 저장한다', async () => {
  let clock = 1_000;
  let savedTiming;
  const controller = createPersistentTimerController({
    remote: remoteStore(), storage: memoryStorage(), storageKey: 'timer', now: () => clock,
    complete: async (_timer, entry) => ({ status: 'queued', entry }),
  });
  await controller.start({ userId: 'u1', categoryId: 'reading', startedDate: '2026-07-26' });
  clock = 61_000;
  await controller.pause();
  clock = 181_000;
  const result = await controller.stop((_timer, timing) => {
    savedTiming = timing;
    return { durationMinutes: timing.durationMinutes };
  });
  assert.equal(savedTiming.elapsedMs, 60_000);
  assert.equal(result.entry.durationMinutes, 1);
});

test('종료 성공 후에만 상태를 지우고 저장 결과를 반환한다', async () => {
  let clock = 1000;
  const remote = remoteStore();
  const storage = memoryStorage();
  const completed = [];
  const controller = createPersistentTimerController({
    remote,
    storage,
    storageKey: 'timer',
    now: () => clock,
    complete: async (timer, entry) => {
      completed.push({ timer, entry });
      return { status: 'queued', localId: 'timer-1000', entry };
    },
  });
  await controller.start({ userId: 'u1', categoryId: 'reading', startedDate: '2026-07-26' });
  clock = 61_000;
  const result = await controller.stop((timer, timing) => ({ categoryId: timer.categoryId, durationMinutes: timing.durationMinutes }));
  assert.equal(result.entry.durationMinutes, 1);
  assert.equal(result.completion.status, 'queued');
  assert.equal(completed.length, 1);
  assert.equal(controller.active, null);
  assert.equal(storage.getItem('timer'), null);
});

test('종료 기록의 기기 저장 실패 시 진행 중 상태를 유지한다', async () => {
  const remote = remoteStore();
  const storage = memoryStorage();
  const controller = createPersistentTimerController({
    remote,
    storage,
    storageKey: 'timer',
    now: () => 1000,
    complete: async () => { throw new Error('indexeddb failed'); },
  });
  await controller.start({ userId: 'u1', categoryId: 'reading' });
  await assert.rejects(() => controller.stop(() => ({})), /indexeddb failed/);
  assert.equal(controller.active.categoryId, 'reading');
  assert.ok(storage.getItem('timer'));
});
