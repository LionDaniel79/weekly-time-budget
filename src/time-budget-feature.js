import { getWeekRange, toDateKey } from './domain.js';
import {
  buildPreviousWeekBudgetDefaults,
  buildWeeklyBudgetSnapshot,
  parseOptionalDailyHours,
  previousSameWeekdayMinutes,
  previousRecordedDate,
  nextRecordedDateOrToday,
  recordedDateKeys,
  summarizeDailyCategories,
  summarizeWeeklyEffectiveCategories,
} from './time-budget-domain.js';
import {
  bindDashboardControls,
  bindTimeBudgetControls,
  createDashboardUiState,
  createTimeBudgetUiState,
  renderDashboardHtml,
  renderTimeBudgetHtml,
} from './time-budget-ui.js';
import { showOfflineNotice, showToast } from './app-toast.js';
import { filterCategoriesActiveOnDate, isArchivedCategoryVisibleInRange, isCategoryActiveInRange } from './category-effective-date.js';
import {
  buildRecordedPeriodIndex,
  previousRecordedPeriod,
  nextRecordedPeriodOrCurrent,
  coerceRecordedPeriodSelection,
} from './recorded-period-domain.js';

const today = () => toDateKey(new Date());
const currentWeekStart = () => getWeekRange().start;
const state = {
  user: null,
  runtime: null,
  dataSource: null,
  categories: [], archived: [], entries: [], remoteEntries: [], weekly: [], daily: [],
  dashboard: createDashboardUiState(today(), currentWeekStart()),
  budget: createTimeBudgetUiState(today()),
  loading: false,
  cacheLoaded: false,
  activeView: 'dashboard',
};
let loadingPromise = null;
let reloadRequested = false;

const activeCategories = (date = today()) => filterCategoriesActiveOnDate(state.categories, date);

function saveFeatureUiState(partial = {}) {
  document.dispatchEvent(new CustomEvent('weekly-time-budget:save-ui-state', { detail: partial }));
}

function applyRestoredUiState(saved = {}) {
  if (saved.dashboard) Object.assign(state.dashboard, saved.dashboard);
  if (saved.budget) Object.assign(state.budget, saved.budget);
  const now = today();
  const week = currentWeekStart();
  state.dashboard.today = now;
  state.dashboard.currentWeekStart = week;
  state.budget.today = now;
  if (state.dashboard.selectedDate > now) state.dashboard.selectedDate = now;
  if (state.dashboard.selectedWeekStart > week) state.dashboard.selectedWeekStart = week;
}

if (globalThis.window?.__weeklyTimeBudgetUiState) {
  applyRestoredUiState(globalThis.window.__weeklyTimeBudgetUiState);
}

document.addEventListener('weekly-time-budget:ui-state-restored', (event) => {
  applyRestoredUiState(event.detail || {});
  renderActiveView();
});

function allKnownCategories() {
  const map = new Map();
  state.archived.forEach((item) => map.set(item.id, item));
  state.categories.forEach((item) => map.set(item.id, item));
  return [...map.values()].sort((a, b) => Number(a.order || 9999) - Number(b.order || 9999));
}

const findWeekDocument = (weekStart) => state.weekly.find((week) => (week.weekStart || week.id) === weekStart) || null;
const weeklyDefaults = (weekStart) => buildPreviousWeekBudgetDefaults({
  categories: activeCategories(weekStart),
  entries: state.entries,
  weekStart,
});

function normalizeWeek(weekStart) {
  const source = findWeekDocument(weekStart);
  const defaults = weekStart === currentWeekStart() ? weeklyDefaults(weekStart) : {};
  const budgets = { ...defaults, ...(source?.budgets || {}) };
  return {
    id: source?.id || weekStart,
    weekStart,
    budgets,
    explicitBudgetIds: Array.isArray(source?.explicitBudgetIds)
      ? [...source.explicitBudgetIds]
      : Object.keys(source?.budgets || {}),
  };
}

