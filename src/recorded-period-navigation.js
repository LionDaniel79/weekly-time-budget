import { firebaseConfig } from '../firebase-config.js';
import { getWeekRange, toDateKey } from './domain.js';
import { getExistingOfflineRuntime } from './offline-runtime.js';
import {
  buildRecordedPeriodIndex,
  previousRecordedPeriod,
  nextRecordedPeriodOrCurrent,
  coerceRecordedPeriodSelection,
  monthOptionStates,
  recordedYearOptions,
  defaultMonthForYear,
  coerceMonthlySelection,
} from './recorded-period-domain.js';

const appModule = await import('https://www.gstatic.com/firebasejs/11.10.0/firebase-app.js');
const authModule = await import('https://www.gstatic.com/firebasejs/11.10.0/firebase-auth.js');
const app = appModule.getApps().length ? appModule.getApp() : appModule.initializeApp(firebaseConfig);
const auth = authModule.getAuth(app);

const emptyIndex = () => ({ dates: [], weekStarts: [], months: [], years: [] });
const state = {
  userId: null,
  periods: emptyIndex(),
  refreshPromise: null,
  patchScheduled: false,
  retryTimer: null,
  applying: false,
};

const todayKey = () => toDateKey(new Date());
const currentWeekStart = () => getWeekRange(new Date(`${todayKey()}T12:00:00`)).start;
const dateFromText = (value = '') => String(value).match(/\d{4}-\d{2}-\d{2}/)?.[0] || null;

