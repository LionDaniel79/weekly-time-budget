import { firebaseConfig } from '../firebase-config.js';
import { getWeekRange } from './domain.js';
import { createPersistentTimerController, localDateKey } from './persistent-timer.js';
import {
  EQUAL_DAY_WEIGHTS,
  effectiveDayWeights,
  resolveCountdownBudgetBaseline,
} from './time-budget-domain.js';
import { formatSignedTimerMilliseconds } from './countdown-timer-domain.js';
import { getOfflineRuntime } from './offline-runtime.js';
import { showEntrySaveResult, showToast } from './app-toast.js';

const appModule = await import('https://www.gstatic.com/firebasejs/11.10.0/firebase-app.js');
const authModule = await import('https://www.gstatic.com/firebasejs/11.10.0/firebase-auth.js');
const store = await import('https://www.gstatic.com/firebasejs/11.10.0/firebase-firestore.js');
const app = appModule.getApps().length ? appModule.getApp() : appModule.initializeApp(firebaseConfig);
const auth = authModule.getAuth(app);
const db = store.getFirestore(app);

const LAST_CATEGORY_KEY = 'weekly-time-budget:last-timer-category';
const state = {
  user: null,
  categories: [],
  archived: [],
  entries: [],
  weekly: [],
  daily: [],
  defaultDayWeights: { ...EQUAL_DAY_WEIGHTS },
  selectedMode: 'countdown',
  selectedCategoryId: '',
  previewBaseline: null,
  budgetReady: false,
  controller: null,
  runtime: null,
  interval: null,
  patchQueued: false,
  recoveryPromise: null,
  recoveryUserId: null,
  dataPromise: null,
  dataUserId: null,
};
const escapeHtml = (value = '') => String(value).replace(/[&<>'"]/g, (char) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;',
}[char]));

function storageKey(uid) { return `weekly-time-budget:active-timer:${uid}`; }

function plainEntry(doc) {
  const data = doc.data();
  return {
    id: doc.id,
    ...data,
    createdAt: data.createdAt?.toMillis?.() ?? (Number(data.localCreatedAt || 0) || Date.now()),
  };
}

function knownCategory(categoryId) {
  return state.categories.find((item) => item.id === categoryId)
    || state.archived.find((item) => item.id === categoryId)
    || null;
}

function currentWeekDocument(date) {
  const weekStart = getWeekRange(new Date(`${date}T12:00:00`)).start;
  return state.weekly.find((item) => (item.weekStart || item.id) === weekStart) || null;
}

function currentDailyDocument(date) {
  return state.daily.find((item) => (item.date || item.id) === date) || null;
}

function countdownBaselineFor(categoryId, date = localDateKey(new Date())) {
  const category = knownCategory(categoryId);
  if (!category || !state.budgetReady) return null;
  return resolveCountdownBudgetBaseline({
    category,
    date,
    entries: state.entries,
    weekDocument: currentWeekDocument(date),
    dailyDocument: currentDailyDocument(date),
    defaultDayWeights: state.defaultDayWeights,
  });
}

function updatePreviewBaseline() {
  if (state.controller?.active || state.selectedMode !== 'countdown' || !state.selectedCategoryId) {
    state.previewBaseline = null;
    return;
  }
  state.previewBaseline = countdownBaselineFor(state.selectedCategoryId);
}

