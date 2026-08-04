import { firebaseConfig } from '../firebase-config.js';
import { createAppDataSource } from './app-data-source.js';
import {
  formatMinutes,
  getWeekRange,
  minutesBetween,
  summarizeCategories,
  summarizeWeeklyBudgetPeriod,
  toDateKey,
} from './domain.js';
import {
  MANUAL_INPUT_MODES,
  createManualDurationEntry,
} from './manual-entry.js';
import { getOfflineRuntime, stopOfflineRuntime } from './offline-runtime.js';
import {
  showEntrySaveResult,
  showLocalSaveError,
  showOfflineNotice,
  showSyncResult,
  showToast,
} from './app-toast.js';
import {
  createDefaultUiState,
  mergeUiState,
  normalizeUiState,
} from './ui-session-state.js';
import {
  calculateGoalComplianceScore,
  categoryDisplayName,
  normalizeGoalType,
} from './goal-domain.js';
import {
  filterCategoriesActiveOnDate,
  isCategoryActiveOnDate,
} from './category-effective-date.js';

const configured = !Object.values(firebaseConfig).some((value) => String(value).includes('REPLACE_ME'));
const views = ['dashboard', 'record', 'budget', 'history', 'statistics', 'categories'];
const state = {
  user: null,
  categories: [],
  entries: [],
  remoteEntries: [],
  timer: null,
  timerInterval: null,
  activeRecordTab: 'timer',
  manualInputMode: MANUAL_INPUT_MODES.TIME_RANGE,
  manualCategoryId: '',
  activeView: 'dashboard',
  uiState: null,
  offlineRuntime: null,
};

let auth;
let db;
let firebase;
let dataSource;
let loadingData = false;

const $ = (selector) => document.querySelector(selector);
const escapeHtml = (value = '') => String(value).replace(/[&<>'"]/g, (char) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;',
}[char]));
const currentWeekKey = () => getWeekRange().start;
const uiContext = () => ({
  today: toDateKey(new Date()),
  currentWeekStart: currentWeekKey(),
  validViews: views,
});

const categoryOptionHtml = ({ date, selectedId = '' }) => filterCategoriesActiveOnDate(state.categories, date)
  .map((category) => `<option value="${category.id}" ${category.id === selectedId ? 'selected' : ''}>${escapeHtml(categoryDisplayName(category))}</option>`)
  .join('');
const optionHtml = (selectedId = '') => categoryOptionHtml({ date: toDateKey(new Date()), selectedId });

function applySnapshotToState(snapshot = {}) {
  if (Array.isArray(snapshot.categories)) state.categories = snapshot.categories;
  if (Array.isArray(snapshot.entries)) state.remoteEntries = snapshot.entries;
}

async function refreshMergedEntries() {
  if (!state.offlineRuntime || !state.user) return;
  state.entries = await state.offlineRuntime.mergedEntries(state.remoteEntries);
}

async function persistUiState(partial) {
  if (!state.user || !state.offlineRuntime) return;
  state.uiState = mergeUiState(
    state.uiState || createDefaultUiState(uiContext()),
    partial,
    uiContext(),
  );
  window.__weeklyTimeBudgetUiState = state.uiState;
  await state.offlineRuntime.store.putUiState(state.user.uid, state.uiState);
}

async function restoreCachedState() {
  const [snapshot, savedUi] = await Promise.all([
    state.offlineRuntime.store.getSnapshot(state.user.uid),
    state.offlineRuntime.store.getUiState(state.user.uid),
  ]);
  if (snapshot) applySnapshotToState(snapshot);
  await refreshMergedEntries();
  state.uiState = normalizeUiState(savedUi || {}, uiContext());
  state.activeView = state.uiState.activeView;
  state.activeRecordTab = state.uiState.record.tab;
  state.manualInputMode = state.uiState.record.manualMode;
  window.__weeklyTimeBudgetUiState = state.uiState;
  return Boolean(snapshot);
}

function publishAuthState(overrides = {}) {
  document.dispatchEvent(new CustomEvent('weekly-time-budget:auth-state', {
    detail: {
      configured,
      user: state.user,
      onLogin: async () => {
        if (!firebase || !auth) throw new Error('로그인 기능을 준비하는 중입니다. 잠시 후 다시 눌러주세요.');
        await firebase.signInWithPopup(auth, new firebase.GoogleAuthProvider());
      },
      onLogout: () => firebase?.signOut(auth),
      ...overrides,
    },
  }));
}

