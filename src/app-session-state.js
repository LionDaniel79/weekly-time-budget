import {
  createDefaultUiState,
  mergeUiState,
  normalizeUiState,
} from './ui-session-state.js';

export function createAppSessionState({
  store,
  userId,
  uiContext,
  onSnapshot = () => {},
  onUiState = () => {},
  refreshMergedEntries = async () => {},
}) {
  if (!store || !userId || typeof uiContext !== 'function') {
    throw new Error('Session state dependencies are required.');
  }

  return {
    async persist(currentUiState, partial) {
      const next = mergeUiState(
        currentUiState || createDefaultUiState(uiContext()),
        partial,
        uiContext(),
      );
      await store.putUiState(userId, next);
      onUiState(next);
      return next;
    },

    async restore() {
      const [snapshot, savedUi] = await Promise.all([
        store.getSnapshot(userId),
        store.getUiState(userId),
      ]);
      if (snapshot) onSnapshot(snapshot);
      await refreshMergedEntries();
      const uiState = normalizeUiState(savedUi || {}, uiContext());
      onUiState(uiState);
      return Boolean(snapshot);
    },
  };
}
