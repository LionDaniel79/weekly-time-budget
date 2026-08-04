import { firebaseConfig } from '../firebase-config.js';
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
const titles = {
  dashboard: '대시보드',
  record: '시간 기록',
  budget: '시간 예산',
  history: '기록 내역',
  statistics: '통계',
  categories: '대분류 관리',
};
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

function plainEntry(doc) {
  const data = doc.data();
  const createdAt = data.createdAt?.toMillis?.()
    ?? (Number(data.localCreatedAt || 0) || Date.now());
  return { id: doc.id, ...data, createdAt };
}

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

async function initFirebase() {
  if (!configured) {
    $('#config-warning').classList.remove('hidden');
    $('#google-login').disabled = true;
    return;
  }

  const appModule = await import('https://www.gstatic.com/firebasejs/11.10.0/firebase-app.js');
  const authModule = await import('https://www.gstatic.com/firebasejs/11.10.0/firebase-auth.js');
  const storeModule = await import('https://www.gstatic.com/firebasejs/11.10.0/firebase-firestore.js');
  const app = appModule.getApps().length ? appModule.getApp() : appModule.initializeApp(firebaseConfig);
  auth = authModule.getAuth(app);
  db = storeModule.getFirestore(app);
  firebase = { ...authModule, ...storeModule };
  await authModule.setPersistence(auth, authModule.browserLocalPersistence).catch((error) => {
    console.warn('로그인 상태 영속화 설정 실패', error);
  });

  authModule.onAuthStateChanged(auth, async (user) => {
    const previousUid = state.user?.uid;
    state.user = user;
    $('#login-view').classList.toggle('hidden', Boolean(user));
    $('#app-view').classList.toggle('hidden', !user);

    if (!user) {
      if (previousUid) stopOfflineRuntime(previousUid);
      state.categories = [];
      state.entries = [];
      state.remoteEntries = [];
      state.offlineRuntime = null;
      return;
    }

    $('#user-name').textContent = user.displayName || user.email;
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
    const root = ['users', state.user.uid];
    const [categorySnapshot, entrySnapshot] = await Promise.all([
      firebase.getDocs(firebase.query(firebase.collection(db, ...root, 'categories'), firebase.orderBy('order'))),
      firebase.getDocs(firebase.query(firebase.collection(db, ...root, 'entries'), firebase.orderBy('date', 'desc'))),
    ]);
    state.categories = categorySnapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
    state.remoteEntries = entrySnapshot.docs.map(plainEntry);
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

function switchView(name, { save = true } = {}) {
  const safe = views.includes(name) ? name : 'dashboard';
  views.forEach((view) => $(`#${view}-view`)?.classList.toggle('hidden', view !== safe));
  document.querySelectorAll('.nav-button').forEach((button) => button.classList.toggle('active', button.dataset.view === safe));
  $('#page-title').textContent = titles[safe] || '대시보드';
  $('.sidebar')?.classList.remove('open');
  state.activeView = safe;
  if (save) persistUiState({ activeView: safe }).catch(console.error);
}

function restoreVisibleState() {
  const restored = state.uiState || createDefaultUiState(uiContext());
  window.__weeklyTimeBudgetUiState = restored;
  switchView(restored.activeView, { save: false });
  document.dispatchEvent(new CustomEvent('weekly-time-budget:ui-state-restored', { detail: restored }));
}

document.querySelectorAll('.nav-button').forEach((button) => { button.onclick = () => switchView(button.dataset.view); });
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
$('#mobile-menu').onclick = () => $('.sidebar').classList.toggle('open');
$('#google-login').onclick = async () => {
  if (!firebase || !auth) return alert('로그인 기능을 준비하는 중입니다. 잠시 후 다시 눌러주세요.');
  try { await firebase.signInWithPopup(auth, new firebase.GoogleAuthProvider()); }
  catch (error) { console.error(error); alert(`Google 로그인에 실패했습니다: ${error.message}`); }
};
$('#logout').onclick = () => firebase.signOut(auth);

initFirebase().catch((error) => {
  console.error(error);
  $('#config-warning').textContent = `초기화 오류: ${error.message}`;
  $('#config-warning').classList.remove('hidden');
});
