import { firebaseConfig } from '../firebase-config.js';
import { createPersistentTimerController, localDateKey } from './persistent-timer.js';
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
  controller: null,
  runtime: null,
  interval: null,
  patchQueued: false,
};
const escapeHtml = (value = '') => String(value).replace(/[&<>'"]/g, (char) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;',
}[char]));

function storageKey(uid) { return `weekly-time-budget:active-timer:${uid}`; }

async function loadCategories() {
  if (!state.user || !state.runtime) return;
  const cached = await state.runtime.store.getSnapshot(state.user.uid);
  if (Array.isArray(cached?.categories)) state.categories = cached.categories;
  if (Array.isArray(cached?.archivedCategories)) state.archived = cached.archivedCategories;

  const root = ['users', state.user.uid];
  try {
    const [active, archived] = await Promise.all([
      store.getDocs(store.query(store.collection(db, ...root, 'categories'), store.orderBy('order'))),
      store.getDocs(store.collection(db, ...root, 'archivedCategories')),
    ]);
    state.categories = active.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
    state.archived = archived.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
    await state.runtime.store.patchSnapshot(state.user.uid, {
      categories: state.categories,
      archivedCategories: state.archived,
      updatedAt: Date.now(),
    });
  } catch (error) {
    if (!state.categories.length) throw error;
    console.warn('오프라인 대분류 스냅숏 사용', error);
  }
}

function dispatchEntryChange() {
  document.dispatchEvent(new CustomEvent('weekly-time-budget:entries-changed', {
    detail: { userId: state.user.uid },
  }));
  document.dispatchEvent(new CustomEvent('weekly-time-budget:data-changed'));
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
      async remove() {
        await store.deleteDoc(activeRef);
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

function formatClock(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return [h, m, s].map((value) => String(value).padStart(2, '0')).join(':');
}

function timerTabIsActive() {
  return Boolean(document.querySelector('#record-view [data-record-tab="timer"].active'));
}

function renderTimer() {
  const view = document.querySelector('#record-view');
  if (!view || !timerTabIsActive() || !state.controller) return;
  const card = view.querySelector('.card');
  if (!card) return;
  const timer = state.controller.active;
  const selectedId = timer?.categoryId || localStorage.getItem(LAST_CATEGORY_KEY) || '';
  card.innerHTML = `<div data-feature-ui="persistent-timer">
    <div class="form-grid">
      <label>대분류<select id="timer-category" ${timer ? 'disabled' : ''}><option value="">선택하세요</option>${categoryOptions(selectedId)}</select></label>
      <label>메모(선택)<textarea id="timer-note" rows="2" ${timer ? 'disabled' : ''}>${escapeHtml(timer?.note || '')}</textarea></label>
    </div>
    <div id="timer-display" class="timer" aria-live="polite">${formatClock(state.controller.elapsedSeconds())}</div>
    <div class="actions"><button id="timer-action" class="primary-button">${timer ? '종료하고 저장' : '타이머 시작'}</button>${timer ? '<button id="timer-cancel" class="secondary-button">취소</button>' : ''}</div>
  </div>`;
  startDisplay();
}

function startDisplay() {
  stopDisplay();
  if (!state.controller?.active) return;
  updateDisplay();
  state.interval = setInterval(updateDisplay, 1000);
}

function stopDisplay() {
  if (state.interval) clearInterval(state.interval);
  state.interval = null;
}

function updateDisplay() {
  const display = document.querySelector('#timer-display');
  if (display && state.controller?.active) display.textContent = formatClock(state.controller.elapsedSeconds());
}

async function handleAction(button) {
  if (!state.controller || button.disabled) return;
  button.disabled = true;
  try {
    const active = state.controller.active;
    if (!active) {
      const categoryId = document.querySelector('#timer-category')?.value;
      if (!categoryId) return alert('대분류를 선택하세요.');
      localStorage.setItem(LAST_CATEGORY_KEY, categoryId);
      const result = await state.controller.start({
        userId: state.user.uid,
        categoryId,
        note: document.querySelector('#timer-note')?.value || '',
        startedDate: localDateKey(new Date()),
      });
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

    const result = await state.controller.stop((timer, { endedAt, durationMinutes }) => ({
      categoryId: timer.categoryId,
      note: timer.note,
      date: timer.startedDate,
      durationMinutes,
      startTime: new Date(timer.startedAt).toTimeString().slice(0, 5),
      endTime: new Date(endedAt).toTimeString().slice(0, 5),
      source: 'timer',
    }));
    stopDisplay();
    renderTimer();
    showEntrySaveResult(result.completion);
    dispatchEntryChange();
  } catch (error) {
    console.error(error);
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

async function handleCancel(button) {
  if (!confirm('진행 중인 타이머를 취소할까요? 기록은 저장되지 않습니다.')) return;
  button.disabled = true;
  try {
    await state.controller.cancel();
    stopDisplay();
    renderTimer();
  } catch (error) {
    showToast({ type: 'error', title: '타이머를 취소하지 못했습니다.', message: '인터넷 연결 후 다시 시도하세요.' });
  } finally {
    if (button.isConnected) button.disabled = false;
  }
}

document.addEventListener('click', (event) => {
  const opensRecord = event.target.closest('.nav-button[data-view="record"], [data-record-tab="timer"]');
  if (!opensRecord || !state.user) return;
  queueMicrotask(async () => {
    try { await loadCategories(); schedulePatch(); }
    catch (error) { console.error('타이머 대분류 새로고침 실패', error); }
  });
}, true);

document.addEventListener('click', (event) => {
  const action = event.target.closest('#timer-action');
  const cancel = event.target.closest('#timer-cancel');
  if (!action && !cancel) return;
  event.preventDefault(); event.stopPropagation(); event.stopImmediatePropagation();
  if (action) handleAction(action); else handleCancel(cancel);
}, true);

document.addEventListener('visibilitychange', () => { if (!document.hidden) updateDisplay(); });

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
  if (!user) {
    state.controller = null;
    state.runtime = null;
    state.categories = [];
    state.archived = [];
    return;
  }
  try {
    state.runtime = await getOfflineRuntime({ userId: user.uid, firestore: store, db });
    await loadCategories();
    configureController();
    await state.controller.recover();
  } catch (error) {
    console.error('타이머 복구 실패', error);
    showToast({ type: 'error', title: '진행 중 타이머를 확인하지 못했습니다.', message: '네트워크와 기기 저장소 상태를 확인하세요.' });
  }
  schedulePatch();
});

document.addEventListener('weekly-time-budget:data-changed', async () => {
  if (!state.user) return;
  await loadCategories();
  schedulePatch();
});
