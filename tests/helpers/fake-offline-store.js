function clone(value) {
  return value === undefined ? undefined : structuredClone(value);
}

export async function createMemoryOfflineStore() {
  const pending = new Map();
  const snapshots = new Map();
  const uiStates = new Map();

  return {
    async putPending(record) { pending.set(record.localId, clone(record)); },
    async updatePending(record) { pending.set(record.localId, clone(record)); },
    async getPendingById(localId) { return clone(pending.get(localId) || null); },
    async getPending(userId) {
      return [...pending.values()]
        .filter((record) => record.userId === userId)
        .sort((a, b) => Number(a.createdAt) - Number(b.createdAt) || a.localId.localeCompare(b.localId))
        .map(clone);
    },
    async deletePending(localId) { pending.delete(localId); },
    async countPending(userId) {
      return [...pending.values()].filter((record) => record.userId === userId).length;
    },
    async countPendingByCategory(userId, categoryId) {
      return [...pending.values()].filter((record) => record.userId === userId && record.categoryId === categoryId).length;
    },
    async deletePendingByCategory(userId, categoryId) {
      let deleted = 0;
      for (const [id, record] of pending) {
        if (record.userId === userId && record.categoryId === categoryId) {
          pending.delete(id);
          deleted += 1;
        }
      }
      return deleted;
    },
    async getSnapshot(userId) { return clone(snapshots.get(userId) || null); },
    async patchSnapshot(userId, partial) {
      const next = { ...(snapshots.get(userId) || {}), ...clone(partial), userId };
      snapshots.set(userId, next);
      return clone(next);
    },
    async getUiState(userId) { return clone(uiStates.get(userId) || null); },
    async putUiState(userId, value) {
      uiStates.set(userId, clone(value));
      return clone(value);
    },
  };
}
