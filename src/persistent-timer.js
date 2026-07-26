const safeParse = (value) => {
  try { return value ? JSON.parse(value) : null; }
  catch { return null; }
};

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
    running: true,
  };
}

export function localDateKey(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function elapsedSeconds(timer, now = Date.now()) {
  if (!timer?.startedAt) return 0;
  return Math.max(0, Math.floor((Number(now) - Number(timer.startedAt)) / 1000));
}

export function createPersistentTimerController({
  remote,
  storage,
  storageKey,
  now = () => Date.now(),
}) {
  if (!remote || !storage || !storageKey) throw new Error('타이머 저장소 설정이 필요합니다.');
  let active = null;

  const writeLocal = (timer) => storage.setItem(storageKey, JSON.stringify(timer));
  const clearLocal = () => storage.removeItem(storageKey);
  const readLocal = () => safeParse(storage.getItem(storageKey));
  const useRemoteTimer = (timer) => {
    active = timer;
    writeLocal(timer);
    return { timer: active, recovered: true };
  };

  return {
    get active() { return active; },

    async recover() {
      const local = readLocal();
      try {
        const remoteTimer = await remote.get();
        if (remoteTimer) {
          active = remoteTimer;
          writeLocal(remoteTimer);
          return active;
        }
        active = null;
        clearLocal();
        return null;
      } catch (error) {
        if (local) {
          active = local;
          return active;
        }
        throw error;
      }
    },

    async start(input) {
      const existing = await remote.get();
      if (existing) return useRemoteTimer(existing);
      const timer = createTimerSnapshot({ ...input, startedAt: input.startedAt ?? now() });
      try {
        await remote.set(timer);
      } catch (error) {
        const racedTimer = await remote.get().catch(() => null);
        if (racedTimer) return useRemoteTimer(racedTimer);
        throw error;
      }
      active = timer;
      writeLocal(timer);
      return { timer, recovered: false };
    },

    async stop(buildEntry) {
      if (!active) throw new Error('진행 중인 타이머가 없습니다.');
      const endedAt = now();
      const durationMinutes = Math.max(1, Math.round((endedAt - active.startedAt) / 60000));
      const entry = buildEntry(active, { endedAt, durationMinutes });
      await remote.complete(active, entry);
      active = null;
      clearLocal();
      return entry;
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