const dailyFor = (date) => state.daily.find((item) => (item.date || item.id) === date) || null;
const weekRange = (key) => getWeekRange(new Date(`${key}T12:00:00`));
const weekLabel = (key) => { const range = weekRange(key); return `${range.start} — ${range.end}`; };

function dailyDefaults(date) {
  return Object.fromEntries(activeCategories(date).map((category) => [
    category.id,
    previousSameWeekdayMinutes(state.entries, category.id, date),
  ]));
}

function periodCategories({ start, end, weekDocument, dailyDocument = null }) {
  const activeIds = new Set(state.categories.map((category) => category.id));
  const knownIds = new Set(allKnownCategories().map((category) => category.id));
  const budgetIds = new Set(Object.keys(weekDocument?.budgets || {}).filter((id) => knownIds.has(id)));
  const overrideIds = new Set(Object.keys(dailyDocument?.overrides || {}).filter((id) => knownIds.has(id)));
  const entryIds = new Set(state.entries
    .filter((entry) => entry.date >= start && entry.date <= end && knownIds.has(entry.categoryId))
    .map((entry) => entry.categoryId));
  return allKnownCategories()
    .filter((category) => isCategoryActiveInRange(category, start, end))
    .filter((category) => activeIds.has(category.id) || isArchivedCategoryVisibleInRange(category, start, end))
    .filter((category) => activeIds.has(category.id) || budgetIds.has(category.id) || overrideIds.has(category.id) || entryIds.has(category.id))
    .map((category) => activeIds.has(category.id) ? category : { ...category, defaultBudgetMinutes: 0, budgetMinutes: 0 });
}

function shouldInitializeFromPreviousResults(source) {
  if (!source) return true;
  if (source.initializedFromPreviousResults) return false;
  const explicitBudgetIds = Array.isArray(source.explicitBudgetIds)
    ? source.explicitBudgetIds
    : Object.keys(source.budgets || {});
  return explicitBudgetIds.length === 0;
}

async function ensureCurrentWeekSnapshot() {
  const weekStart = currentWeekStart();
  const source = findWeekDocument(weekStart);
  if (!shouldInitializeFromPreviousResults(source)) return;
  const categories = activeCategories(today());
  const budgets = buildPreviousWeekBudgetDefaults({ categories, entries: state.entries, weekStart });
  const snapshot = {
    id: source?.id || weekStart,
    weekStart,
    budgets,
    explicitBudgetIds: [],
    initializedFromPreviousResults: true,
  };
  await state.dataSource.ensureCurrentWeekBudget(state.user.uid, snapshot);
  const index = state.weekly.findIndex((week) => (week.weekStart || week.id) === weekStart);
  if (index >= 0) state.weekly[index] = snapshot;
  else state.weekly.push(snapshot);
}

async function applyCachedData() {
  if (!state.runtime || state.cacheLoaded) return false;
  const snapshot = await state.runtime.store.getSnapshot(state.user.uid);
  state.cacheLoaded = true;
  if (!snapshot) return false;
  if (Array.isArray(snapshot.weeklyBudgets)) state.weekly = snapshot.weeklyBudgets;
  if (Array.isArray(snapshot.dailyBudgets)) state.daily = snapshot.dailyBudgets;
  applyRestoredUiState(globalThis.window?.__weeklyTimeBudgetUiState || {});
  return true;
}

async function performLoadData() {
  state.loading = true;
  const hadCache = await applyCachedData();
  try {
    const result = await state.dataSource.loadTimeBudgetData(state.user.uid);
    state.weekly = result.weeklyBudgets;
    state.daily = result.dailyBudgets;
    await ensureCurrentWeekSnapshot();
    await state.runtime.store.patchSnapshot(state.user.uid, {
      weeklyBudgets: state.weekly,
      dailyBudgets: state.daily,
      updatedAt: Date.now(),
    });
  } catch (error) {
    if (!hadCache && !state.weekly.length && !state.daily.length) throw error;
    console.warn('대시보드 오프라인 스냅숏 사용', error);
    showOfflineNotice();
  } finally {
    const now = today();
    const week = currentWeekStart();
    state.dashboard.today = now;
    state.dashboard.currentWeekStart = week;
    state.budget.today = now;
    if (state.dashboard.selectedDate > now) state.dashboard.selectedDate = now;
    if (state.dashboard.selectedWeekStart > week) state.dashboard.selectedWeekStart = week;
    state.loading = false;
  }
}

