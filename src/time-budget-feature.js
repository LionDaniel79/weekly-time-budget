import { firebaseConfig } from '../firebase-config.js';
import { getWeekRange, moveWeekStart, summarizeCategories, toDateKey } from './domain.js';
import {
  EQUAL_DAY_WEIGHTS,
  buildWeeklyBudgetSnapshot,
  effectiveDayWeights,
  parseOptionalHours,
  previousRecordedDate,
  nextRecordedDateOrToday,
  recordedDateKeys,
  resolveWeeklyBudgetMinutes,
  summarizeDailyCategories,
} from './time-budget-domain.js';
import {
  bindDashboardControls,
  bindTimeBudgetControls,
  createDashboardUiState,
  createTimeBudgetUiState,
  renderDashboardHtml,
  renderTimeBudgetHtml,
} from './time-budget-ui.js';

const appModule = await import('https://www.gstatic.com/firebasejs/11.10.0/firebase-app.js');
const authModule = await import('https://www.gstatic.com/firebasejs/11.10.0/firebase-auth.js');
const store = await import('https://www.gstatic.com/firebasejs/11.10.0/firebase-firestore.js');
const app = appModule.getApps().length ? appModule.getApp() : appModule.initializeApp(firebaseConfig);
const auth = authModule.getAuth(app);
const db = store.getFirestore(app);

const today = () => toDateKey(new Date());
const currentWeekStart = () => getWeekRange().start;
const state = {
  user: null,
  categories: [], archived: [], entries: [], weekly: [], daily: [],
  defaultDayWeights: { ...EQUAL_DAY_WEIGHTS },
  dashboard: createDashboardUiState(today(), currentWeekStart()),
  budget: createTimeBudgetUiState(today()),
  loading: false,
};
let patchQueued = false;
let loadingPromise = null;

const activeCategories = () => state.categories;
const defaultBudget = (category) => Number(category.defaultBudgetMinutes ?? category.budgetMinutes ?? 0) || 0;

function allKnownCategories() {
  const map = new Map();
  state.archived.forEach((item) => map.set(item.id, item));
  state.categories.forEach((item) => map.set(item.id, item));
  state.entries.forEach((entry) => {
    if (!map.has(entry.categoryId)) map.set(entry.categoryId, { id: entry.categoryId, name: '삭제된 대분류', defaultBudgetMinutes: 0, order: 9999 });
  });
  state.weekly.forEach((week) => Object.keys(week.budgets || {}).forEach((id) => {
    if (!map.has(id)) map.set(id, { id, name: '삭제된 대분류', defaultBudgetMinutes: 0, order: 9999 });
  }));
  return [...map.values()].sort((a, b) => Number(a.order || 9999) - Number(b.order || 9999));
}

function normalizeWeek(weekStart) {
  const source = state.weekly.find((week) => (week.weekStart || week.id) === weekStart);
  const budgets = { ...(source?.budgets || {}) };
  state.categories.forEach((category) => {
    if (budgets[category.id] === undefined) budgets[category.id] = defaultBudget(category);
  });
  return {
    id: source?.id || weekStart,
    weekStart,
    budgets,
    explicitBudgetIds: Array.isArray(source?.explicitBudgetIds)
      ? [...source.explicitBudgetIds]
      : Object.keys(source?.budgets || {}),
    dayWeights: effectiveDayWeights(source, state.defaultDayWeights),
  };
}

const dailyFor = (date) => state.daily.find((item) => (item.date || item.id) === date) || null;
const weekRange = (key) => getWeekRange(new Date(`${key}T12:00:00`));
const weekLabel = (key) => { const range = weekRange(key); return `${range.start} — ${range.end}`; };

function periodCategories({ start, end, weekDocument, dailyDocument = null }) {
  const activeIds = new Set(state.categories.map((category) => category.id));
  const budgetIds = new Set(Object.keys(weekDocument?.budgets || {}));
  const overrideIds = new Set(Object.keys(dailyDocument?.overrides || {}));
  const entryIds = new Set(state.entries.filter((entry) => entry.date >= start && entry.date <= end).map((entry) => entry.categoryId));
  return allKnownCategories()
    .filter((category) => activeIds.has(category.id) || budgetIds.has(category.id) || overrideIds.has(category.id) || entryIds.has(category.id))
    .map((category) => activeIds.has(category.id) ? category : { ...category, defaultBudgetMinutes: 0, budgetMinutes: 0 });
}

