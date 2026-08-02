import { firebaseConfig } from '../firebase-config.js';
import { getWeekRange, toDateKey } from './domain.js';
import { getExistingOfflineRuntime } from './offline-runtime.js';
import {
  buildRecordedPeriodIndex,
  previousRecordedPeriod,
  nextRecordedPeriodOrCurrent,
  coerceRecordedPeriodSelection,
} from './recorded-period-domain.js';

const appModule = await import('https://www.gstatic.com/firebasejs/11.10.0/firebase-app.js');
const authModule = await import('https://www.gstatic.com/firebasejs/11.10.0/firebase-auth.js');
const app = appModule.getApps().length ? appModule.getApp() : appModule.initializeApp(firebaseConfig);
const auth = authModule.getAuth(app);

const emptyIndex = () => ({ dates: [], weekStarts: [], months: [], years: [] });
const state = {
  userId: null,
  periods: emptyIndex(),
  periodsReady: false,
  refreshPromise: null,
  refreshUserId: null,
  refreshSequence: 0,
  patchScheduled: false,
  retryTimer: null,
  warmupTimer: null,
  warmupAttempt: 0,
  applying: false,
};

const todayKey = () => toDateKey(new Date());
const currentWeekStart = () => getWeekRange(new Date(`${todayKey()}T12:00:00`)).start;
const dateFromText = (value = '') => String(value).match(/\d{4}-\d{2}-\d{2}/)?.[0] || null;

function cachedRemoteEntries(snapshot = {}) {
  if (Array.isArray(snapshot?.entries)) return snapshot.entries;
  if (Array.isArray(snapshot?.statisticsData?.entries)) return snapshot.statisticsData.entries;
  return [];
}

function mergedUiState(partial = {}) {
  const current = globalThis.window?.__weeklyTimeBudgetUiState || {};
  const merged = {
    ...current,
    ...partial,
    dashboard: { ...(current.dashboard || {}), ...(partial.dashboard || {}) },
  };
  if (globalThis.window) globalThis.window.__weeklyTimeBudgetUiState = merged;
  return merged;
}

function applyUiState(partial) {
  if (state.applying) return;
  state.applying = true;
  const detail = mergedUiState(partial);
  document.dispatchEvent(new CustomEvent('weekly-time-budget:save-ui-state', { detail: partial }));
  document.dispatchEvent(new CustomEvent('weekly-time-budget:ui-state-restored', { detail }));
  queueMicrotask(() => {
    state.applying = false;
    schedulePatch();
  });
}

function applyDashboardWeek(weekStart) {
  if (!weekStart) return;
  applyUiState({
    dashboard: {
      mode: 'weekly',
      selectedWeekStart: weekStart,
    },
  });
}

function buttonTarget(button, target) {
  if (!button) return;
  const disabled = !target;
  button.disabled = disabled;
  button.setAttribute('aria-disabled', disabled ? 'true' : 'false');
  if (target) button.dataset.recordedPeriodTarget = target;
  else delete button.dataset.recordedPeriodTarget;
}

function setControlEnabled(control, enabled) {
  if (!control) return;
  control.disabled = !enabled;
  control.setAttribute('aria-disabled', enabled ? 'false' : 'true');
}

function blockUntilPeriodsReady(event) {
  if (state.periodsReady) return false;
  event.preventDefault();
  event.stopImmediatePropagation();
  return true;
}

function dashboardWeekModel() {
  const root = document.querySelector('#dashboard-view [data-feature-ui="dashboard"]');
  if (!root || !root.querySelector('[data-dashboard-mode="weekly"].active')) return null;
  const selected = dateFromText(root.querySelector('.period-navigation strong')?.textContent);
  if (!selected) return null;
  const current = currentWeekStart();
  const normalized = coerceRecordedPeriodSelection({
    selected,
    current,
    recordedPeriods: state.periods.weekStarts,
  });
  return {
    root,
    selected,
    normalized,
    previousWeekStart: previousRecordedPeriod(state.periods.weekStarts, normalized),
    nextWeekStart: nextRecordedPeriodOrCurrent(state.periods.weekStarts, normalized, current),
  };
}

