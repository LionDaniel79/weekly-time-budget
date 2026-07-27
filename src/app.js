import { firebaseConfig } from '../firebase-config.js';
import {
  formatMinutes,
  getWeekRange,
  minutesBetween,
  summarizeCategories,
  toDateKey,
} from './domain.js';
import {
  MANUAL_INPUT_MODES,
  createManualDurationEntry,
  manualEntryTimeLabel,
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
  weeklyBudget: null,
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
const defaultBudgetMinutes = (category) => Number(category.defaultBudgetMinutes ?? category.budgetMinutes ?? 0);
const currentWeekKey = () => getWeekRange().start;
const uiContext = () => ({
  today: toDateKey(new Date()),
  currentWeekStart: currentWeekKey(),
  validViews: views,
});

const effectiveBudgetMinutes = (category) => {
  const weeklyValue = state.weeklyBudget?.budgets?.[category.id];
  return weeklyValue === undefined ? defaultBudgetMinutes(category) : Number(weeklyValue) || 0;
};
const categoriesForSummary = () => state.categories.map((category) => ({
  ...category,
  budgetMinutes: effectiveBudgetMinutes(category),
}));
const optionHtml = (selectedId = '') => state.categories
  .map((category) => `<option value="${category.id}" ${category.id === selectedId ? 'selected' : ''}>${escapeHtml(category.name)}</option>`)
  .join('');

function plainEntry(doc) {
  const data = doc.data();
  const createdAt = data.createdAt?.toMillis?.()
    ?? (Number(data.localCreatedAt || 0) || Date.now());
  return { id: doc.id, ...data, createdAt };
}

function applySnapshotToState(snapshot = {}) {
  if (Array.isArray(snapshot.categories)) state.categories = snapshot.categories;
  if (Array.isArray(snapshot.entries)) state.remoteEntries = snapshot.entries;
  if (snapshot.weeklyBudget !== undefined) state.weeklyBudget = snapshot.weeklyBudget;
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
    const [categorySnapshot, entrySnapshot, weeklySnapshot] = await Promise.all([
      firebase.getDocs(firebase.query(firebase.collection(db, ...root, 'categories'), firebase.orderBy('order'))),
      firebase.getDocs(firebase.query(firebase.collection(db, ...root, 'entries'), firebase.orderBy('date', 'desc'))),
      firebase.getDoc(firebase.doc(db, ...root, 'weeklyBudgets', currentWeekKey())),
    ]);
    state.categories = categorySnapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
    state.remoteEntries = entrySnapshot.docs.map(plainEntry);
    state.weeklyBudget = weeklySnapshot.exists() ? { id: weeklySnapshot.id, ...weeklySnapshot.data() } : null;
    await refreshMergedEntries();
    await state.offlineRuntime.store.patchSnapshot(state.user.uid, {
      categories: state.categories,
      entries: state.remoteEntries,
      weeklyBudget: state.weeklyBudget,
      updatedAt: Date.now(),
    });
  } finally {
    loadingData = false;
  }
}

async function saveCategory({ id, name, defaultBudgetMinutes: budget }) {
  const trimmedName = String(name || '').trim();
  if (!trimmedName) throw new Error('대분류 이름을 입력하세요.');
  const existing = state.categories.find((category) => category.id === id);
  const payload = { name: trimmedName, defaultBudgetMinutes: Number(budget) || 0, order: existing?.order || state.categories.length + 1 };
  const collectionRef = firebase.collection(db, 'users', state.user.uid, 'categories');
  if (id) await firebase.setDoc(firebase.doc(collectionRef, id), payload, { merge: true });
  else await firebase.addDoc(collectionRef, payload);
  await loadData(); renderAll();
}

async function saveWeeklyBudget(budgets) {
  const weekKey = currentWeekKey();
  await firebase.setDoc(firebase.doc(db, 'users', state.user.uid, 'weeklyBudgets', weekKey), {
    weekStart: weekKey, budgets, updatedAt: firebase.serverTimestamp(),
  }, { merge: true });
  await loadData(); renderAll();
}

async function deleteCategory(id) {
  if (!confirm('이 대분류를 삭제할까요? 기존 기록은 유지됩니다.')) return;
  await firebase.deleteDoc(firebase.doc(db, 'users', state.user.uid, 'categories', id));
  await loadData(); renderAll();
}

