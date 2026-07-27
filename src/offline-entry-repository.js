import {
  classifySyncError,
  createPendingEntry,
  mergeRemoteAndPendingEntries,
} from './offline-entry-domain.js';

function defaultCreateId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `entry-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function createOfflineEntryRepository({
  store,
  remote,
  createId = defaultCreateId,
  now = () => Date.now(),
} = {}) {
  if (!store || !remote?.save) throw new Error('오프라인 기록 저장소 설정이 필요합니다.');

  async function persistFailure(record, error) {
    const kind = classifySyncError(error);
    const next = {
      ...record,
      status: kind === 'retryable' ? 'pending' : 'failed',
      attempts: Number(record.attempts || 0) + 1,
      lastAttemptAt: now(),
      lastError: String(error?.message || error || '동기화 실패'),
    };
    await store.updatePending(next);
    return { kind, record: next };
  }

  async function syncRecord(record) {
    try {
      await remote.save(record);
      await store.deletePending(record.localId);
      return { status: 'synced', record };
    } catch (error) {
      const failure = await persistFailure(record, error);
      return {
        status: failure.kind === 'retryable' ? 'queued' : 'failed',
        record: failure.record,
        error,
      };
    }
  }

  return {
    async saveEntryLocalFirst({
      userId,
      entry,
      localId = createId(),
      clearActiveTimer = null,
      onLocalSaved = null,
    }) {
      const record = createPendingEntry({
        userId,
        entry,
        localId,
        createdAt: entry?.createdAt ?? now(),
        clearActiveTimer,
      });
      await store.putPending(record);
      if (typeof onLocalSaved === 'function') await onLocalSaved(record);
      const synced = await syncRecord(record);
      const pendingCount = await store.countPending(userId);
      return {
        status: synced.status,
        localId,
        entry: {
          ...synced.record.entry,
          id: localId,
          syncStatus: synced.status === 'synced' ? 'synced' : synced.record.status,
        },
        pendingCount,
        error: synced.error || null,
      };
    },

    async flushPendingEntries(userId) {
      const records = await store.getPending(userId);
      let syncedCount = 0;
      for (const record of records) {
        if (record.status === 'failed') continue;
        const result = await syncRecord(record);
        if (result.status === 'synced') syncedCount += 1;
      }
      const remaining = await store.getPending(userId);
      return {
        syncedCount,
        pendingCount: remaining.filter((record) => record.status !== 'failed').length,
        failedCount: remaining.filter((record) => record.status === 'failed').length,
      };
    },

    async retryEntry(userId, localId) {
      const record = await store.getPendingById(localId);
      if (!record || record.userId !== userId) throw new Error('다시 시도할 기록을 찾을 수 없습니다.');
      const pending = { ...record, status: 'pending', lastError: null };
      await store.updatePending(pending);
      const result = await syncRecord(pending);
      return {
        status: result.status,
        localId,
        pendingCount: await store.countPending(userId),
        error: result.error || null,
      };
    },

    async listMergedEntries(userId, remoteEntries = []) {
      const pending = await store.getPending(userId);
      return mergeRemoteAndPendingEntries(remoteEntries, pending);
    },
  };
}

export function createFirestoreEntryRemote({ firestore, db }) {
  if (!firestore || !db) throw new Error('Firestore 설정이 필요합니다.');

  return {
    async save(record) {
      const entryRef = firestore.doc(db, 'users', record.userId, 'entries', record.localId);
      const activeRef = firestore.doc(db, 'users', record.userId, 'activeTimer', 'current');

      await firestore.runTransaction(db, async (transaction) => {
        let activeSnapshot = null;
        if (record.clearActiveTimer) activeSnapshot = await transaction.get(activeRef);

        const { id: _localId, syncStatus: _syncStatus, syncError: _syncError, ...entryPayload } = record.entry;
        transaction.set(entryRef, {
          ...entryPayload,
          localCreatedAt: record.createdAt,
          createdAt: firestore.serverTimestamp(),
        }, { merge: true });

        if (!record.clearActiveTimer || !activeSnapshot?.exists()) return;
        const active = activeSnapshot.data();
        const matchesUser = active.userId === record.clearActiveTimer.userId;
        const matchesStart = Number(active.startedAt) === Number(record.clearActiveTimer.startedAt);
        if (matchesUser && matchesStart) transaction.delete(activeRef);
      });
    },
  };
}
