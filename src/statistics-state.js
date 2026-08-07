import { getWeekRange } from './domain.js';
import { coerceMonthlySelection } from './recorded-period-domain.js';

const MODES = new Set(['weekly', 'monthly', 'yearly', 'monthly-comparison', 'yearly-comparison']);
const DATE_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function validWeekStart(value, currentWeekStart) {
  const selected = String(value || '');
  if (!DATE_KEY_PATTERN.test(selected) || selected > currentWeekStart) return currentWeekStart;
  return getWeekRange(new Date(`${selected}T12:00:00`)).start;
}

export function createStatisticsState({ now = new Date(), restored = {} } = {}) {
  return {
    mode: MODES.has(restored.mode) ? restored.mode : 'weekly',
    weekStart: restored.weekStart || getWeekRange(now).start,
    year: Number(restored.year) || now.getFullYear(),
    month: Number(restored.month) || now.getMonth() + 1,
    data: null,
    dataVersion: 'none',
    loadStatus: 'idle',
    source: 'none',
    warning: '',
    renderError: null,
  };
}

export function statisticsRenderKey(state) {
  const period = state.mode === 'weekly'
    ? state.weekStart
    : state.mode === 'monthly'
      ? `${state.year}-${String(state.month).padStart(2, '0')}`
      : state.mode === 'yearly-comparison' ? 'all' : String(state.year);
  return `${state.dataVersion}|${state.mode}|${period}`;
}

export function applyStatisticsAction(state, action, context) {
  let next = state;
  if (action.type === 'select-mode' && MODES.has(action.mode) && action.mode !== state.mode) {
    next = { ...state, mode: action.mode, warning: '', renderError: null };
  }
  if (action.type === 'select-week') {
    const weekStart = validWeekStart(action.weekStart, context.currentWeekStart);
    if (weekStart !== state.weekStart) next = { ...state, weekStart, warning: '', renderError: null };
  }
  if (action.type === 'select-year') {
    const requested = Number(action.year);
    const allowedYears = new Set([...(context.recordedYears || []), context.currentYear]);
    const year = Number.isInteger(requested) && allowedYears.has(requested)
      ? requested
      : context.currentYear;
    if (year !== state.year) next = { ...state, year, warning: '', renderError: null };
  }
  if (action.type === 'select-month') {
    const selected = coerceMonthlySelection({
      year: action.year,
      month: action.month,
      currentYear: context.currentYear,
      currentMonth: context.currentMonth,
      recordedMonths: context.recordedMonths,
    });
    if (selected.year !== state.year || selected.month !== state.month) next = { ...state, ...selected };
  }
  if (action.type === 'replace-data') {
    next = {
      ...state,
      data: action.data,
      dataVersion: action.dataVersion,
      source: action.source,
      loadStatus: 'ready',
      warning: action.warning || '',
      renderError: null,
    };
  }
  if (action.type === 'load-status') next = { ...state, loadStatus: action.status, warning: action.warning || '' };
  if (action.type === 'render-error') next = { ...state, renderError: action.error };
  return {
    state: next,
    changed: statisticsRenderKey(next) !== statisticsRenderKey(state)
      || next.loadStatus !== state.loadStatus
      || next.warning !== state.warning
      || next.renderError !== state.renderError,
  };
}
