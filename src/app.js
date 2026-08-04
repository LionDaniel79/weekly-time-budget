import { createAppBootstrap } from './app-bootstrap.js';
import { createAppEntryService } from './app-entry-service.js';
import { createAppSessionState } from './app-session-state.js';
import { getWeekRange, toDateKey } from './domain.js';
import { MANUAL_INPUT_MODES } from './manual-entry.js';
import { getOfflineRuntime, stopOfflineRuntime } from './offline-runtime.js';
import {
  showEntrySaveResult,
  showLocalSaveError,
  showOfflineNotice,
  showSyncResult,
  showToast,
} from './app-toast.js';
import { createDefaultUiState } from './ui-session-state.js';
import { normalizeGoalType } from './goal-domain.js';

const views = ['dashboard', 'record', 'budget', 'history', 'statistics', 'categories'];
const state = {
  user: null,
  categories: [],
  archivedCategories: [],
  entries: [],
  remoteEntries: [],
  timer: null,
  activeRecordTab: 'timer',
  manualInputMode: MANUAL_INPUT_MODES.TIME_RANGE,
  manualCategoryId: '',
  activeView: 'dashboard',
  uiState: null,
  offlineRuntime: null,
};

let dataSource;
let sessionState;
let entryService;
let loadingPromise = null;
let reloadRequested = false;

const $ = (selector) => document.querySelector(selector);
const uiContext = () => ({
  today: toDateKey(new Date()),
  currentWeekStart: getWeekRange().start,
  validViews: views,
});

const allKnownCategories = () => {
  const byId = new Map(state.archivedCategories.map((category) => [category.id, category]));
  state.categories.forEach((category) => byId.set(category.id, category));
  return [...byId.values()];
};

async function refreshMergedEntries() {
  if (!state.offlineRuntime || !state.user) return;
  state.entries = await state.offlineRuntime.mergedEntries(state.remoteEntries);
}

async function saveUiState(partial) {
  if (!sessionState) return;
  state.uiState = await sessionState.persist(state.uiState, partial);
  window.__weeklyTimeBudgetUiState = state.uiState;
}

let bootstrap;
function publishAuthState(overrides = {}) {
  document.dispatchEvent(new CustomEvent('weekly-time-budget:auth-state', {
    detail: {
      configured: bootstrap?.configured ?? false,
      user: state.user,
      onLogin: () => bootstrap.login(),
      onLogout: () => bootstrap.logout(),
      ...overrides,
    },
  }));
}

async function performLoadData() {
  const { categories, archivedCategories, entries } = await dataSource.loadUserData(state.user.uid);
  state.categories = categories;
  state.archivedCategories = archivedCategories;
  state.remoteEntries = entries;
  await refreshMergedEntries();
  await state.offlineRuntime.store.patchSnapshot(state.user.uid, {
    categories: state.categories,
    archivedCategories: state.archivedCategories,
    entries: state.remoteEntries,
    updatedAt: Date.now(),
  });
}

async function loadData() {
  if (!state.user) return;
  if (loadingPromise) {
    reloadRequested = true;
    return loadingPromise;
  }
  loadingPromise = (async () => {
    do {
      reloadRequested = false;
      await performLoadData();
    } while (reloadRequested && state.user);
  })();
  try { await loadingPromise; }
  finally { loadingPromise = null; }
}

async function saveCategory({ id, name, defaultBudgetMinutes: budget, goalType }) {
  const trimmedName = String(name || '').trim();
  if (!trimmedName) throw new Error('대분류 이름을 입력하세요.');
  const existing = state.categories.find((category) => category.id === id);
  const basePayload = {
    name: trimmedName,
    defaultBudgetMinutes: Number(budget) || 0,
    order: existing?.order || state.categories.length + 1,
  };
  await dataSource.saveCategory(state.user.uid, {
    id,
    payload: id ? basePayload : {
      ...basePayload,
      goalType: normalizeGoalType(goalType),
      createdDate: toDateKey(new Date()),
    },
  });
  await loadData();
  renderAll();
}

async function archiveCategory(id) {
  await dataSource.archiveCategory(state.user.uid, id);
  await loadData();
  renderAll();
  document.dispatchEvent(new CustomEvent('weekly-time-budget:data-changed'));
}

async function restoreCategory(id) {
  await dataSource.restoreCategory(state.user.uid, id);
  await loadData();
  renderAll();
  document.dispatchEvent(new CustomEvent('weekly-time-budget:data-changed'));
}

async function deleteCategory(id) {
  if (!confirm('이 대분류를 삭제할까요? 기존 기록은 유지됩니다.')) return;
  await dataSource.deleteCategory(state.user.uid, id);
  await loadData();
  renderAll();
}

function createEntryService() {
  entryService = createAppEntryService({
    getUser: () => state.user,
    getCategories: () => state.categories,
    getEntries: () => state.entries,
    getRemoteEntries: () => state.remoteEntries,
    setRemoteEntries: (entries) => { state.remoteEntries = entries; },
    getRuntime: () => state.offlineRuntime,
    dataSource,
    refreshMergedEntries,
    publishHistoryState,
    renderAll,
    loadData,
    showEntrySaveResult,
    showLocalSaveError,
    showToast,
  });
}

