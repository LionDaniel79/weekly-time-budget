export function createOfflineSyncCoordinator({
  repository,
  userId,
  eventTarget = globalThis.window,
  documentTarget = globalThis.document,
  onResult = () => {},
} = {}) {
  if (!repository?.flushPendingEntries || !userId) throw new Error('동기화 설정이 필요합니다.');

  let activePromise = null;
  let started = false;

  const flush = (reason = 'manual') => {
    if (activePromise) return activePromise;
    activePromise = Promise.resolve()
      .then(() => repository.flushPendingEntries(userId))
      .then((result) => {
        onResult({ ...result, reason }, reason);
        return { ...result, reason };
      })
      .finally(() => {
        activePromise = null;
      });
    return activePromise;
  };

  const onOnline = () => { flush('online').catch(() => {}); };
  const onVisibilityChange = () => {
    if (documentTarget?.visibilityState === 'visible' || documentTarget?.hidden === false) {
      flush('visible').catch(() => {});
    }
  };
  const onRequested = () => { flush('requested').catch(() => {}); };

  return {
    flush,

    start({ flushOnStart = true } = {}) {
      if (started) return;
      started = true;
      eventTarget?.addEventListener?.('online', onOnline);
      eventTarget?.addEventListener?.('weekly-time-budget:request-sync', onRequested);
      documentTarget?.addEventListener?.('visibilitychange', onVisibilityChange);
      if (flushOnStart) flush('startup').catch(() => {});
    },

    stop() {
      if (!started) return;
      started = false;
      eventTarget?.removeEventListener?.('online', onOnline);
      eventTarget?.removeEventListener?.('weekly-time-budget:request-sync', onRequested);
      documentTarget?.removeEventListener?.('visibilitychange', onVisibilityChange);
    },

    get running() {
      return Boolean(activePromise);
    },
  };
}