async function loadData() {
  if (!state.user) return;
  if (loadingPromise) return loadingPromise;
  loadingPromise = (async () => {
    state.loading = true;
    try {
      const root = ['users', state.user.uid];
      const [categories, archived, entries, weekly, daily, settings] = await Promise.all([
        store.getDocs(store.query(store.collection(db, ...root, 'categories'), store.orderBy('order'))),
        store.getDocs(store.collection(db, ...root, 'archivedCategories')),
        store.getDocs(store.query(store.collection(db, ...root, 'entries'), store.orderBy('date', 'desc'))),
        store.getDocs(store.collection(db, ...root, 'weeklyBudgets')),
        store.getDocs(store.collection(db, ...root, 'dailyBudgets')),
        store.getDoc(store.doc(db, ...root, 'settings', 'timeBudget')),
      ]);
      state.categories = categories.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
      state.archived = archived.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
      state.entries = entries.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
      state.weekly = weekly.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
      state.daily = daily.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
      state.defaultDayWeights = effectiveDayWeights(null, settings.exists() ? settings.data().defaultDayWeights : EQUAL_DAY_WEIGHTS);
      const now = today();
      const week = currentWeekStart();
      state.dashboard.today = now;
      state.dashboard.currentWeekStart = week;
      state.budget.today = now;
      if (state.dashboard.selectedDate > now) state.dashboard.selectedDate = now;
      if (state.dashboard.selectedWeekStart > week) state.dashboard.selectedWeekStart = week;
    } finally {
      state.loading = false;
    }
  })();
  try {
    await loadingPromise;
  } finally {
    loadingPromise = null;
  }
}

function weeklySummary(key) {
  const range = weekRange(key);
  const week = normalizeWeek(key);
  const categories = periodCategories({ start: range.start, end: range.end, weekDocument: week })
    .map((category) => ({ ...category, budgetMinutes: resolveWeeklyBudgetMinutes(category, week) }));
  const rows = summarizeCategories(categories, state.entries, range.start, range.end)
    .filter((item) => state.categories.some((category) => category.id === item.id) || item.budgetMinutes > 0 || item.actualMinutes > 0);
  const totalBudgetMinutes = rows.reduce((sum, item) => sum + item.budgetMinutes, 0);
  const totalActualMinutes = rows.reduce((sum, item) => sum + item.actualMinutes, 0);
  return {
    totalBudgetMinutes,
    totalActualMinutes,
    percentage: totalBudgetMinutes ? Math.round(totalActualMinutes / totalBudgetMinutes * 100) : null,
    categorySummaries: rows,
  };
}