async function refreshTimerData() {
  const user = state.user;
  if (!user || !state.runtime) return;
  if (state.dataPromise && state.dataUserId === user.uid) return state.dataPromise;

  const promise = (async () => {
    const cached = await state.runtime.store.getSnapshot(user.uid);
    const hadCache = Boolean(cached);
    if (Array.isArray(cached?.categories)) state.categories = cached.categories;
    if (Array.isArray(cached?.archivedCategories)) state.archived = cached.archivedCategories;
    if (Array.isArray(cached?.weeklyBudgets)) state.weekly = cached.weeklyBudgets;
    if (Array.isArray(cached?.dailyBudgets)) state.daily = cached.dailyBudgets;
    if (cached?.defaultDayWeights) {
      state.defaultDayWeights = effectiveDayWeights(null, cached.defaultDayWeights);
    }
    if (cached) {
      state.entries = await state.runtime.mergedEntries(Array.isArray(cached.entries) ? cached.entries : []);
      state.budgetReady = true;
    }

    const root = ['users', user.uid];
    try {
      const [categories, archived, entries, weekly, daily, settings] = await Promise.all([
        store.getDocs(store.query(store.collection(db, ...root, 'categories'), store.orderBy('order'))),
        store.getDocs(store.collection(db, ...root, 'archivedCategories')),
        store.getDocs(store.query(store.collection(db, ...root, 'entries'), store.orderBy('date', 'desc'))),
        store.getDocs(store.collection(db, ...root, 'weeklyBudgets')),
        store.getDocs(store.collection(db, ...root, 'dailyBudgets')),
        store.getDoc(store.doc(db, ...root, 'settings', 'timeBudget')),
      ]);
      if (state.user?.uid !== user.uid) return;
      state.categories = categories.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
      state.archived = archived.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
      const remoteEntries = entries.docs.map(plainEntry);
      state.entries = await state.runtime.mergedEntries(remoteEntries);
      state.weekly = weekly.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
      state.daily = daily.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
      state.defaultDayWeights = effectiveDayWeights(
        null,
        settings.exists() ? settings.data().defaultDayWeights : EQUAL_DAY_WEIGHTS,
      );
      state.budgetReady = true;
      await state.runtime.store.patchSnapshot(user.uid, {
        categories: state.categories,
        archivedCategories: state.archived,
        entries: remoteEntries,
        weeklyBudgets: state.weekly,
        dailyBudgets: state.daily,
        defaultDayWeights: state.defaultDayWeights,
        updatedAt: Date.now(),
      });
    } catch (error) {
      if (!hadCache && !state.categories.length) throw error;
      console.warn('오프라인 타이머 예산 스냅숏 사용', error);
      state.budgetReady = hadCache;
    }
    updatePreviewBaseline();
  })();

  state.dataPromise = promise;
  state.dataUserId = user.uid;
  try {
    await promise;
  } finally {
    if (state.dataPromise === promise) {
      state.dataPromise = null;
      state.dataUserId = null;
    }
  }
}

function dispatchEntryChange() {
  document.dispatchEvent(new CustomEvent('weekly-time-budget:entries-changed', {
    detail: { userId: state.user.uid },
  }));
  document.dispatchEvent(new CustomEvent('weekly-time-budget:data-changed'));
}

function sameTimer(snapshot, timer) {
  return Number(snapshot?.startedAt) === Number(timer?.startedAt);
}

function configureController() {
  const activeRef = store.doc(db, 'users', state.user.uid, 'activeTimer', 'current');
  state.controller = createPersistentTimerController({
    storage: localStorage,
    storageKey: storageKey(state.user.uid),
    remote: {
      async get() {
        const snapshot = await store.getDoc(activeRef);
        return snapshot.exists() ? snapshot.data() : null;
      },
      async set(timer) {
        await store.runTransaction(db, async (transaction) => {
          const existing = await transaction.get(activeRef);
          if (existing.exists()) throw new Error('active-timer-conflict');
          transaction.set(activeRef, { ...timer, updatedAt: store.serverTimestamp() });
        });
      },
      async update(timer) {
        await store.runTransaction(db, async (transaction) => {
          const existing = await transaction.get(activeRef);
          if (existing.exists() && !sameTimer(existing.data(), timer)) {
            throw new Error('active-timer-conflict');
          }
          transaction.set(
            activeRef,
            { ...timer, updatedAt: store.serverTimestamp() },
            { merge: true },
          );
        });
      },
      async remove(timer) {
        await store.runTransaction(db, async (transaction) => {
          const existing = await transaction.get(activeRef);
          if (!existing.exists()) return;
          if (!sameTimer(existing.data(), timer)) throw new Error('active-timer-conflict');
          transaction.delete(activeRef);
        });
      },
    },
    complete: async (timer, entry) => state.runtime.repository.saveEntryLocalFirst({
      userId: state.user.uid,
      localId: `timer-${Math.round(timer.startedAt)}`,
      entry: { ...entry, createdAt: Date.now() },
      clearActiveTimer: { userId: timer.userId, startedAt: timer.startedAt },
      onLocalSaved: async () => {
        showToast({
          type: 'queued',
          title: '✓ 타이머 기록을 기기에 안전하게 저장했습니다.',
          message: '서버 반영 상태를 확인하고 있습니다.',
        });
        dispatchEntryChange();
      },
    }),
  });
}