async function initFirebase() {
  if (!configured) {
    publishAuthState({ configured: false });
    return;
  }

  const appModule = await import('https://www.gstatic.com/firebasejs/11.10.0/firebase-app.js');
  const authModule = await import('https://www.gstatic.com/firebasejs/11.10.0/firebase-auth.js');
  const storeModule = await import('https://www.gstatic.com/firebasejs/11.10.0/firebase-firestore.js');
  const app = appModule.getApps().length ? appModule.getApp() : appModule.initializeApp(firebaseConfig);
  auth = authModule.getAuth(app);
  db = storeModule.getFirestore(app);
  firebase = { ...authModule, ...storeModule };
  dataSource = createAppDataSource({ firebase, db });
  await authModule.setPersistence(auth, authModule.browserLocalPersistence).catch((error) => {
    console.warn('로그인 상태 영속화 설정 실패', error);
  });

  authModule.onAuthStateChanged(auth, async (user) => {
    const previousUid = state.user?.uid;
    state.user = user;
    publishAuthState({ user });

    if (!user) {
      if (previousUid) stopOfflineRuntime(previousUid);
      state.categories = [];
      state.entries = [];
      state.remoteEntries = [];
      state.offlineRuntime = null;
      return;
    }

    try {
      state.offlineRuntime = await getOfflineRuntime({
        userId: user.uid,
        firestore: storeModule,
        db,
        onSyncResult: async (result) => {
          showSyncResult(result);
          if (result.syncedCount > 0) {
            try { await loadData(); renderAll(); } catch { await refreshMergedEntries(); renderAll(); }
          }
        },
      });
    } catch (error) {
      console.error('오프라인 저장소 초기화 실패', error);
      showLocalSaveError();
      return;
    }

    const hadSnapshot = await restoreCachedState();
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
  });
}

async function loadData() {
  if (!state.user || loadingData) return;
  loadingData = true;
  try {
    const { categories, entries } = await dataSource.loadUserData(state.user.uid);
    state.categories = categories;
    state.remoteEntries = entries;
    await refreshMergedEntries();
    await state.offlineRuntime.store.patchSnapshot(state.user.uid, {
      categories: state.categories,
      entries: state.remoteEntries,
      updatedAt: Date.now(),
    });
  } finally {
    loadingData = false;
  }
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
  const collectionRef = firebase.collection(db, 'users', state.user.uid, 'categories');
  if (id) {
    await firebase.setDoc(firebase.doc(collectionRef, id), basePayload, { merge: true });
  } else {
    await firebase.addDoc(collectionRef, {
      ...basePayload,
      goalType: normalizeGoalType(goalType),
      createdDate: toDateKey(new Date()),
    });
  }
  await loadData(); renderAll();
}

async function deleteCategory(id) {
  if (!confirm('이 대분류를 삭제할까요? 기존 기록은 유지됩니다.')) return;
  await firebase.deleteDoc(firebase.doc(db, 'users', state.user.uid, 'categories', id));
  await loadData(); renderAll();
}

async function saveEntry(entry, { onLocalSaved } = {}) {
  if (!state.offlineRuntime) throw new Error('오프라인 저장소가 준비되지 않았습니다.');
  const category = state.categories.find((item) => item.id === entry.categoryId);
  const normalizedEntry = {
    ...entry,
    goalType: normalizeGoalType(entry.goalType ?? category?.goalType),
    createdAt: Date.now(),
  };
  try {
    const result = await state.offlineRuntime.repository.saveEntryLocalFirst({
      userId: state.user.uid,
      entry: normalizedEntry,
      onLocalSaved: async (record) => {
        await refreshMergedEntries();
        publishHistoryState();
        showToast({ type: 'queued', title: '✓ 기기에 안전하게 저장했습니다.', message: '서버 반영 상태를 확인하고 있습니다.' });
        document.dispatchEvent(new CustomEvent('weekly-time-budget:entries-changed', {
          detail: { userId: state.user.uid, entries: state.entries, pendingCount: await state.offlineRuntime.pendingCount() },
        }));
        await onLocalSaved?.(record);
      },
    });
    if (result.status === 'synced') {
      state.remoteEntries = [{ ...result.entry, syncStatus: undefined }, ...state.remoteEntries.filter((item) => item.id !== result.localId)];
      await state.offlineRuntime.store.patchSnapshot(state.user.uid, { entries: state.remoteEntries });
    }
    await refreshMergedEntries();
    publishHistoryState();
    showEntrySaveResult(result);
    document.dispatchEvent(new CustomEvent('weekly-time-budget:entries-changed', {
      detail: { userId: state.user.uid, entries: state.entries, pendingCount: result.pendingCount },
    }));
    document.dispatchEvent(new CustomEvent('weekly-time-budget:data-changed'));
    return result;
  } catch (error) {
    showLocalSaveError();
    throw error;
  }
}