function mergedUiState(partial = {}) {
  const current = globalThis.window?.__weeklyTimeBudgetUiState || {};
  const merged = {
    ...current,
    ...partial,
    dashboard: { ...(current.dashboard || {}), ...(partial.dashboard || {}) },
    statistics: { ...(current.statistics || {}), ...(partial.statistics || {}) },
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

function applyStatisticsState(statistics) {
  applyUiState({
    activeView: 'statistics',
    statistics,
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
  const today = todayKey();
  const todayButton = document.querySelector(`#dashboard-view [data-dashboard-date="${today}"]`);
  if (todayButton) {
    todayButton.disabled = false;
    todayButton.setAttribute('aria-disabled', 'false');
  }

  const model = dashboardWeekModel();
  if (!model) return;
  if (model.normalized !== model.selected) {
    applyDashboardWeek(model.normalized);
    return;
  }
  buttonTarget(model.root.querySelector('[data-week-direction="prev"]'), model.previousWeekStart);
  buttonTarget(model.root.querySelector('[data-week-direction="next"]'), model.nextWeekStart);
}

function statisticsWeekModel() {
  const view = document.querySelector('#statistics-view');
  if (!view || view.classList.contains('hidden')) return null;
  if (!view.querySelector('[data-rescue-stat-mode="weekly"].active')) return null;
  const selected = dateFromText(view.querySelector('.week-range')?.textContent);
  if (!selected) return null;
  const current = currentWeekStart();
  const normalized = coerceRecordedPeriodSelection({
    selected,
    current,
    recordedPeriods: state.periods.weekStarts,
  });
  return {
    view,
    selected,
    normalized,
    previousWeekStart: previousRecordedPeriod(state.periods.weekStarts, normalized),
    nextWeekStart: nextRecordedPeriodOrCurrent(state.periods.weekStarts, normalized, current),
  };
}

function patchZeroAchievement(view) {
  const cards = [...view.querySelectorAll('.statistics-summary > .card')];
  if (cards.length < 3) return;
  const budget = cards[0].querySelector('.metric')?.textContent?.trim();
  const actual = cards[1].querySelector('.metric')?.textContent?.trim();
  const achievement = cards[2].querySelector('.metric');
  if (achievement && budget === '0분' && actual === '0분') achievement.textContent = '—';
}

function optionMarkup(option, selectedMonth) {
  const disabled = option.enabled ? '' : ' disabled aria-disabled="true" class="is-unavailable"';
  const selected = option.month === selectedMonth ? ' selected' : '';
  const label = `${option.month}월${option.current ? ' · 이번 달' : ''}`;
  return `<option value="${option.month}"${selected}${disabled}>${label}</option>`;
}

function replaceSelectOptions(select, html, selectedValue) {
  if (!select) return;
  if (select.innerHTML !== html) select.innerHTML = html;
  select.value = String(selectedValue);
}

function patchMonthlyStatistics(view) {
  if (!view.querySelector('[data-rescue-stat-mode="monthly"].active')) return;
  const yearSelect = view.querySelector('#statistics-rescue-year');
  const monthSelect = view.querySelector('#statistics-rescue-month');
  if (!yearSelect || !monthSelect) return;

  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth() + 1;
  const normalized = coerceMonthlySelection({
    year: Number(yearSelect.value),
    month: Number(monthSelect.value),
    currentYear,
    currentMonth,
    recordedMonths: state.periods.months,
  });

  if (normalized.year !== Number(yearSelect.value) || normalized.month !== Number(monthSelect.value)) {
    applyStatisticsState({ mode: 'monthly', ...normalized });
    return;
  }

  const years = recordedYearOptions(state.periods.years, currentYear);
  const yearHtml = years.map((year) => (
    `<option value="${year}"${year === normalized.year ? ' selected' : ''}>${year}년</option>`
  )).join('');
  replaceSelectOptions(yearSelect, yearHtml, normalized.year);

  const months = monthOptionStates({
    recordedMonths: state.periods.months,
    year: normalized.year,
    currentYear,
    currentMonth,
  });
  replaceSelectOptions(
    monthSelect,
    months.map((option) => optionMarkup(option, normalized.month)).join(''),
    normalized.month,
  );
}

function patchStatistics() {
  const view = document.querySelector('#statistics-view');
  if (!view || view.classList.contains('hidden') || !view.dataset.statisticsRescue) return;

  const weekly = statisticsWeekModel();
  if (weekly) {
    if (weekly.normalized !== weekly.selected) {
      applyStatisticsState({ mode: 'weekly', weekStart: weekly.normalized });
      return;
    }
    buttonTarget(weekly.view.querySelector('[data-rescue-week="-1"]'), weekly.previousWeekStart);
    buttonTarget(weekly.view.querySelector('[data-rescue-week="1"]'), weekly.nextWeekStart);
  }

  patchMonthlyStatistics(view);
  patchZeroAchievement(view);
}

function patchAll() {
  state.patchScheduled = false;
  patchDashboard();
  patchStatistics();
}

function schedulePatch() {
  if (state.patchScheduled) return;
  state.patchScheduled = true;
  queueMicrotask(patchAll);
}

async function refreshPeriods() {
  const user = auth.currentUser;
  if (!user) {
    state.userId = null;
    state.periods = emptyIndex();
    schedulePatch();
    return;
  }
  if (state.refreshPromise) return state.refreshPromise;
  state.refreshPromise = (async () => {
    const runtime = getExistingOfflineRuntime(user.uid);
    if (!runtime) {
      clearTimeout(state.retryTimer);
      state.retryTimer = setTimeout(() => refreshPeriods(), 150);
      return;
    }
    const snapshot = await runtime.store.getSnapshot(user.uid);
    const remoteEntries = Array.isArray(snapshot?.statisticsData?.entries)
      ? snapshot.statisticsData.entries
      : (Array.isArray(snapshot?.entries) ? snapshot.entries : []);
    const entries = await runtime.mergedEntries(remoteEntries);
    if (auth.currentUser?.uid !== user.uid) return;
    state.userId = user.uid;
    state.periods = buildRecordedPeriodIndex(entries, todayKey());
    schedulePatch();
  })();
  try {
    await state.refreshPromise;
  } finally {
    state.refreshPromise = null;
  }
}

function dashboardClick(event) {
  const button = event.target.closest?.('#dashboard-view [data-week-direction]');
  if (!button) return false;
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

function statisticsWeekClick(event) {
  const button = event.target.closest?.('#statistics-view [data-rescue-week]');
  if (!button) return false;
  const model = statisticsWeekModel();
  if (!model) return false;
  event.preventDefault();
  event.stopImmediatePropagation();
  const target = Number(button.dataset.rescueWeek) < 0
    ? model.previousWeekStart
    : model.nextWeekStart;
  if (target) applyStatisticsState({ mode: 'weekly', weekStart: target });
  return true;
}

document.addEventListener('click', (event) => {
  if (dashboardClick(event) || statisticsWeekClick(event)) return;
}, true);

document.addEventListener('change', (event) => {
  const view = document.querySelector('#statistics-view');
  if (!view || view.classList.contains('hidden')) return;
  const monthSelect = view.querySelector('#statistics-rescue-month');
  if (!monthSelect) return;
  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth() + 1;

  if (event.target.matches('#statistics-rescue-year')) {
    event.preventDefault();
    event.stopImmediatePropagation();
    const year = Number(event.target.value);
    const month = defaultMonthForYear({
      year,
      currentYear,
      currentMonth,
      recordedMonths: state.periods.months,
    });
    if (month) applyStatisticsState({ mode: 'monthly', year, month });
    return;
  }

  if (event.target.matches('#statistics-rescue-month')) {
    const option = event.target.selectedOptions?.[0];
    if (!option || option.disabled) {
      event.preventDefault();
      event.stopImmediatePropagation();
      schedulePatch();
      return;
    }
    event.preventDefault();
    event.stopImmediatePropagation();
    applyStatisticsState({
      mode: 'monthly',
      year: Number(view.querySelector('#statistics-rescue-year')?.value),
      month: Number(event.target.value),
    });
  }
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
  state.userId = user?.uid || null;
  state.periods = emptyIndex();
  refreshPeriods();
});

const style = document.createElement('style');
style.textContent = '#statistics-view option.is-unavailable{color:#9aa39f}';
document.head.append(style);
schedulePatch();