function categoryOptions(selectedId) {
  const all = new Map([...state.archived, ...state.categories].map((item) => [item.id, item]));
  const options = state.categories.map((category) => `<option value="${category.id}" ${category.id === selectedId ? 'selected' : ''}>${escapeHtml(category.name)}</option>`);
  if (selectedId && !state.categories.some((category) => category.id === selectedId)) {
    options.unshift(`<option value="${selectedId}" selected>${escapeHtml(all.get(selectedId)?.name || '보관된 대분류')}</option>`);
  }
  return options.join('');
}

function timerTabIsActive() {
  return Boolean(document.querySelector('#record-view [data-record-tab="timer"].active'));
}

async function refreshTimerFromRemote({ refreshData = false } = {}) {
  const user = state.user;
  const controller = state.controller;
  if (!user || !controller) return null;
  if (state.recoveryPromise && state.recoveryUserId === user.uid) return state.recoveryPromise;

  const promise = (async () => {
    if (refreshData) await refreshTimerData();
    const timer = await controller.recover();
    if (state.user?.uid !== user.uid || state.controller !== controller) return timer;
    if (timer) {
      state.selectedMode = timer.mode;
      state.selectedCategoryId = timer.categoryId;
      state.previewBaseline = null;
    } else {
      if (!state.selectedCategoryId) {
        state.selectedCategoryId = localStorage.getItem(LAST_CATEGORY_KEY) || '';
      }
      updatePreviewBaseline();
    }
    if (timerTabIsActive()) renderTimer();
    else schedulePatch();
    return timer;
  })();

  state.recoveryPromise = promise;
  state.recoveryUserId = user.uid;
  try {
    return await promise;
  } finally {
    if (state.recoveryPromise === promise) {
      state.recoveryPromise = null;
      state.recoveryUserId = null;
    }
  }
}