async function deleteEntry(id) {
  if (!confirm('이 기록을 삭제할까요?')) return;
  const entry = state.entries.find((item) => item.id === id);
  if (entry?.syncStatus === 'pending' || entry?.syncStatus === 'failed') {
    await state.offlineRuntime.store.deletePending(id);
  } else {
    await firebase.deleteDoc(firebase.doc(db, 'users', state.user.uid, 'entries', id));
    state.remoteEntries = state.remoteEntries.filter((item) => item.id !== id);
  }
  await refreshMergedEntries();
  await state.offlineRuntime.store.patchSnapshot(state.user.uid, { entries: state.remoteEntries });
  renderAll();
  document.dispatchEvent(new CustomEvent('weekly-time-budget:entries-changed', { detail: { entries: state.entries } }));
}

async function retryEntry(id) {
  const result = await state.offlineRuntime.repository.retryEntry(state.user.uid, id);
  await refreshMergedEntries();
  renderAll();
  showEntrySaveResult(result);
  if (result.status === 'synced') await loadData().catch(() => {});
  document.dispatchEvent(new CustomEvent('weekly-time-budget:entries-changed', { detail: { entries: state.entries } }));
}

function renderAll() {
  const range = getWeekRange();
  $('#week-label').textContent = `${range.start} — ${range.end} · 월~주일`;
  publishRecordState(); publishHistoryState(); publishCategoryState();
}

function publishRecordState() {
  document.dispatchEvent(new CustomEvent('weekly-time-budget:record-state', {
    detail: {
      categories: state.categories,
      activeRecordTab: state.activeRecordTab,
      manualInputMode: state.manualInputMode,
      manualCategoryId: state.manualCategoryId,
      timer: state.timer,
      onSaveEntry: saveEntry,
      onUiChange: ({ activeRecordTab, manualInputMode, manualCategoryId }) => {
        state.activeRecordTab = activeRecordTab;
        state.manualInputMode = manualInputMode;
        state.manualCategoryId = manualCategoryId;
        persistUiState({ record: { tab: activeRecordTab, manualMode: manualInputMode } }).catch(console.error);
      },
      onTimerChange: (timer) => { state.timer = timer; },
    },
  }));
}

function publishHistoryState() {
  document.dispatchEvent(new CustomEvent('weekly-time-budget:history-state', {
    detail: {
      categories: state.categories,
      entries: state.entries,
      onDelete: deleteEntry,
      onRetry: retryEntry,
    },
  }));
}

function publishCategoryState() {
  document.dispatchEvent(new CustomEvent('weekly-time-budget:category-state', {
    detail: {
      categories: state.categories,
      onSave: saveCategory,
      onDelete: deleteCategory,
    },
  }));
}

function formatClock(seconds) { const h = Math.floor(seconds / 3600); const m = Math.floor((seconds % 3600) / 60); const s = seconds % 60; return [h, m, s].map((value) => String(value).padStart(2, '0')).join(':'); }

function restoreVisibleState() {
  const restored = state.uiState || createDefaultUiState(uiContext());
  window.__weeklyTimeBudgetUiState = restored;
  document.dispatchEvent(new CustomEvent('weekly-time-budget:shell-state', { detail: { activeView: restored.activeView } }));
  document.dispatchEvent(new CustomEvent('weekly-time-budget:ui-state-restored', { detail: restored }));
}

document.addEventListener('weekly-time-budget:save-ui-state', (event) => { persistUiState(event.detail || {}).catch(console.error); });
document.addEventListener('weekly-time-budget:entries-changed', async (event) => {
  if (!state.user || event.detail?.userId && event.detail.userId !== state.user.uid) return;
  if (Array.isArray(event.detail?.entries)) state.entries = event.detail.entries;
  else await refreshMergedEntries();
  publishHistoryState();
});
document.addEventListener('weekly-time-budget:data-changed', async () => {
  if (!state.user || loadingData) return;
  try { await loadData(); renderAll(); restoreVisibleState(); } catch { await refreshMergedEntries(); }
});

initFirebase().catch((error) => {
  console.error(error);
  publishAuthState({ configured: false, errorMessage: `초기화 오류: ${error.message}` });
});
