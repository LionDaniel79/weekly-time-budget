function plainDocuments(snapshot) {
  return snapshot.docs.map((item) => ({ id: item.id, ...item.data() }));
}

function timeoutAfter(milliseconds) {
  return new Promise((_, reject) => {
    setTimeout(() => reject(new Error('서버 응답이 늦어 기기에 저장된 자료를 표시합니다.')), milliseconds);
  });
}

export function createStatisticsDataSource({
  firestore,
  db,
  runtimeForUser,
  timeoutMs = 8000,
  clock = () => Date.now(),
}) {
  async function readCache(userId) {
    const runtime = runtimeForUser(userId);
    if (!runtime) return null;
    const snapshot = await runtime.store.getSnapshot(userId);
    if (!snapshot) return null;
    const statistics = snapshot.statisticsData || {};
    const remoteEntries = Array.isArray(statistics.entries)
      ? statistics.entries : Array.isArray(snapshot.entries) ? snapshot.entries : [];
    const data = {
      entries: await runtime.mergedEntries(remoteEntries),
      activeCategories: Array.isArray(statistics.activeCategories)
        ? statistics.activeCategories : Array.isArray(snapshot.categories) ? snapshot.categories : [],
      archivedCategories: Array.isArray(statistics.archivedCategories)
        ? statistics.archivedCategories : Array.isArray(snapshot.archivedCategories) ? snapshot.archivedCategories : [],
      weeklyBudgets: Array.isArray(statistics.weeklyBudgets)
        ? statistics.weeklyBudgets : Array.isArray(snapshot.weeklyBudgets)
          ? snapshot.weeklyBudgets : snapshot.weeklyBudget ? [snapshot.weeklyBudget] : [],
    };
    const hasData = Object.values(data).some((items) => items.length > 0);
    if (!hasData) return null;
    const updatedAt = Number(statistics.updatedAt || snapshot.updatedAt || 0);
    return { data, dataVersion: `cache:${updatedAt}`, source: 'cache', warning: '' };
  }

  async function readServer(userId) {
    const root = ['users', userId];
    const request = Promise.all([
      firestore.getDocs(firestore.query(firestore.collection(db, ...root, 'entries'), firestore.orderBy('date', 'desc'))),
      firestore.getDocs(firestore.collection(db, ...root, 'categories')),
      firestore.getDocs(firestore.collection(db, ...root, 'archivedCategories')),
      firestore.getDocs(firestore.collection(db, ...root, 'weeklyBudgets')),
    ]);
    const [entries, active, archived, weekly] = await Promise.race([request, timeoutAfter(timeoutMs)]);
    const runtime = runtimeForUser(userId);
    const remoteEntries = plainDocuments(entries);
    const updatedAt = clock();
    const data = {
      entries: runtime ? await runtime.mergedEntries(remoteEntries) : remoteEntries,
      activeCategories: plainDocuments(active),
      archivedCategories: plainDocuments(archived),
      weeklyBudgets: plainDocuments(weekly),
    };
    if (runtime) {
      await runtime.store.patchSnapshot(userId, {
        statisticsData: { ...data, entries: remoteEntries, updatedAt },
      });
    }
    return { data, dataVersion: `server:${updatedAt}`, source: 'server', warning: '' };
  }

  async function load(userId, { onCache = () => {}, onServer = () => {} } = {}) {
    const cached = await readCache(userId);
    if (cached) await onCache(cached);
    try {
      const server = await readServer(userId);
      await onServer(server);
      return server;
    } catch (error) {
      if (!cached) throw error;
      return { ...cached, warning: error.message };
    }
  }

  return { readCache, readServer, load };
}