function renderTimer() {
  const view = document.querySelector('#record-view');
  if (!view || !timerTabIsActive() || !state.controller) return;
  const card = view.querySelector('.card');
  if (!card) return;
  const timer = state.controller.active;
  const selectedId = timer?.categoryId
    || state.selectedCategoryId
    || localStorage.getItem(LAST_CATEGORY_KEY)
    || '';
  if (!timer && selectedId !== state.selectedCategoryId) {
    state.selectedCategoryId = selectedId;
    updatePreviewBaseline();
  }
  const mode = timer?.mode || state.selectedMode;
  const isCalculating = !timer && mode === 'countdown' && selectedId && !state.budgetReady;
  const displayMs = timer
    ? state.controller.displayMilliseconds()
    : mode === 'countdown' && state.previewBaseline
      ? state.previewBaseline.initialRemainingMs
      : 0;
  const displayText = isCalculating
    ? '예산 계산 중'
    : formatSignedTimerMilliseconds(displayMs, { countdown: mode === 'countdown' });
  const isNegative = !isCalculating && displayMs < 0;
  const categoryLocked = Boolean(timer && (timer.mode !== 'countdown' || timer.running !== false));
  const pauseButton = timer
    ? `<button id="timer-pause" class="secondary-button">${timer.running !== false ? '멈춤' : '계속'}</button>`
    : '';
  const saveLabel = timer?.mode === 'countdown' ? '저장' : '종료하고 저장';
  const countdownDisabled = Boolean(timer && mode !== 'countdown');
  const countupDisabled = Boolean(timer && mode !== 'countup');
  const startDisabled = !timer && mode === 'countdown' && (!state.budgetReady || (selectedId && !state.previewBaseline));

  card.innerHTML = `<div data-feature-ui="persistent-timer">
    <div class="timer-mode-tabs" role="tablist" aria-label="타이머 방식">
      <button type="button" data-timer-mode="countdown" role="tab" aria-selected="${mode === 'countdown'}" ${countdownDisabled ? 'disabled aria-disabled="true"' : ''}>카운트 다운</button>
      <button type="button" data-timer-mode="countup" role="tab" aria-selected="${mode === 'countup'}" ${countupDisabled ? 'disabled aria-disabled="true"' : ''}>카운트 업</button>
    </div>
    <div class="form-grid">
      <label>대분류<select id="timer-category" ${categoryLocked ? 'disabled' : ''}><option value="">선택하세요</option>${categoryOptions(selectedId)}</select></label>
      <label>메모(선택)<textarea id="timer-note" rows="2" ${timer ? 'disabled' : ''}>${escapeHtml(timer?.note || '')}</textarea></label>
    </div>
    <div id="timer-display" class="timer${isNegative ? ' is-negative' : ''}" aria-live="polite">${displayText}</div>
    <div class="actions">${pauseButton}<button id="timer-action" class="primary-button" ${startDisabled ? 'disabled' : ''}>${timer ? saveLabel : '타이머 시작'}</button>${timer ? '<button id="timer-cancel" class="secondary-button">취소</button>' : ''}</div>
  </div>`;
  startDisplay();
}

function startDisplay() {
  stopDisplay();
  const active = state.controller?.active;
  if (!active) return;
  updateDisplay();
  if (active.running === false) return;
  state.interval = setInterval(updateDisplay, 1000);
}

function stopDisplay() {
  if (state.interval) clearInterval(state.interval);
  state.interval = null;
}

function updateDisplay() {
  const display = document.querySelector('#timer-display');
  const active = state.controller?.active;
  if (!display || !active) return;
  const value = state.controller.displayMilliseconds();
  display.textContent = formatSignedTimerMilliseconds(value, { countdown: active.mode === 'countdown' });
  display.classList.toggle('is-negative', value < 0);
}

async function saveActiveTimer({ refreshData = true, rerender = true } = {}) {
  const result = await state.controller.stop((timer, { endedAt, durationMinutes }) => ({
    categoryId: timer.categoryId,
    note: timer.note,
    date: timer.startedDate,
    durationMinutes,
    startTime: new Date(timer.startedAt).toTimeString().slice(0, 5),
    endTime: new Date(endedAt).toTimeString().slice(0, 5),
    source: 'timer',
    timerMode: timer.mode,
  }));
  stopDisplay();
  state.selectedMode = 'countdown';
  showEntrySaveResult(result.completion);
  dispatchEntryChange();
  if (refreshData) await refreshTimerData();
  updatePreviewBaseline();
  if (rerender) renderTimer();
  return result;
}

