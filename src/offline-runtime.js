import { createOfflineStore } from './offline-store.js';
import {
  createFirestoreEntryRemote,
  createOfflineEntryRepository,
} from './offline-entry-repository.js';
import { createOfflineSyncCoordinator } from './offline-sync.js';

let storePromise = null;
const runtimes = new Map();

function browserEvent(name, detail) {
  if (typeof document === 'undefined' || typeof CustomEvent === 'undefined') return;
  document.dispatchEvent(new CustomEvent(name, { detail }));
}

async function sharedStore() {
  if (!storePromise) storePromise = createOfflineStore();
  return storePromise;
}

export async function getOfflineRuntime({
  userId,
  firestore,
  db,
  eventTarget = globalThis.window,
  documentTarget = globalThis.document,
  onSyncResult,
} = {}) {
  if (!userId) throw new Error('오프라인 런타임에 사용자 정보가 필요합니다.');

  const existing = runtimes.get(userId);
  if (existing) {
    if (onSyncResult) existing.subscribe(onSyncResult);
    return existing;
  }

  const store = await sharedStore();
  const remote = createFirestoreEntryRemote({ firestore, db });
  const repository = createOfflineEntryRepository({ store, remote });
  const subscribers = new Set();
  if (onSyncResult) subscribers.add(onSyncResult);

  const coordinator = createOfflineSyncCoordinator({
    repository,
    userId,
    eventTarget,
    documentTarget,
    onResult(result) {
      subscribers.forEach((subscriber) => {
        try { subscriber(result); } catch (error) { console.error(error); }
      });
      browserEvent('weekly-time-budget:sync-result', { userId, ...result });
      if (result.syncedCount > 0) {
        browserEvent('weekly-time-budget:entries-changed', { userId, ...result });
        browserEvent('weekly-time-budget:data-changed', { userId, ...result });
      }
    },
  });

  const runtime = {
    userId,
    store,
    repository,
    coordinator,
    subscribe(listener) {
      if (listener) subscribers.add(listener);
      return () => subscribers.delete(listener);
    },
    async mergedEntries(remoteEntries = []) {
      return repository.listMergedEntries(userId, remoteEntries);
    },
    async pendingCount() {
      return store.countPending(userId);
    },
    requestSync(reason = 'requested') {
      return coordinator.flush(reason);
    },
  };

  runtimes.set(userId, runtime);
  coordinator.start();
  return runtime;
}

export function getExistingOfflineRuntime(userId) {
  return runtimes.get(userId) || null;
}

export function stopOfflineRuntime(userId) {
  const runtime = runtimes.get(userId);
  if (!runtime) return;
  runtime.coordinator.stop();
  runtimes.delete(userId);
}