function renderDashboard() {
  const root = document.querySelector('#dashboard-view');
  if (!root || !state.user) return;
  const dates = recordedDateKeys(state.entries, state.dashboard.today);
  if (state.dashboard.mode === 'weekly') {
    root.innerHTML = `<div data-feature-ui="dashboard">${renderDashboardHtml({
      mode: 'weekly',
      selectedWeekStart: state.dashboard.selectedWeekStart,
      currentWeekStart: state.dashboard.currentWeekStart,
      weekRangeLabel: weekLabel(state.dashboard.selectedWeekStart),
      weeklySummary: weeklySummary(state.dashboard.selectedWeekStart),
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
        defaultDayWeights: state.defaultDayWeights,
      }),
    })}</div>`;
  }
  bindDashboardControls({
    root,
    state: state.dashboard,
    rerender: () => { renderDashboard(); updateHeader('dashboard'); },
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
      state.dashboard.selectedWeekStart = moveWeekStart(state.dashboard.selectedWeekStart, direction === 'prev' ? -1 : 1);
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
  renderDashboard();
}

function renderBudget() {
  const root = document.querySelector('#budget-view');
  if (!root || !state.user) return;
  root.innerHTML = `<div data-feature-ui="budget">${renderTimeBudgetHtml({
    mode: state.budget.mode,
    today: state.budget.today,
    categories: activeCategories(),
    weekDocument: normalizeWeek(currentWeekStart()),
    dailyDocument: dailyFor(state.budget.today),
    defaultDayWeights: state.defaultDayWeights,
    emptyHtml: document.querySelector('#empty-template')?.innerHTML || '',
  })}</div>`;
  bindTimeBudgetControls({
    root,
    state: state.budget,
    rerender: () => { renderBudget(); updateHeader('budget'); },
    onSaveDaily: saveDaily,
    onSaveWeekly: saveWeekly,
  });
}

async function saveDaily(inputs) {
  const overrides = {};
  for (const category of state.categories) {
    const parsed = parseOptionalHours(inputs[category.id]);
    if (parsed.explicit) overrides[category.id] = parsed.minutes;
  }
  const date = today();
  const ref = store.doc(db, 'users', state.user.uid, 'dailyBudgets', date);
  if (Object.keys(overrides).length) await store.setDoc(ref, { date, overrides, updatedAt: store.serverTimestamp() });
  else await store.deleteDoc(ref);
  await loadData(); renderBudget(); renderDashboard();
  document.dispatchEvent(new CustomEvent('weekly-time-budget:data-changed'));
  alert('오늘 시간 예산을 저장했습니다.');
}

async function saveWeekly({ budgetInputs, dayWeightInputs }) {
  const weekStart = currentWeekStart();
  const snapshot = buildWeeklyBudgetSnapshot({ weekStart, categories: state.categories, budgetInputs, dayWeightInputs });
  const batch = store.writeBatch(db);
  batch.set(store.doc(db, 'users', state.user.uid, 'weeklyBudgets', weekStart), { ...snapshot, updatedAt: store.serverTimestamp() }, { merge: true });
  batch.set(store.doc(db, 'users', state.user.uid, 'settings', 'timeBudget'), { defaultDayWeights: snapshot.dayWeights, updatedAt: store.serverTimestamp() }, { merge: true });
  await batch.commit();
  await loadData(); renderBudget(); renderDashboard();
  document.dispatchEvent(new CustomEvent('weekly-time-budget:data-changed'));
  alert('이번 주 시간 예산과 요일 비율을 저장했습니다.');
}

function updateHeader(view) {
  if (view === 'dashboard') {
    document.querySelector('#page-title').textContent = '대시보드';
    document.querySelector('#week-label').textContent = state.dashboard.mode === 'daily'
      ? `${state.dashboard.selectedDate} · 일간 현황`
      : `${weekLabel(state.dashboard.selectedWeekStart)} · 주간 현황`;
  } else {
    document.querySelector('#page-title').textContent = '시간 예산';
    document.querySelector('#week-label').textContent = state.budget.mode === 'today'
      ? `${state.budget.today} · 오늘 시간 예산`
      : `${weekLabel(currentWeekStart())} · 이번 주 시간 예산`;
  }
}

function switchOwnedView(name) {
  document.querySelectorAll('.view').forEach((view) => view.classList.add('hidden'));
  document.querySelector(`#${name}-view`)?.classList.remove('hidden');
  document.querySelectorAll('.nav-button').forEach((button) => button.classList.toggle('active', button.dataset.view === name));
  document.querySelector('.sidebar')?.classList.remove('open');
  if (name === 'dashboard') renderDashboard(); else renderBudget();
  updateHeader(name);
}

function patchNavigation() {
  const budgetButton = document.querySelector('[data-view="budget"]');
  if (budgetButton && budgetButton.textContent !== '시간 예산') budgetButton.textContent = '시간 예산';
}

function schedulePatch() {
  if (patchQueued || !state.user) return;
  patchQueued = true;
  queueMicrotask(async () => {
    patchQueued = false;
    patchNavigation();
    const dashboard = document.querySelector('#dashboard-view');
    const budget = document.querySelector('#budget-view');
    if (dashboard && !dashboard.classList.contains('hidden') && !dashboard.querySelector('[data-feature-ui="dashboard"]')) {
      await loadData(); renderDashboard(); updateHeader('dashboard');
    }
    if (budget && !budget.classList.contains('hidden') && !budget.querySelector('[data-feature-ui="budget"]')) {
      await loadData(); renderBudget(); updateHeader('budget');
    }
  });
}

document.addEventListener('click', (event) => {
  const button = event.target.closest('.nav-button[data-view="dashboard"], .nav-button[data-view="budget"]');
  if (!button) return;
  event.preventDefault(); event.stopPropagation(); event.stopImmediatePropagation();
  switchOwnedView(button.dataset.view);
}, true);

document.addEventListener('weekly-time-budget:data-changed', async () => {
  if (!state.user) return;
  await loadData();
  if (!document.querySelector('#dashboard-view')?.classList.contains('hidden')) renderDashboard();
  if (!document.querySelector('#budget-view')?.classList.contains('hidden')) renderBudget();
});

const observer = new MutationObserver(schedulePatch);
observer.observe(document.body, { childList: true, subtree: true });
patchNavigation();
authModule.onAuthStateChanged(auth, async (user) => {
  state.user = user;
  if (!user) return;
  await loadData();
  schedulePatch();
});