async function handleAction(button) {
  if (!state.controller || button.disabled) return;
  button.disabled = true;
  try {
    const active = state.controller.active;
    if (!active) {
      const categoryId = document.querySelector('#timer-category')?.value;
      if (!categoryId) return alert('대분류를 선택하세요.');
      const startedDate = localDateKey(new Date());
      const baseline = state.selectedMode === 'countdown'
        ? countdownBaselineFor(categoryId, startedDate)
        : null;
      if (state.selectedMode === 'countdown' && !baseline) {
        showToast({ type: 'error', title: '오늘 예산을 아직 불러오지 못했습니다.', message: '잠시 후 다시 시도하세요.' });
        return;
      }
      state.selectedCategoryId = categoryId;
      localStorage.setItem(LAST_CATEGORY_KEY, categoryId);
      const result = await state.controller.start({
        userId: state.user.uid,
        categoryId,
        note: document.querySelector('#timer-note')?.value || '',
        startedDate,
        mode: state.selectedMode,
        ...(baseline ? { budgetDate: startedDate, ...baseline } : {}),
      });
      if (result.timer) {
        state.selectedMode = result.timer.mode;
        state.selectedCategoryId = result.timer.categoryId;
      }
      if (result.recovered) {
        showToast({ type: 'info', title: '진행 중이던 타이머를 복구했습니다.' });
      } else if (result.remotePending) {
        showToast({
          type: 'queued',
          title: '타이머를 기기에서 시작했습니다.',
          message: '인터넷 연결 후 실행 상태를 서버에 확인합니다.',
        });
      }
      renderTimer();
      return;
    }

    await saveActiveTimer();
  } catch (error) {
    console.error(error);
    if (error.message === 'active-timer-conflict') {
      await recoverAfterConflict().catch(console.error);
      return;
    }
    showToast({
      type: 'error',
      title: '타이머 작업에 실패했습니다.',
      message: error.message,
    });
    renderTimer();
  } finally {
    if (button.isConnected) button.disabled = false;
  }
}

async function recoverAfterConflict() {
  await refreshTimerFromRemote({ refreshData: true });
  showToast({ type: 'info', title: '다른 기기의 타이머 상태를 불러왔습니다.' });
}

async function handlePauseToggle(button) {
  const active = state.controller?.active;
  if (!active || button.disabled) return;
  button.disabled = true;
  try {
    const wasRunning = active.running !== false;
    const result = wasRunning
      ? await state.controller.pause()
      : await state.controller.resume();
    if (wasRunning) stopDisplay();
    renderTimer();
    if (result.remotePending) {
      showToast({
        type: 'queued',
        title: wasRunning ? '타이머를 기기에서 멈췄습니다.' : '타이머를 기기에서 계속합니다.',
        message: '인터넷 연결 후 실행 상태를 서버에 반영합니다.',
      });
    }
  } catch (error) {
    console.error(error);
    if (error.message === 'active-timer-conflict') {
      await recoverAfterConflict().catch(console.error);
      return;
    }
    showToast({
      type: 'error',
      title: '타이머 상태를 변경하지 못했습니다.',
      message: error.message,
    });
    renderTimer();
  } finally {
    if (button.isConnected) button.disabled = false;
  }
}

async function handleCancel(button) {
  if (!confirm('진행 중인 타이머를 취소할까요? 기록은 저장되지 않습니다.')) return;
  button.disabled = true;
  try {
    await state.controller.cancel();
    stopDisplay();
    state.selectedMode = 'countdown';
    updatePreviewBaseline();
    renderTimer();
  } catch (error) {
    if (error.message === 'active-timer-conflict') {
      await recoverAfterConflict().catch(console.error);
      return;
    }
    showToast({ type: 'error', title: '타이머를 취소하지 못했습니다.', message: '인터넷 연결 후 다시 시도하세요.' });
  } finally {
    if (button.isConnected) button.disabled = false;
  }
}

function handleModeChange(button) {
  if (state.controller?.active || button.disabled) return;
  state.selectedMode = button.dataset.timerMode === 'countup' ? 'countup' : 'countdown';
  updatePreviewBaseline();
  renderTimer();
}

async function handleCountdownCategoryChange(nextCategoryId) {
  const timer = state.controller?.active;
  if (!timer || timer.mode !== 'countdown' || timer.running !== false) return;
  try {
    await saveActiveTimer({ refreshData: false, rerender: false });
    await refreshTimerData();
    state.selectedMode = 'countdown';
    state.selectedCategoryId = nextCategoryId;
    if (nextCategoryId) localStorage.setItem(LAST_CATEGORY_KEY, nextCategoryId);
    updatePreviewBaseline();
    renderTimer();
  } catch (error) {
    console.error(error);
    renderTimer();
    showToast({
      type: 'error',
      title: '기존 카운트다운을 저장하지 못했습니다.',
      message: error.message,
    });
  }
}

