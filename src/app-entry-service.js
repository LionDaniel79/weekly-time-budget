import { normalizeGoalType } from './goal-domain.js';

export function createAppEntryService({
  getUser,
  getCategories,
  getEntries,
  getRemoteEntries,
  setRemoteEntries,
  getRuntime,
  dataSource,
  refreshMergedEntries,
  publishHistoryState,
  renderAll,
  loadData,
  showEntrySaveResult,
  showLocalSaveError,
  showToast,
  dispatch = (name, detail) => document.dispatchEvent(new CustomEvent(name, { detail })),
}) {
  async function saveEntry(entry, { onLocalSaved } = {}) {
    const runtime = getRuntime();
    const user = getUser();
    if (!runtime || !user) throw new Error('오프라인 저장소가 준비되지 않았습니다.');
    const category = getCategories().find((item) => item.id === entry.categoryId);
    const normalizedEntry = {
      ...entry,
      goalType: normalizeGoalType(entry.goalType ?? category?.goalType),
      createdAt: Date.now(),
    };
    try {
      const result = await runtime.repository.saveEntryLocalFirst({
        userId: user.uid,
        entry: normalizedEntry,
        onLocalSaved: async (record) => {
          await refreshMergedEntries();
          publishHistoryState();
          showToast({ type: 'queued', title: '✓ 기기에 안전하게 저장했습니다.', message: '서버 반영 상태를 확인하고 있습니다.' });
          dispatch('weekly-time-budget:entries-changed', {
            userId: user.uid,
            entries: getEntries(),
            pendingCount: await runtime.pendingCount(),
          });
          await onLocalSaved?.(record);
        },
      });
      if (result.status === 'synced') {
        const remoteEntries = [{ ...result.entry, syncStatus: undefined }, ...getRemoteEntries().filter((item) => item.id !== result.localId)];
        setRemoteEntries(remoteEntries);
        await runtime.store.patchSnapshot(user.uid, { entries: remoteEntries });
      }
      await refreshMergedEntries();
      publishHistoryState();
      showEntrySaveResult(result);
      dispatch('weekly-time-budget:entries-changed', { userId: user.uid, entries: getEntries(), pendingCount: result.pendingCount });
      dispatch('weekly-time-budget:data-changed');
      return result;
    } catch (error) {
      showLocalSaveError();
      throw error;
    }
  }

  async function deleteEntry(id) {
    if (!confirm('이 기록을 삭제할까요?')) return;
    const runtime = getRuntime();
    const user = getUser();
    const entry = getEntries().find((item) => item.id === id);
    if (entry?.syncStatus === 'pending' || entry?.syncStatus === 'failed') {
      await runtime.store.deletePending(id);
    } else {
      await dataSource.deleteEntry(user.uid, id);
      setRemoteEntries(getRemoteEntries().filter((item) => item.id !== id));
    }
    await refreshMergedEntries();
    await runtime.store.patchSnapshot(user.uid, { entries: getRemoteEntries() });
    renderAll();
    dispatch('weekly-time-budget:entries-changed', { entries: getEntries() });
  }

  async function retryEntry(id) {
    const runtime = getRuntime();
    const user = getUser();
    const result = await runtime.repository.retryEntry(user.uid, id);
    await refreshMergedEntries();
    renderAll();
    showEntrySaveResult(result);
    if (result.status === 'synced') await loadData().catch(() => {});
    dispatch('weekly-time-budget:entries-changed', { entries: getEntries() });
  }

  return { saveEntry, deleteEntry, retryEntry };
}
