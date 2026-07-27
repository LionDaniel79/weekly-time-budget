const safeParse = (value) => {
  try { return value ? JSON.parse(value) : null; }
  catch { return null; }
};

const RETRYABLE_CODES = new Set([
  'unavailable',
  'deadline-exceeded',
  'resource-exhausted',
  'network-request-failed',
]);

function isRetryable(error = {}) {
  const code = String(error?.code || '').toLowerCase().split('/').pop();
  return RETRYABLE_CODES.has(code)
    || /network|offline|failed to fetch|connection|timeout/i.test(String(error?.message || error || ''));
}

const positiveTimestamp = (value, fallback = null) => {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
};

export function normalizeTimerSnapshot(timer) {
  if (!timer) return null;
  const startedAt = positiveTimestamp(timer.startedAt);
  if (!startedAt) return null;
  const running = timer.running !== false;
  const accumulatedMs = Math.max(0, Number.isFinite(Number(timer.accumulatedMs)) ? Number(timer.accumulatedMs) : 0);
  const resumedAt = running
    ? positiveTimestamp(timer.resumedAt, startedAt)
    : null;
  const pausedAt = running
    ? null
    : positiveTimestamp(timer.pausedAt, positiveTimestamp(timer.stateChangedAt, startedAt));
  const stateChangedAt = positiveTimestamp(
    timer.stateChangedAt,
    positiveTimestamp(pausedAt, positiveTimestamp(resumedAt, startedAt)),
  );
  return {
    ...timer,
    startedAt,
    accumulatedMs,
    resumedAt,
    pausedAt,
    stateChangedAt,
    running,
  };
}

export function createTimerSnapshot({ userId, categoryId, note = '', startedAt = Date.now(), startedDate }) {
  if (!userId) throw new Error('사용자 정보가 필요합니다.');
  if (!categoryId) throw new Error('대분류를 선택하세요.');
  const timestamp = Number(startedAt);
  if (!Number.isFinite(timestamp) || timestamp <= 0) throw new Error('타이머 시작 시각이 올바르지 않습니다.');
  return {
    userId,
    categoryId,
    note: String(note || '').trim(),
    startedAt: timestamp,
    startedDate: startedDate || localDateKey(new Date(timestamp)),
    accumulatedMs: 0,
    resumedAt: timestamp,
    pausedAt: null,
    stateChangedAt: timestamp,
    running: true,
  };
}

