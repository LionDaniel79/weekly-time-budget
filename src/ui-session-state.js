const DASHBOARD_MODES = new Set(['daily', 'weekly']);
const RECORD_TABS = new Set(['timer', 'manual']);
const MANUAL_MODES = new Set(['time-range', 'duration']);
const BUDGET_MODES = new Set(['today', 'week']);
const STATISTICS_MODES = new Set([
  'weekly',
  'monthly',
  'yearly',
  'monthly-comparison',
  'yearly-comparison',
]);

function dateParts(dateKey) {
  const [year, month] = String(dateKey || '').split('-').map(Number);
  return {
    year: Number.isInteger(year) ? year : new Date().getFullYear(),
    month: Number.isInteger(month) && month >= 1 && month <= 12 ? month : new Date().getMonth() + 1,
  };
}

function validDateKey(value, fallback) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || '')) ? String(value) : fallback;
}

function notFuture(value, maximum) {
  const normalized = validDateKey(value, maximum);
  return normalized > maximum ? maximum : normalized;
}

export function createDefaultUiState({
  today,
  currentWeekStart,
} = {}) {
  const safeToday = validDateKey(today, new Date().toISOString().slice(0, 10));
  const safeWeekStart = validDateKey(currentWeekStart, safeToday);
  const current = dateParts(safeToday);

  return {
    activeView: 'dashboard',
    dashboard: {
      mode: 'daily',
      selectedDate: safeToday,
      selectedWeekStart: safeWeekStart,
      calendarYear: current.year,
      calendarMonth: current.month,
    },
    record: {
      tab: 'timer',
      manualMode: 'time-range',
    },
    budget: {
      mode: 'today',
    },
    statistics: {
      mode: 'weekly',
      weekStart: safeWeekStart,
      year: current.year,
      month: current.month,
    },
  };
}

export function normalizeUiState(raw = {}, {
  today,
  currentWeekStart,
  validViews = ['dashboard', 'record', 'budget', 'history', 'statistics', 'categories'],
} = {}) {
  const defaults = createDefaultUiState({ today, currentWeekStart });
  const current = dateParts(defaults.dashboard.selectedDate);
  const allowedViews = new Set(validViews);

  const dashboardMode = DASHBOARD_MODES.has(raw?.dashboard?.mode)
    ? raw.dashboard.mode
    : defaults.dashboard.mode;
  const selectedDate = notFuture(raw?.dashboard?.selectedDate, defaults.dashboard.selectedDate);
  const selectedWeekStart = notFuture(raw?.dashboard?.selectedWeekStart, defaults.dashboard.selectedWeekStart);
  const selectedDateParts = dateParts(selectedDate);
  const rawCalendarYear = Number(raw?.dashboard?.calendarYear);
  const rawCalendarMonth = Number(raw?.dashboard?.calendarMonth);
  const calendarIsValid = Number.isInteger(rawCalendarYear)
    && Number.isInteger(rawCalendarMonth)
    && rawCalendarMonth >= 1
    && rawCalendarMonth <= 12
    && (rawCalendarYear < current.year || (rawCalendarYear === current.year && rawCalendarMonth <= current.month));

  const statisticsYear = Number(raw?.statistics?.year);
  const statisticsMonth = Number(raw?.statistics?.month);
  const statisticsPeriodIsFuture = statisticsYear > current.year
    || (statisticsYear === current.year && statisticsMonth > current.month);
  const safeStatisticsYear = Number.isInteger(statisticsYear) && statisticsYear > 0 && !statisticsPeriodIsFuture
    ? statisticsYear
    : current.year;
  const safeStatisticsMonth = Number.isInteger(statisticsMonth)
    && statisticsMonth >= 1
    && statisticsMonth <= 12
    && !statisticsPeriodIsFuture
    ? statisticsMonth
    : current.month;

  return {
    activeView: allowedViews.has(raw?.activeView) ? raw.activeView : defaults.activeView,
    dashboard: {
      mode: dashboardMode,
      selectedDate,
      selectedWeekStart,
      calendarYear: calendarIsValid ? rawCalendarYear : selectedDateParts.year,
      calendarMonth: calendarIsValid ? rawCalendarMonth : selectedDateParts.month,
    },
    record: {
      tab: RECORD_TABS.has(raw?.record?.tab) ? raw.record.tab : defaults.record.tab,
      manualMode: MANUAL_MODES.has(raw?.record?.manualMode)
        ? raw.record.manualMode
        : defaults.record.manualMode,
    },
    budget: {
      mode: BUDGET_MODES.has(raw?.budget?.mode) ? raw.budget.mode : defaults.budget.mode,
    },
    statistics: {
      mode: STATISTICS_MODES.has(raw?.statistics?.mode)
        ? raw.statistics.mode
        : defaults.statistics.mode,
      weekStart: notFuture(raw?.statistics?.weekStart, defaults.statistics.weekStart),
      year: safeStatisticsYear,
      month: safeStatisticsMonth,
    },
  };
}

export function mergeUiState(current = {}, partial = {}, context = {}) {
  const merged = {
    ...current,
    ...partial,
    dashboard: { ...(current.dashboard || {}), ...(partial.dashboard || {}) },
    record: { ...(current.record || {}), ...(partial.record || {}) },
    budget: { ...(current.budget || {}), ...(partial.budget || {}) },
    statistics: { ...(current.statistics || {}), ...(partial.statistics || {}) },
  };
  return normalizeUiState(merged, context);
}