document.addEventListener('click', (event) => {
  const opensRecord = event.target.closest('.nav-button[data-view="record"], [data-record-tab="timer"]');
  if (!opensRecord || !state.user) return;
  queueMicrotask(async () => {
    try { await refreshTimerFromRemote({ refreshData: true }); }
    catch (error) { console.error('타이머 상태 새로고침 실패', error); }
  });
}, true);

document.addEventListener('click', (event) => {
  const modeButton = event.target.closest('[data-timer-mode]');
  const pauseButton = event.target.closest('#timer-pause');
  const action = event.target.closest('#timer-action');
  const cancel = event.target.closest('#timer-cancel');
  if (!modeButton && !pauseButton && !action && !cancel) return;
  event.preventDefault(); event.stopPropagation(); event.stopImmediatePropagation();
  if (modeButton) handleModeChange(modeButton);
  else if (pauseButton) handlePauseToggle(pauseButton);
  else if (action) handleAction(action);
  else handleCancel(cancel);
}, true);

document.addEventListener('change', (event) => {
  const select = event.target.closest('#timer-category');
  if (!select || !state.user) return;
  const nextCategoryId = select.value;
  const timer = state.controller?.active;
  if (timer) {
    handleCountdownCategoryChange(nextCategoryId);
    return;
  }
  state.selectedCategoryId = nextCategoryId;
  if (nextCategoryId) localStorage.setItem(LAST_CATEGORY_KEY, nextCategoryId);
  updatePreviewBaseline();
  renderTimer();
}, true);

document.addEventListener('visibilitychange', () => {
  if (document.hidden) return;
  if (timerTabIsActive()) {
    refreshTimerFromRemote({ refreshData: true }).catch((error) => {
      console.error('화면 복귀 후 타이머 복구 실패', error);
      updateDisplay();
    });
    return;
  }
  updateDisplay();
});

function schedulePatch() {
  if (state.patchQueued || !state.user) return;
  state.patchQueued = true;
  queueMicrotask(() => {
    state.patchQueued = false;
    if (timerTabIsActive() && !document.querySelector('#record-view [data-feature-ui="persistent-timer"]')) renderTimer();
  });
}

new MutationObserver(schedulePatch).observe(document.body, { childList: true, subtree: true });
authModule.onAuthStateChanged(auth, async (user) => {
  state.user = user;
  stopDisplay();
  state.recoveryPromise = null;
  state.recoveryUserId = null;
  state.dataPromise = null;
  state.dataUserId = null;
  if (!user) {
    state.controller = null;
    state.runtime = null;
    state.categories = [];
    state.archived = [];
    state.entries = [];
    state.weekly = [];
    state.daily = [];
    state.defaultDayWeights = { ...EQUAL_DAY_WEIGHTS };
    state.selectedMode = 'countdown';
    state.selectedCategoryId = '';
    state.previewBaseline = null;
    state.budgetReady = false;
    return;
  }
  try {
    state.runtime = await getOfflineRuntime({ userId: user.uid, firestore: store, db });
    state.selectedCategoryId = localStorage.getItem(LAST_CATEGORY_KEY) || '';
    await refreshTimerData();
    configureController();
    await refreshTimerFromRemote();
  } catch (error) {
    console.error('타이머 복구 실패', error);
    showToast({ type: 'error', title: '진행 중 타이머를 확인하지 못했습니다.', message: '네트워크와 기기 저장소 상태를 확인하세요.' });
  }
  schedulePatch();
});

document.addEventListener('weekly-time-budget:data-changed', async () => {
  if (!state.user) return;
  try { await refreshTimerData(); }
  catch (error) { console.error('타이머 예산 자료 갱신 실패', error); }
  if (timerTabIsActive()) renderTimer();
  else schedulePatch();
});