async function loadData() {
  if (!state.user || !state.runtime || !state.dataSource) return;
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

function weeklySummary(key) {
  const range = weekRange(key);
  const week = normalizeWeek(key);
  const categories = periodCategories({ start: range.start, end: range.end, weekDocument: week });
  return summarizeWeeklyEffectiveCategories({
    categories,
    entries: state.entries,
    weekStart: key,
    weekDocument: week,
    dailyDocuments: state.daily,
  });
}

function dashboardRecordedWeekModel() {
  const current = state.dashboard.currentWeekStart;
  const periods = buildRecordedPeriodIndex(state.entries, state.dashboard.today);
  const selected = coerceRecordedPeriodSelection({
    selected: state.dashboard.selectedWeekStart,
    current,
    recordedPeriods: periods.weekStarts,
  });
  return {
    selected,
    previousWeekStart: previousRecordedPeriod(periods.weekStarts, selected),
    nextWeekStart: nextRecordedPeriodOrCurrent(periods.weekStarts, selected, current),
  };
}

function renderDashboard() {
  const root = document.querySelector('#dashboard-view');
  if (!root || !state.user) return;
  const dates = recordedDateKeys(state.entries, state.dashboard.today);
  if (state.dashboard.mode === 'weekly') {
    const recordedWeek = dashboardRecordedWeekModel();
    if (recordedWeek.selected !== state.dashboard.selectedWeekStart) {
      state.dashboard.selectedWeekStart = recordedWeek.selected;
      saveFeatureUiState({ dashboard: { ...state.dashboard } });
    }
    root.innerHTML = `<div data-feature-ui="dashboard">${renderDashboardHtml({
      mode: 'weekly',
      selectedWeekStart: recordedWeek.selected,
      currentWeekStart: state.dashboard.currentWeekStart,
      previousWeekStart: recordedWeek.previousWeekStart,
      nextWeekStart: recordedWeek.nextWeekStart,
      weekRangeLabel: weekLabel(recordedWeek.selected),
      weeklySummary: weeklySummary(recordedWeek.selected),
    })}</div>`;
  } else {
    const date = state.dashboard.selectedDate;
    const weekKey = getWeekRange(new Date(`${date}T12:00:00`)).start;
    const week = normalizeWeek(weekKey);
    const dailyDocument = dailyFor(date);
    root.innerHTML = `<div data-feature-ui="dashboard">${renderDashboardHtml({
      mode: 'daily', selectedDate: date, today: state.dashboard.today,
      previousDate: previousRecordedDate(dates, date),
      calendarYear: state.dashboard.calendarYear,
      calendarMonth: state.dashboard.calendarMonth,
      recordDates: dates,
      dailySummary: summarizeDailyCategories({
        categories: periodCategories({ start: date, end: date, weekDocument: week, dailyDocument }),
        entries: state.entries, date, weekDocument: week, dailyDocument,
      }),
    })}</div>`;
  }
  bindDashboardControls({
    root,
    state: state.dashboard,
    rerender: () => {
      saveFeatureUiState({ dashboard: { ...state.dashboard } });
      renderDashboard(); updateHeader('dashboard');
    },
    onPreviousDate: () => {
      const value = previousRecordedDate(dates, state.dashboard.selectedDate);
      if (value) selectDate(value);
    },
    onNextDate: () => {
      const value = nextRecordedDateOrToday(dates, state.dashboard.selectedDate, state.dashboard.today);
      if (value) selectDate(value);
    },
    onSelectDate: selectDate,
    onCalendarMove: moveCalendar,
    onWeekMove: (direction) => {
      const recordedWeek = dashboardRecordedWeekModel();
      const next = direction === 'prev'
        ? recordedWeek.previousWeekStart
        : recordedWeek.nextWeekStart;
      if (!next) return;
      state.dashboard.selectedWeekStart = next;
      saveFeatureUiState({ dashboard: { ...state.dashboard } });
      renderDashboard(); updateHeader('dashboard');
    },
  });
}

function selectDate(value) {
  if (!value || value > state.dashboard.today) return;
  state.dashboard.selectedDate = value;
  const date = new Date(`${value}T12:00:00`);
  state.dashboard.calendarYear = date.getFullYear();
  state.dashboard.calendarMonth = date.getMonth() + 1;
  saveFeatureUiState({ dashboard: { ...state.dashboard } });
  renderDashboard(); updateHeader('dashboard');
}

function moveCalendar(direction) {
  let year = state.dashboard.calendarYear;
  let month = state.dashboard.calendarMonth + (direction === 'prev' ? -1 : 1);
  if (month < 1) { year -= 1; month = 12; }
  if (month > 12) { year += 1; month = 1; }
  if (`${year}-${String(month).padStart(2, '0')}` > state.dashboard.today.slice(0, 7)) return;
  state.dashboard.calendarYear = year;
  state.dashboard.calendarMonth = month;
  saveFeatureUiState({ dashboard: { ...state.dashboard } });
  renderDashboard();
}

function renderBudget() {
  const root = document.querySelector('#budget-view');
  if (!root || !state.user) return;
  const weekStart = currentWeekStart();
  root.innerHTML = `<div data-feature-ui="budget">${renderTimeBudgetHtml({
    mode: state.budget.mode,
    today: state.budget.today,
    categories: activeCategories(state.budget.today),
    weekDocument: normalizeWeek(weekStart),
    weeklyDefaults: weeklyDefaults(weekStart),
    dailyDocument: dailyFor(state.budget.today),
    dailyDefaults: dailyDefaults(state.budget.today),
    emptyHtml: document.querySelector('#empty-template')?.innerHTML || '',
  })}</div>`;
  bindTimeBudgetControls({
    root,
    state: state.budget,
    rerender: () => {
      saveFeatureUiState({ budget: { ...state.budget } });
      renderBudget(); updateHeader('budget');
    },
    onSaveDaily: saveDaily,
    onSaveWeekly: saveWeekly,
  });
}

async function saveDaily(inputs) {
  const date = today();
  const currentCategories = activeCategories(date);
  const activeIds = new Set(currentCategories.map((category) => category.id));
  const preservedOverrides = Object.fromEntries(
    Object.entries(dailyFor(date)?.overrides || {}).filter(([categoryId]) => !activeIds.has(categoryId)),
  );
  const overrides = { ...preservedOverrides };
  for (const category of currentCategories) {
    const parsed = parseOptionalDailyHours(inputs[category.id]);
    if (parsed.explicit) overrides[category.id] = parsed.minutes;
  }
  try { await state.dataSource.saveDailyBudget(state.user.uid, date, overrides); }
  catch (error) {
    showToast({ type: 'error', title: '오늘 시간 예산을 저장하지 못했습니다.', message: '예산 변경은 인터넷 연결 후 다시 시도하세요.' });
    throw error;
  }
  await loadData(); renderBudget(); renderDashboard();
  document.dispatchEvent(new CustomEvent('weekly-time-budget:data-changed'));
  alert('오늘 시간 예산을 저장했습니다.');
}

async function saveWeekly({ budgetInputs }) {
  const weekStart = currentWeekStart();
  const existing = normalizeWeek(weekStart);
  const currentCategories = activeCategories(today());
  const activeIds = new Set(currentCategories.map((category) => category.id));
  const preservedBudgets = Object.fromEntries(
    Object.entries(existing.budgets || {}).filter(([categoryId]) => !activeIds.has(categoryId)),
  );
  const preservedExplicitBudgetIds = (existing.explicitBudgetIds || [])
    .filter((categoryId) => !activeIds.has(categoryId));
  const snapshot = buildWeeklyBudgetSnapshot({
    weekStart,
    categories: currentCategories,
    budgetInputs,
    defaultBudgets: weeklyDefaults(weekStart),
  });
  snapshot.budgets = { ...preservedBudgets, ...snapshot.budgets };
  snapshot.explicitBudgetIds = [...new Set([...preservedExplicitBudgetIds, ...snapshot.explicitBudgetIds])];
  snapshot.initializedFromPreviousResults = true;
  try { await state.dataSource.saveWeeklyBudget(state.user.uid, snapshot); }
  catch (error) {
    showToast({ type: 'error', title: '이번 주 시간 예산을 저장하지 못했습니다.', message: '예산 변경은 인터넷 연결 후 다시 시도하세요.' });
    throw error;
  }
  await loadData(); renderBudget(); renderDashboard();
  document.dispatchEvent(new CustomEvent('weekly-time-budget:data-changed'));
  alert('이번 주 시간 예산을 저장했습니다.');
}

function updateHeader(view) {
  if (view === 'dashboard') {
    document.querySelector('#page-title').textContent = '대시보드';
    document.querySelector('#week-label').textContent = state.dashboard.mode === 'daily'
      ? `${state.dashboard.selectedDate} · 일간 현황`
      : `${weekLabel(state.dashboard.selectedWeekStart)} · 주간 현황`;
  } else if (view === 'budget') {
    document.querySelector('#page-title').textContent = '시간 예산';
    document.querySelector('#week-label').textContent = state.budget.mode === 'today'
      ? `${state.budget.today} · 오늘 시간 예산`
      : `${weekLabel(currentWeekStart())} · 이번 주 시간 예산`;
  }
}

function renderActiveView() {
  if (!state.user) return;
  if (state.activeView === 'dashboard') { renderDashboard(); updateHeader('dashboard'); }
  if (state.activeView === 'budget') { renderBudget(); updateHeader('budget'); }
}

document.addEventListener('weekly-time-budget:infrastructure-state', async (event) => {
  const detail = event.detail || {};
  const previousUid = state.user?.uid;
  state.user = detail.user || null;
  state.runtime = detail.offlineRuntime || null;
  state.dataSource = detail.dataSource || null;
  state.categories = Array.isArray(detail.categories) ? detail.categories : [];
  state.archived = Array.isArray(detail.archivedCategories) ? detail.archivedCategories : [];
  state.entries = Array.isArray(detail.entries) ? detail.entries : [];
  state.remoteEntries = Array.isArray(detail.remoteEntries) ? detail.remoteEntries : [];
  if (!state.user) {
    state.weekly = [];
    state.daily = [];
    state.cacheLoaded = false;
    loadingPromise = null;
    reloadRequested = false;
    return;
  }
  if (previousUid !== state.user.uid) state.cacheLoaded = false;
  try { await loadData(); } catch (error) { console.error('시간 예산 데이터를 불러오지 못했습니다.', error); }
  renderActiveView();
});

document.addEventListener('weekly-time-budget:view-changed', async (event) => {
  state.activeView = event.detail?.view || state.activeView;
  if (!['dashboard', 'budget'].includes(state.activeView) || !state.user) return;
  try { await loadData(); } catch { /* cached data remains */ }
  renderActiveView();
});

document.addEventListener('weekly-time-budget:entries-changed', async (event) => {
  if (!state.user || event.detail?.userId && event.detail.userId !== state.user.uid) return;
  if (Array.isArray(event.detail?.entries)) state.entries = event.detail.entries;
  else if (state.runtime) state.entries = await state.runtime.mergedEntries(state.remoteEntries);
  if (state.activeView === 'dashboard') renderDashboard();
  if (state.activeView === 'budget') renderBudget();
});

document.addEventListener('weekly-time-budget:data-changed', async () => {
  if (!state.user) return;
  try { await loadData(); } catch { /* cached data remains */ }
  renderActiveView();
});