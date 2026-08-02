import test from 'node:test';
import assert from 'node:assert/strict';
import { createStatisticsDataSource } from '../src/statistics-data-source.js';

function fixtureDependencies({ serverDelay = 0, serverNeverResolves = false, timeoutMs = 50 } = {}) {
  const snapshots = new Map([['u1', {
    statisticsData: {
      entries: [{ id: 'cached', date: '2026-08-01', categoryId: 'reading', durationMinutes: 20 }],
      activeCategories: [{ id: 'reading', name: '독서', defaultBudgetMinutes: 420 }],
      archivedCategories: [],
      weeklyBudgets: [],
      updatedAt: 1,
    },
  }]]);
  const runtimeForUser = (userId) => snapshots.has(userId) ? {
    store: {
      getSnapshot: async (requested) => snapshots.get(requested) || null,
      patchSnapshot: async () => {},
    },
    mergedEntries: async (entries) => entries,
  } : null;
  const documents = {
    entries: [{ id: 'server', date: '2026-08-01', categoryId: 'reading', durationMinutes: 30 }],
    categories: [{ id: 'reading', name: '독서', defaultBudgetMinutes: 420 }],
    archivedCategories: [],
    weeklyBudgets: [],
  };
  const firestore = {
    collection: (_db, _users, _uid, name) => ({ name }),
    orderBy: () => ({}),
    query: (source) => source,
    getDocs: async (source) => {
      if (serverNeverResolves) return new Promise(() => {});
      await new Promise((resolve) => setTimeout(resolve, serverDelay));
      return { docs: documents[source.name].map((data) => ({ id: data.id, data: () => ({ ...data }) })) };
    },
  };
  return { firestore, db: {}, runtimeForUser, timeoutMs, clock: () => 2 };
}

test('캐시를 서버보다 먼저 전달한다', async () => {
  const order = [];
  const source = createStatisticsDataSource(fixtureDependencies({ serverDelay: 20 }));
  await source.load('u1', {
    onCache: (snapshot) => order.push(snapshot.source),
    onServer: (snapshot) => order.push(snapshot.source),
  });
  assert.deepEqual(order, ['cache', 'server']);
});

test('서버 제한시간 후 캐시와 경고를 유지한다', async () => {
  const source = createStatisticsDataSource(fixtureDependencies({ serverNeverResolves: true, timeoutMs: 10 }));
  const result = await source.load('u1', { onCache() {}, onServer() {} });
  assert.equal(result.source, 'cache');
  assert.match(result.warning, /서버 응답/);
});

test('다른 사용자 캐시는 읽지 않는다', async () => {
  const source = createStatisticsDataSource(fixtureDependencies());
  assert.equal(await source.readCache('u2'), null);
});