async function saveEntry(entry, { onLocalSaved } = {}) {
  if (!state.offlineRuntime) throw new Error('오프라인 저장소가 준비되지 않았습니다.');
  try {
    const result = await state.offlineRuntime.repository.saveEntryLocalFirst({
      userId: state.user.uid,
      entry: { ...entry, createdAt: Date.now() },
      onLocalSaved: async (record) => {
        await refreshMergedEntries();
        renderDashboard(); renderHistory();
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
    renderDashboard(); renderHistory();
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
  renderDashboard(); renderRecord(); renderBudget(); renderHistory(); renderCategories();
}

function renderDashboard() {
  const range = getWeekRange();
  const summary = summarizeCategories(categoriesForSummary(), state.entries, range.start, range.end);
  const totalBudget = summary.reduce((sum, item) => sum + item.budgetMinutes, 0);
  const totalActual = summary.reduce((sum, item) => sum + item.actualMinutes, 0);
  const totalRate = totalBudget ? Math.round((totalActual / totalBudget) * 100) : 0;
  $('#dashboard-view').innerHTML = `<div class="grid grid-3">
    <article class="card"><p class="muted">전체 달성률</p><div class="metric">${totalRate}%</div><div class="progress"><span style="width:${Math.min(totalRate, 100)}%"></span></div></article>
    <article class="card"><p class="muted">이번 주 예산</p><div class="metric">${formatMinutes(totalBudget)}</div><p class="muted">월요일부터 주일까지</p></article>
    <article class="card"><p class="muted">실제 기록</p><div class="metric">${formatMinutes(totalActual)}</div><p class="muted">월요일부터 주일까지 모두 포함</p></article>
  </div><div class="card" style="margin-top:18px"><div class="section-title"><h2>대분류별 달성률</h2><span class="badge">${summary.length}개 분야</span></div>
  ${summary.length ? summary.map((item) => `<div class="budget-row"><div><strong>${escapeHtml(item.name)}</strong><div class="progress"><span style="width:${Math.min(item.percentage, 100)}%"></span></div></div><div>${formatMinutes(item.actualMinutes)} / ${formatMinutes(item.budgetMinutes)}</div><strong>${item.percentage}%</strong><span class="muted">${item.status === 'exceeded' ? `${formatMinutes(item.differenceMinutes)} 초과` : `${formatMinutes(item.differenceMinutes)} 남음`}</span></div>`).join('') : $('#empty-template').innerHTML}</div>`;
}

function renderRecord() {
  $('#record-view').innerHTML = `<div class="tabs"><button class="tab-button ${state.activeRecordTab === 'timer' ? 'active' : ''}" data-record-tab="timer">타이머</button><button class="tab-button ${state.activeRecordTab === 'manual' ? 'active' : ''}" data-record-tab="manual">수동 입력</button></div><div class="card">${state.activeRecordTab === 'timer' ? timerForm() : manualForm()}</div>`;
  document.querySelectorAll('[data-record-tab]').forEach((button) => {
    button.onclick = () => {
      state.activeRecordTab = button.dataset.recordTab;
      persistUiState({ record: { tab: state.activeRecordTab, manualMode: state.manualInputMode } }).catch(console.error);
      renderRecord();
    };
  });
  if (state.activeRecordTab === 'timer') bindTimer(); else bindManual();
}

function timerForm() {
  const elapsed = state.timer ? Math.floor((Date.now() - state.timer.startedAt) / 1000) : 0;
  const selectedCategoryId = state.timer?.categoryId || '';
  return `<div class="form-grid"><label>대분류<select id="timer-category" ${state.timer ? 'disabled' : ''}><option value="">선택하세요</option>${optionHtml(selectedCategoryId)}</select></label><label>메모(선택)<textarea id="timer-note" rows="2" ${state.timer ? 'disabled' : ''}>${escapeHtml(state.timer?.note || '')}</textarea></label></div><div id="timer-display" class="timer">${formatClock(elapsed)}</div><div class="actions"><button id="timer-action" class="primary-button">${state.timer ? '종료하고 저장' : '타이머 시작'}</button>${state.timer ? '<button id="timer-cancel" class="secondary-button">취소</button>' : ''}</div>`;
}

function bindTimer() {
  $('#timer-action').onclick = async () => {
    if (!state.timer) {
      const categoryId = $('#timer-category').value;
      if (!categoryId) return alert('대분류를 선택하세요.');
      state.timer = { categoryId, note: $('#timer-note').value.trim(), startedAt: Date.now() };
      renderRecord();
      state.timerInterval = setInterval(() => {
        const display = $('#timer-display');
        if (display) display.textContent = formatClock(Math.floor((Date.now() - state.timer.startedAt) / 1000));
      }, 1000);
      return;
    }
    const timer = state.timer;
    const endedAt = Date.now();
    await saveEntry({ categoryId: timer.categoryId, note: timer.note, date: toDateKey(new Date(timer.startedAt)), durationMinutes: Math.max(1, Math.round((endedAt - timer.startedAt) / 60000)), startTime: new Date(timer.startedAt).toTimeString().slice(0, 5), endTime: new Date(endedAt).toTimeString().slice(0, 5), source: 'timer' });
    clearInterval(state.timerInterval); state.timer = null; renderRecord();
  };
  if ($('#timer-cancel')) $('#timer-cancel').onclick = () => { clearInterval(state.timerInterval); state.timer = null; renderRecord(); };
}

function manualForm() {
  const now = new Date();
  const end = now.toTimeString().slice(0, 5);
  const start = new Date(now.getTime() - 3600000).toTimeString().slice(0, 5);
  const durationMode = state.manualInputMode === MANUAL_INPUT_MODES.DURATION;
  return `<form id="manual-form" class="form-grid" novalidate><div class="manual-mode-switch" role="group" aria-label="수동 입력 방식"><button type="button" class="tab-button ${durationMode ? '' : 'active'}" data-manual-mode="time-range" aria-pressed="${durationMode ? 'false' : 'true'}">시작·종료 시각</button><button type="button" class="tab-button ${durationMode ? 'active' : ''}" data-manual-mode="duration" aria-pressed="${durationMode ? 'true' : 'false'}">분 직접 입력</button></div><label>대분류<select id="manual-category" required><option value="">선택하세요</option>${optionHtml(state.manualCategoryId)}</select></label><label>날짜<input id="manual-date" type="date" value="${toDateKey(now)}" required></label>${durationMode ? `<label>직접 기록할 시간<div class="duration-input-row"><input id="manual-duration" type="number" min="1" max="1440" step="1" inputmode="numeric" autocomplete="off" required><span aria-hidden="true">분</span></div></label>` : `<div class="time-fields"><label>시작<input id="manual-start" type="time" value="${start}" required></label><label>종료<input id="manual-end" type="time" value="${end}" required></label></div>`}<label>메모(선택)<textarea id="manual-note" rows="2"></textarea></label><button class="primary-button" type="submit">기록 저장</button></form>`;
}

function bindManual() {
  document.querySelectorAll('[data-manual-mode]').forEach((button) => {
    button.onclick = () => {
      state.manualCategoryId = $('#manual-category')?.value || state.manualCategoryId;
      state.manualInputMode = button.dataset.manualMode;
      persistUiState({ record: { tab: 'manual', manualMode: state.manualInputMode } }).catch(console.error);
      renderRecord();
    };
  });
  $('#manual-form').onsubmit = async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const submit = form.querySelector('[type="submit"]');
    const categoryId = $('#manual-category').value;
    const date = $('#manual-date').value;
    if (!categoryId) return alert('대분류를 선택하세요.');
    if (!date) return alert('날짜를 선택하세요.');
    state.manualCategoryId = categoryId;
    let entry;
    try {
      if (state.manualInputMode === MANUAL_INPUT_MODES.DURATION) {
        entry = createManualDurationEntry({ categoryId, date, note: $('#manual-note').value, durationMinutes: $('#manual-duration').value });
      } else {
        const startTime = $('#manual-start').value;
        const endTime = $('#manual-end').value;
        if (!startTime || !endTime) throw new Error('시간 범위를 확인하세요.');
        const durationMinutes = minutesBetween(startTime, endTime);
        if (durationMinutes <= 0 || durationMinutes > 1440) throw new Error('시간 범위를 확인하세요.');
        entry = { categoryId, note: $('#manual-note').value.trim(), date, durationMinutes, startTime, endTime, source: 'manual' };
      }
      submit.disabled = true;
      await saveEntry(entry, { onLocalSaved: () => { if (form.isConnected) renderRecord(); } });
    } catch (error) {
      if (!/오프라인 저장소|기기에 기록/.test(String(error.message || error))) alert(error instanceof Error ? error.message : String(error));
    } finally {
      if (submit.isConnected) submit.disabled = false;
    }
  };
}

function renderBudget() {
  $('#budget-view').innerHTML = `<div class="card"><div class="section-title"><div><h2>이번 주 시간 예산</h2><p class="muted">이번 주에만 적용됩니다. 다음 주에는 대분류의 기본 예산이 다시 표시됩니다.</p></div></div>${state.categories.length ? `<form id="budget-bulk-form"><div class="category-list">${state.categories.map((category) => `<div class="category-item budget-edit-row" data-id="${category.id}"><div><strong>${escapeHtml(category.name)}</strong><div class="muted">기본 ${formatMinutes(defaultBudgetMinutes(category))}</div></div><input type="number" name="hours" min="0" step="0.5" value="${effectiveBudgetMinutes(category) / 60}" aria-label="${escapeHtml(category.name)} 이번 주 예산 시간"></div>`).join('')}</div><div class="bulk-save-actions"><button class="primary-button" type="submit">이번 주 예산 저장</button></div></form>` : $('#empty-template').innerHTML}</div>`;
  if ($('#budget-bulk-form')) $('#budget-bulk-form').onsubmit = async (event) => { event.preventDefault(); const budgets = {}; document.querySelectorAll('.budget-edit-row').forEach((row) => { budgets[row.dataset.id] = Number(row.querySelector('[name="hours"]').value) * 60; }); await saveWeeklyBudget(budgets); alert('이번 주 예산을 저장했습니다.'); };
}

function renderHistory() {
  $('#history-view').innerHTML = `<div class="card"><div class="section-title"><h2>최근 기록</h2><span class="badge">${state.entries.length}건</span></div>${state.entries.length ? state.entries.map((entry) => { const category = state.categories.find((item) => item.id === entry.categoryId); const timeDescription = manualEntryTimeLabel(entry, formatMinutes); const pending = entry.syncStatus === 'pending'; const failed = entry.syncStatus === 'failed'; return `<div class="entry"><strong>${entry.date}</strong><div><strong>${escapeHtml(category?.name || '삭제된 대분류')}</strong><div>${escapeHtml(timeDescription)}</div>${entry.note ? `<p class="muted">${escapeHtml(entry.note)}</p>` : ''}${pending ? '<span class="sync-status pending">동기화 대기</span>' : ''}${failed ? `<span class="sync-status failed">동기화 실패</span><button class="sync-retry" data-id="${entry.id}" type="button">다시 시도</button>` : ''}</div><div class="entry-actions"><button class="text-button delete-entry" data-id="${entry.id}">삭제</button></div></div>`; }).join('') : '<div class="empty-state"><h3>아직 기록이 없습니다.</h3><p>타이머 또는 수동 입력으로 첫 시간을 기록하세요.</p></div>'}</div>`;
  document.querySelectorAll('.delete-entry').forEach((button) => { button.onclick = () => deleteEntry(button.dataset.id); });
  document.querySelectorAll('.sync-retry').forEach((button) => { button.onclick = () => retryEntry(button.dataset.id).catch((error) => showToast({ type: 'error', title: '동기화하지 못했습니다.', message: error.message })); });
}

function renderCategories() {
  $('#categories-view').innerHTML = `<div class="grid grid-2"><div class="card"><h2>대분류 추가</h2><form id="category-add" class="form-grid"><label>이름<input name="name" placeholder="예: 논문" required maxlength="30"></label><label>기본 주간 예산(시간)<input name="hours" type="number" min="0" step="0.5" value="0"></label><button class="primary-button">추가</button></form></div><div class="card"><h2>등록된 대분류</h2>${state.categories.length ? `<div class="category-list">${state.categories.map((category) => `<form class="category-item category-edit-row" data-id="${category.id}"><input name="name" value="${escapeHtml(category.name)}" required aria-label="대분류 이름"><input name="hours" type="number" min="0" step="0.5" value="${defaultBudgetMinutes(category) / 60}" aria-label="${escapeHtml(category.name)} 기본 예산 시간"><div class="category-row-actions"><button class="secondary-button" type="submit">수정</button><button class="danger-button category-delete" type="button">삭제</button></div></form>`).join('')}</div>` : $('#empty-template').innerHTML}</div></div>`;
  $('#category-add').onsubmit = async (event) => { event.preventDefault(); const data = new FormData(event.currentTarget); await saveCategory({ name: data.get('name'), defaultBudgetMinutes: Number(data.get('hours')) * 60 }); $('#category-add input[name="name"]')?.focus(); };
  document.querySelectorAll('.category-edit-row').forEach((form) => { form.onsubmit = async (event) => { event.preventDefault(); await saveCategory({ id: form.dataset.id, name: form.querySelector('[name="name"]').value, defaultBudgetMinutes: Number(form.querySelector('[name="hours"]').value) * 60 }); alert('대분류를 수정했습니다.'); }; form.querySelector('.category-delete').onclick = () => deleteCategory(form.dataset.id); });
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
  renderDashboard(); renderHistory();
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