function patchDashboard() {
  if (!state.periodsReady) return;
  const model = dashboardWeekModel();
  if (!model) return;
  if (model.normalized !== model.selected) {
    applyDashboardWeek(model.normalized);
    return;
  }
  buttonTarget(model.root.querySelector('[data-week-direction="prev"]'), model.previousWeekStart);
  buttonTarget(model.root.querySelector('[data-week-direction="next"]'), model.nextWeekStart);
}

function patchAll() {
  state.patchScheduled = false;
  if (!state.periodsReady) {
    document.querySelectorAll('#dashboard-view [data-week-direction]')
      .forEach((control) => setControlEnabled(control, false));
    return;
  }
  patchDashboard();
}

function schedulePatch() {
  if (state.patchScheduled) return;
  state.patchScheduled = true;
  queueMicrotask(patchAll);
}

function scheduleWarmupRefresh(userId) {
  if (!userId || state.warmupAttempt >= 3) return;
  const delays = [300, 900, 1800];
  const delay = delays[state.warmupAttempt];
  state.warmupAttempt += 1;
  clearTimeout(state.warmupTimer);
  state.warmupTimer = setTimeout(() => {
    if (auth.currentUser?.uid === userId) refreshPeriods();
  }, delay);
}

async function refreshPeriods() {
  const user = auth.currentUser;
  if (!user) {
    state.userId = null;
    state.periods = emptyIndex();
    state.periodsReady = false;
    schedulePatch();
    return;
  }

  const userId = user.uid;
  if (state.refreshPromise && state.refreshUserId === userId) return state.refreshPromise;
  const sequence = ++state.refreshSequence;
  const promise = (async () => {
    const runtime = getExistingOfflineRuntime(userId);
    if (!runtime) {
      clearTimeout(state.retryTimer);
      state.retryTimer = setTimeout(() => {
        if (auth.currentUser?.uid === userId) refreshPeriods();
      }, 150);
      return;
    }
    const snapshot = await runtime.store.getSnapshot(userId);
    const remoteEntries = cachedRemoteEntries(snapshot);
    const entries = await runtime.mergedEntries(remoteEntries);
    if (auth.currentUser?.uid !== userId || sequence !== state.refreshSequence) return;
    state.userId = userId;
    state.periods = buildRecordedPeriodIndex(entries, todayKey());
    state.periodsReady = true;
    schedulePatch();
    scheduleWarmupRefresh(userId);
  })();

  state.refreshPromise = promise;
  state.refreshUserId = userId;
  try {
    await promise;
  } finally {
    if (state.refreshPromise === promise) {
      state.refreshPromise = null;
      state.refreshUserId = null;
    }
  }
}

function dashboardClick(event) {
  const button = event.target.closest?.('#dashboard-view [data-week-direction]');
  if (!button) return false;
  if (blockUntilPeriodsReady(event)) return true;
  const model = dashboardWeekModel();
  if (!model) return false;
  event.preventDefault();
  event.stopImmediatePropagation();
  const target = button.dataset.weekDirection === 'prev'
    ? model.previousWeekStart
    : model.nextWeekStart;
  if (target) applyDashboardWeek(target);
  return true;
}

document.addEventListener('click', (event) => {
  dashboardClick(event);
}, true);

for (const eventName of [
  'weekly-time-budget:entries-changed',
  'weekly-time-budget:data-changed',
  'weekly-time-budget:sync-result',
]) {
  document.addEventListener(eventName, () => refreshPeriods());
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') refreshPeriods();
});
window.addEventListener('online', () => refreshPeriods());

const observer = new MutationObserver(schedulePatch);
observer.observe(document.body, { childList: true, subtree: true });

authModule.onAuthStateChanged(auth, (user) => {
  clearTimeout(state.retryTimer);
  clearTimeout(state.warmupTimer);
  state.refreshSequence += 1;
  state.refreshPromise = null;
  state.refreshUserId = null;
  state.warmupAttempt = 0;
  state.userId = user?.uid || null;
  state.periods = emptyIndex();
  state.periodsReady = false;
  refreshPeriods();
});

schedulePatch();