export function localDateKey(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function elapsedMilliseconds(timer, now = Date.now()) {
  const normalized = normalizeTimerSnapshot(timer);
  if (!normalized) return 0;
  const accumulated = Math.max(0, normalized.accumulatedMs);
  if (!normalized.running) return accumulated;
  const current = Number(now);
  const segment = Number.isFinite(current)
    ? Math.max(0, current - normalized.resumedAt)
    : 0;
  return accumulated + segment;
}

export function elapsedSeconds(timer, now = Date.now()) {
  return Math.max(0, Math.floor(elapsedMilliseconds(timer, now) / 1000));
}

export function createPersistentTimerController({
  remote,
  storage,
  storageKey,
  complete = null,
  now = () => Date.now(),
}) {
  if (!remote || !storage || !storageKey) throw new Error('타이머 저장소 설정이 필요합니다.');
  const completeTimer = complete || remote.complete;
  if (typeof completeTimer !== 'function') throw new Error('타이머 기록 저장 설정이 필요합니다.');
  const updateRemote = typeof remote.update === 'function'
    ? (timer) => remote.update(timer)
    : (timer) => remote.set(timer);
  let active = null;

  const writeLocal = (timer) => storage.setItem(storageKey, JSON.stringify(timer));
  const clearLocal = () => storage.removeItem(storageKey);
  const readLocal = () => normalizeTimerSnapshot(safeParse(storage.getItem(storageKey)));
  const useTimer = (timer) => {
    active = normalizeTimerSnapshot(timer);
    if (active) writeLocal(active);
    else clearLocal();
    return active;
  };
  const useRemoteTimer = (timer) => ({ timer: useTimer(timer), recovered: true, remotePending: false });

  const persistTransition = async (nextTimer) => {
    const previous = active;
    active = normalizeTimerSnapshot(nextTimer);
    writeLocal(active);
    try {
      await updateRemote(active);
      return { timer: active, remotePending: false };
    } catch (error) {
      if (isRetryable(error)) return { timer: active, remotePending: true };
      active = previous;
      if (previous) writeLocal(previous);
      else clearLocal();
      throw error;
    }
  };

  return {
    get active() { return active; },

    async recover() {
      const local = readLocal();
      try {
        const remoteTimer = normalizeTimerSnapshot(await remote.get());
        if (remoteTimer && local) {
          if (local.startedAt !== remoteTimer.startedAt) {
            return useRemoteTimer(remoteTimer).timer;
          }
          if (local.stateChangedAt > remoteTimer.stateChangedAt) {
            active = local;
            writeLocal(local);
            try { await updateRemote(local); }
            catch (error) { if (!isRetryable(error)) throw error; }
            return active;
          }
          return useRemoteTimer(remoteTimer).timer;
        }
        if (remoteTimer) return useRemoteTimer(remoteTimer).timer;
        if (local) {
          active = local;
          try { await remote.set(local); }
          catch (error) { if (!isRetryable(error)) throw error; }
          return active;
        }
        active = null;
        clearLocal();
        return null;
      } catch (error) {
        if (local && isRetryable(error)) {
          active = local;
          return active;
        }
        throw error;
      }
    },

    async start(input) {
      const local = readLocal();
      if (local) {
        active = local;
        return { timer: active, recovered: true, remotePending: true };
      }

      let existing = null;
      let remotePending = false;
      try {
        existing = normalizeTimerSnapshot(await remote.get());
      } catch (error) {
        if (!isRetryable(error)) throw error;
        remotePending = true;
      }
      if (existing) return useRemoteTimer(existing);

      const timer = createTimerSnapshot({ ...input, startedAt: input.startedAt ?? now() });
      active = timer;
      writeLocal(timer);
      try {
        await remote.set(timer);
      } catch (error) {
        const racedTimer = normalizeTimerSnapshot(await remote.get().catch(() => null));
        if (racedTimer) return useRemoteTimer(racedTimer);
        if (!isRetryable(error)) {
          active = null;
          clearLocal();
          throw error;
        }
        remotePending = true;
      }
      return { timer, recovered: false, remotePending };
    },

    async pause() {
      if (!active) throw new Error('진행 중인 타이머가 없습니다.');
      if (active.running === false) return { timer: active, remotePending: false };
      const changedAt = now();
      return persistTransition({
        ...active,
        accumulatedMs: elapsedMilliseconds(active, changedAt),
        resumedAt: null,
        pausedAt: changedAt,
        stateChangedAt: changedAt,
        running: false,
      });
    },

    async resume() {
      if (!active) throw new Error('진행 중인 타이머가 없습니다.');
      if (active.running !== false) return { timer: active, remotePending: false };
      const changedAt = now();
      return persistTransition({
        ...active,
        resumedAt: changedAt,
        pausedAt: null,
        stateChangedAt: changedAt,
        running: true,
      });
    },

    async stop(buildEntry) {
      if (!active) throw new Error('진행 중인 타이머가 없습니다.');
      const timer = active;
      const endedAt = now();
      const elapsedMs = elapsedMilliseconds(timer, endedAt);
      const durationMinutes = Math.max(1, Math.round(elapsedMs / 60000));
      const entry = buildEntry(timer, { endedAt, elapsedMs, durationMinutes });
      const completion = await completeTimer(timer, entry);
      active = null;
      clearLocal();
      return { entry, completion };
    },

    async cancel() {
      if (!active) return;
      await remote.remove(active);
      active = null;
      clearLocal();
    },

    elapsedSeconds() {
      return elapsedSeconds(active, now());
    },
  };
}