async function handleSignedInUser({ user, db, storeModule }) {
  try {
    state.offlineRuntime = await getOfflineRuntime({
      userId: user.uid,
      firestore: storeModule,
      db,
      onSyncResult: async (result) => {
        showSyncResult(result);
        if (result.syncedCount > 0) {
          try { await loadData(); renderAll(); }
          catch { await refreshMergedEntries(); renderAll(); }
        }
      },
    });
  } catch (error) {
    console.error('오프라인 저장소 초기화 실패', error);
    showLocalSaveError();
    return;
  }

  sessionState = createAppSessionState({
    store: state.offlineRuntime.store,
    userId: user.uid,
    uiContext,
    onSnapshot: (snapshot) => {
      if (Array.isArray(snapshot?.categories)) state.categories = snapshot.categories;
      if (Array.isArray(snapshot?.archivedCategories)) state.archivedCategories = snapshot.archivedCategories;
      if (Array.isArray(snapshot?.entries)) state.remoteEntries = snapshot.entries;
    },
    onUiState: (uiState) => {
      state.uiState = uiState;
      state.activeView = uiState.activeView;
      state.activeRecordTab = uiState.record.tab;
      state.manualInputMode = uiState.record.manualMode;
      window.__weeklyTimeBudgetUiState = uiState;
    },
    refreshMergedEntries,
  });
  createEntryService();

  const hadSnapshot = await sessionState.restore();
  if (hadSnapshot) {
    renderAll();
    restoreVisibleState();
  }
  try {
    await loadData();
  } catch (error) {
    console.warn('온라인 데이터 갱신 실패', error);
    if (hadSnapshot) showOfflineNotice();
    else showToast({ type: 'error', title: '데이터를 불러오지 못했습니다.', message: '온라인에서 한 번 실행한 뒤 오프라인 기록을 사용할 수 있습니다.' });
  }
  renderAll();
  restoreVisibleState();
}

async function onUserChanged({ user, db, storeModule, dataSource: nextDataSource }) {
  const previousUid = state.user?.uid;
  state.user = user;
  dataSource = nextDataSource;
  publishAuthState({ user });
  if (!user) {
    if (previousUid) stopOfflineRuntime(previousUid);
    state.categories = [];
    state.archivedCategories = [];
    state.entries = [];
    state.remoteEntries = [];
    state.offlineRuntime = null;
    sessionState = null;
    entryService = null;
    loadingPromise = null;
    reloadRequested = false;
    return;
  }
  await handleSignedInUser({ user, db, storeModule });
}

function renderAll() {
  const range = getWeekRange();
  $('#week-label').textContent = `${range.start} — ${range.end} · 월~주일`;
  publishRecordState();
  publishHistoryState();
  publishCategoryState();
}

function publishRecordState() {
  document.dispatchEvent(new CustomEvent('weekly-time-budget:record-state', {
    detail: {
      categories: state.categories,
      activeRecordTab: state.activeRecordTab,
      manualInputMode: state.manualInputMode,
      manualCategoryId: state.manualCategoryId,
      timer: state.timer,
      onSaveEntry: (...args) => entryService.saveEntry(...args),
      onUiChange: ({ activeRecordTab, manualInputMode, manualCategoryId }) => {
        state.activeRecordTab = activeRecordTab;
        state.manualInputMode = manualInputMode;
        state.manualCategoryId = manualCategoryId;
        saveUiState({ record: { tab: activeRecordTab, manualMode: manualInputMode } }).catch(console.error);
      },
      onTimerChange: (timer) => { state.timer = timer; },
    },
  }));
}

function publishHistoryState() {
  document.dispatchEvent(new CustomEvent('weekly-time-budget:history-state', {
    detail: {
      categories: allKnownCategories(),
      activeCategoryIds: state.categories.map((category) => category.id),
      entries: state.entries,
      onDelete: (id) => entryService.deleteEntry(id),
      onRetry: (id) => entryService.retryEntry(id),
    },
  }));
}

function publishCategoryState() {
  document.dispatchEvent(new CustomEvent('weekly-time-budget:category-state', {
    detail: {
      categories: state.categories,
      archivedCategories: state.archivedCategories,
      onSave: saveCategory,
      onArchive: archiveCategory,
      onRestore: restoreCategory,
      onDelete: deleteCategory,
    },
  }));
}

function restoreVisibleState() {
  const restored = state.uiState || createDefaultUiState(uiContext());
  window.__weeklyTimeBudgetUiState = restored;
  document.dispatchEvent(new CustomEvent('weekly-time-budget:shell-state', { detail: { activeView: restored.activeView } }));
  document.dispatchEvent(new CustomEvent('weekly-time-budget:ui-state-restored', { detail: restored }));
}

document.addEventListener('weekly-time-budget:save-ui-state', (event) => { saveUiState(event.detail || {}).catch(console.error); });
document.addEventListener('weekly-time-budget:entries-changed', async (event) => {
  if (!state.user || event.detail?.userId && event.detail.userId !== state.user.uid) return;
  if (Array.isArray(event.detail?.entries)) state.entries = event.detail.entries;
  else await refreshMergedEntries();
  publishHistoryState();
});
document.addEventListener('weekly-time-budget:data-changed', async () => {
  if (!state.user) return;
  try { await loadData(); renderAll(); restoreVisibleState(); }
  catch { await refreshMergedEntries(); }
});

bootstrap = createAppBootstrap({ publishAuthState, onUserChanged });
bootstrap.start();
