export const OFFLINE_DB_SCHEMA = Object.freeze({
  name: 'weekly-time-budget-offline',
  version: 1,
  stores: Object.freeze(['pendingEntries', 'userSnapshots', 'uiState']),
  pendingIndexes: Object.freeze(['userId', 'userCreatedAt', 'userCategory']),
});

function requestToPromise(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('오프라인 저장소 요청에 실패했습니다.'));
  });
}

function transactionToPromise(transaction) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error || new Error('오프라인 저장소 작업에 실패했습니다.'));
    transaction.onabort = () => reject(transaction.error || new Error('오프라인 저장소 작업이 취소되었습니다.'));
  });
}

function openDatabase(indexedDB, dbName) {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(dbName, OFFLINE_DB_SCHEMA.version);

    request.onupgradeneeded = () => {
      const db = request.result;
      let pending;
      if (!db.objectStoreNames.contains('pendingEntries')) {
        pending = db.createObjectStore('pendingEntries', { keyPath: 'localId' });
      } else {
        pending = request.transaction.objectStore('pendingEntries');
      }
      if (!pending.indexNames.contains('userId')) pending.createIndex('userId', 'userId', { unique: false });
      if (!pending.indexNames.contains('userCreatedAt')) {
        pending.createIndex('userCreatedAt', ['userId', 'createdAt'], { unique: false });
      }
      if (!pending.indexNames.contains('userCategory')) {
        pending.createIndex('userCategory', ['userId', 'categoryId'], { unique: false });
      }

      if (!db.objectStoreNames.contains('userSnapshots')) {
        db.createObjectStore('userSnapshots', { keyPath: 'userId' });
      }
      if (!db.objectStoreNames.contains('uiState')) {
        db.createObjectStore('uiState', { keyPath: 'userId' });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('오프라인 저장소를 열지 못했습니다.'));
    request.onblocked = () => reject(new Error('다른 앱 화면이 오프라인 저장소 갱신을 막고 있습니다.'));
  });
}

function readStore(db, storeName) {
  const transaction = db.transaction(storeName, 'readonly');
  return { transaction, store: transaction.objectStore(storeName) };
}

function writeStore(db, storeName) {
  const transaction = db.transaction(storeName, 'readwrite');
  return { transaction, store: transaction.objectStore(storeName) };
}

async function putValue(db, storeName, value) {
  const { transaction, store } = writeStore(db, storeName);
  store.put(value);
  await transactionToPromise(transaction);
  return value;
}

async function deleteValue(db, storeName, key) {
  const { transaction, store } = writeStore(db, storeName);
  store.delete(key);
  await transactionToPromise(transaction);
}

export async function createOfflineStore({
  indexedDB = globalThis.indexedDB,
  dbName = OFFLINE_DB_SCHEMA.name,
} = {}) {
  if (!indexedDB) throw new Error('이 브라우저에서는 오프라인 저장소를 사용할 수 없습니다.');
  const db = await openDatabase(indexedDB, dbName);

  return {
    async putPending(record) {
      return putValue(db, 'pendingEntries', record);
    },

    async updatePending(record) {
      return putValue(db, 'pendingEntries', record);
    },

    async getPendingById(localId) {
      const { store } = readStore(db, 'pendingEntries');
      return (await requestToPromise(store.get(localId))) || null;
    },

    async getPending(userId) {
      const { store } = readStore(db, 'pendingEntries');
      const values = await requestToPromise(store.index('userId').getAll(userId));
      return values.sort((left, right) => (
        Number(left.createdAt || 0) - Number(right.createdAt || 0)
        || String(left.localId).localeCompare(String(right.localId))
      ));
    },

    async deletePending(localId) {
      await deleteValue(db, 'pendingEntries', localId);
    },

    async countPending(userId) {
      const { store } = readStore(db, 'pendingEntries');
      return requestToPromise(store.index('userId').count(userId));
    },

    async countPendingByCategory(userId, categoryId) {
      const { store } = readStore(db, 'pendingEntries');
      return requestToPromise(store.index('userCategory').count([userId, categoryId]));
    },

    async deletePendingByCategory(userId, categoryId) {
      const transaction = db.transaction('pendingEntries', 'readwrite');
      const store = transaction.objectStore('pendingEntries');
      const records = await requestToPromise(store.index('userCategory').getAll([userId, categoryId]));
      records.forEach((record) => store.delete(record.localId));
      await transactionToPromise(transaction);
      return records.length;
    },

    async getSnapshot(userId) {
      const { store } = readStore(db, 'userSnapshots');
      return (await requestToPromise(store.get(userId))) || null;
    },

    async patchSnapshot(userId, partial = {}) {
      return new Promise((resolve, reject) => {
        const transaction = db.transaction('userSnapshots', 'readwrite');
        const store = transaction.objectStore('userSnapshots');
        const request = store.get(userId);
        let next;

        request.onsuccess = () => {
          next = { ...(request.result || {}), ...partial, userId };
          store.put(next);
        };
        request.onerror = () => reject(request.error || new Error('오프라인 스냅숏을 읽지 못했습니다.'));
        transaction.oncomplete = () => resolve(next);
        transaction.onerror = () => reject(transaction.error || new Error('오프라인 스냅숏을 저장하지 못했습니다.'));
        transaction.onabort = () => reject(transaction.error || new Error('오프라인 스냅숏 저장이 취소되었습니다.'));
      });
    },

    async getUiState(userId) {
      const { store } = readStore(db, 'uiState');
      const value = await requestToPromise(store.get(userId));
      if (!value) return null;
      const { userId: _userId, ...state } = value;
      return state;
    },

    async putUiState(userId, value) {
      await putValue(db, 'uiState', { ...value, userId });
      return value;
    },

    close() {
      db.close();
    },
  };
}
