import { getWeekRange } from './domain.js';
import {
  buildRecordedPeriodIndex,
  defaultMonthForYear,
} from './recorded-period-domain.js';
import {
  applyStatisticsAction,
  createStatisticsState,
  statisticsRenderKey,
} from './statistics-state.js';
import {
  buildStatisticsViewModel,
  renderStatisticsFailure,
  renderStatisticsHtml,
} from './statistics-view.js';

function localDateKey(date) {
  const pad = (value) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error || '알 수 없는 오류');
}

export function createStatisticsFeature({
  root,
  dataSource,
  getCurrentUser,
  saveUiState = async () => {},
  setHeader = () => {},
  now = () => new Date(),
  diagnostics = {},
}) {
  if (!root) throw new Error('통계 화면 루트가 필요합니다.');
  if (!dataSource?.load) throw new Error('통계 데이터 소스가 필요합니다.');

  for (const key of ['modeChanges', 'aggregateRuns', 'renderRuns', 'stateSaves']) {
    if (!Number.isFinite(diagnostics[key])) diagnostics[key] = 0;
  }
  if (!Array.isArray(diagnostics.aggregateDurations)) diagnostics.aggregateDurations = [];

  let state = createStatisticsState({ now: now() });
  let active = false;
  let destroyed = false;
  let loadedUserId = null;
  let loadingPromise = null;
  let requestSequence = 0;
  let lastRenderedSignature = '';
  let lastModel = null;

  function contextFor(currentState = state) {
    const current = now();
    let periods;
    try {
      periods = buildRecordedPeriodIndex(currentState.data?.entries || [], localDateKey(current));
    } catch (error) {
      throw Object.assign(new Error(errorMessage(error)), { statisticsStage: '기록 기간 인덱스' });
    }
    return {
      currentWeekStart: getWeekRange(current).start,
      currentYear: current.getFullYear(),
      currentMonth: current.getMonth() + 1,
      recordedWeekStarts: periods.weekStarts,
      recordedMonths: periods.months,
      recordedYears: periods.years,
    };
  }

  function presentationSignature(currentState = state) {
    return [
      statisticsRenderKey(currentState),
      currentState.source,
      currentState.warning,
      currentState.loadStatus,
      currentState.renderError ? errorMessage(currentState.renderError) : '',
    ].join('|');
  }

  function showFailure(stage, error) {
    state = { ...state, renderError: error };
    root.innerHTML = renderStatisticsFailure({
      mode: state.mode,
      stage,
      message: errorMessage(error),
    });
    lastRenderedSignature = presentationSignature(state);
  }

  function render({ force = false } = {}) {
    if (!active || destroyed || !state.data) return false;
    const signature = presentationSignature(state);
    if (!force && signature === lastRenderedSignature) return false;

    try {
      contextFor(state);
    } catch (error) {
      showFailure(error.statisticsStage || '기록 기간 인덱스', error);
      return false;
    }

    let model;
    const startedAt = globalThis.performance?.now?.() ?? Date.now();
    try {
      diagnostics.aggregateRuns += 1;
      model = buildStatisticsViewModel(state, { now: now() });
    } catch (error) {
      showFailure('통계 집계', error);
      return false;
    } finally {
      const endedAt = globalThis.performance?.now?.() ?? Date.now();
      const duration = Math.max(0, endedAt - startedAt);
      diagnostics.aggregateDurations.push(duration);
      diagnostics.lastAggregateMs = duration;
      diagnostics.maxAggregateMs = Math.max(Number(diagnostics.maxAggregateMs) || 0, duration);
    }

    let html;
    try {
      html = renderStatisticsHtml(model);
    } catch (error) {
      showFailure('HTML 생성', error);
      return false;
    }

    try {
      root.innerHTML = html;
    } catch (error) {
      showFailure('화면 반영', error);
      return false;
    }
    diagnostics.renderRuns += 1;
    lastModel = model;
    lastRenderedSignature = signature;
    setHeader({ title: '통계', label: model.headerText });
    return true;
  }

  function normalizePeriod(nextState) {
    const context = contextFor(nextState);
    let normalized = nextState;
    if (normalized.mode === 'weekly') {
      normalized = applyStatisticsAction(normalized, {
        type: 'select-week', weekStart: normalized.weekStart,
      }, context).state;
    }
    if (normalized.mode === 'monthly') {
      normalized = applyStatisticsAction(normalized, {
        type: 'select-month', year: normalized.year, month: normalized.month,
      }, context).state;
    }
    if (normalized.mode === 'yearly' || normalized.mode === 'monthly-comparison') {
      normalized = applyStatisticsAction(normalized, {
        type: 'select-year', year: normalized.year,
      }, context).state;
    }
    return normalized;
  }

  async function persist() {
    diagnostics.stateSaves += 1;
    await saveUiState({
      activeView: 'statistics',
      statistics: {
        mode: state.mode,
        weekStart: state.weekStart,
        year: state.year,
        month: state.month,
      },
    });
  }

  async function transition(nextState, { save = true, modeChanged = false } = {}) {
    const before = presentationSignature(state);
    state = nextState;
    const changed = presentationSignature(state) !== before;
    if (!changed) return false;
    if (modeChanged) diagnostics.modeChanges += 1;
    render();
    if (save) await persist();
    return true;
  }

  function applySnapshot(snapshot) {
    const result = applyStatisticsAction(state, {
      type: 'replace-data',
      data: snapshot.data,
      dataVersion: snapshot.dataVersion,
      source: snapshot.source,
      warning: snapshot.warning || '',
    }, contextFor(state));
    state = normalizePeriod(result.state);
    render();
  }

  async function load({ force = false } = {}) {
    const user = getCurrentUser();
    if (!user?.uid || destroyed) return null;
    if (!force && loadedUserId === user.uid && state.data) {
      render();
      return state.data;
    }
    if (loadingPromise && loadedUserId === user.uid) return loadingPromise;

    if (loadedUserId && loadedUserId !== user.uid) {
      const restored = {
        mode: state.mode,
        weekStart: state.weekStart,
        year: state.year,
        month: state.month,
      };
      state = createStatisticsState({ now: now(), restored });
      lastRenderedSignature = '';
      lastModel = null;
      root.innerHTML = '<div class="card"><h2>통계를 불러오는 중…</h2><p class="muted">새 사용자의 자료를 확인하고 있습니다.</p></div>';
    }
    loadedUserId = user.uid;
    const sequence = ++requestSequence;
    if (!state.data) {
      root.innerHTML = '<div class="card"><h2>통계를 불러오는 중…</h2><p class="muted">기기에 저장된 자료를 확인하고 있습니다.</p></div>';
    }
    state = applyStatisticsAction(state, { type: 'load-status', status: 'loading' }, contextFor(state)).state;

    const promise = dataSource.load(user.uid, {
      onCache: async (snapshot) => {
        if (sequence !== requestSequence || getCurrentUser()?.uid !== user.uid) return;
        applySnapshot(snapshot);
      },
      onServer: async (snapshot) => {
        if (sequence !== requestSequence || getCurrentUser()?.uid !== user.uid) return;
        applySnapshot(snapshot);
      },
    }).then((finalSnapshot) => {
      if (sequence !== requestSequence || getCurrentUser()?.uid !== user.uid) return null;
      if (finalSnapshot && (finalSnapshot.dataVersion !== state.dataVersion
          || finalSnapshot.warning !== state.warning
          || finalSnapshot.source !== state.source)) {
        applySnapshot(finalSnapshot);
      }
      return finalSnapshot;
    }).catch((error) => {
      if (sequence !== requestSequence || getCurrentUser()?.uid !== user.uid) return null;
      showFailure('통계 데이터 로드', error);
      return null;
    }).finally(() => {
      if (loadingPromise === promise) loadingPromise = null;
    });
    loadingPromise = promise;
    return promise;
  }

  async function selectMode(mode) {
    const context = contextFor(state);
    let next = applyStatisticsAction(state, { type: 'select-mode', mode }, context).state;
    if (next === state) return false;
    if (mode === 'monthly') {
      next = applyStatisticsAction(next, {
        type: 'select-month', year: next.year, month: next.month,
      }, context).state;
    }
    if (mode === 'weekly') {
      next = applyStatisticsAction(next, {
        type: 'select-week', weekStart: next.weekStart,
      }, context).state;
    }
    return transition(next, { modeChanged: true });
  }

  async function onClick(event) {
    const modeButton = event.target.closest?.('[data-statistics-mode]');
    if (modeButton && root.contains(modeButton)) {
      event.preventDefault();
      await selectMode(modeButton.dataset.statisticsMode);
      return;
    }
    const weekButton = event.target.closest?.('[data-statistics-week]');
    if (weekButton && root.contains(weekButton)) {
      event.preventDefault();
      const target = weekButton.dataset.statisticsWeek === 'previous'
        ? lastModel?.previousWeekStart
        : lastModel?.nextWeekStart;
      if (!target) return;
      const next = applyStatisticsAction(state, { type: 'select-week', weekStart: target }, contextFor(state)).state;
      await transition(next);
      return;
    }
    const retry = event.target.closest?.('[data-statistics-retry]');
    if (retry && root.contains(retry)) {
      event.preventDefault();
      await refresh();
    }
  }

  async function onChange(event) {
    if (event.target.id === 'statistics-month') {
      const selected = event.target.selectedOptions?.[0];
      if (selected?.disabled) return;
      const next = applyStatisticsAction(state, {
        type: 'select-month',
        year: Number(root.querySelector('#statistics-year')?.value || state.year),
        month: Number(event.target.value),
      }, contextFor(state)).state;
      await transition(next);
      return;
    }
    if (event.target.id !== 'statistics-year') return;
    const year = Number(event.target.value);
    const context = contextFor(state);
    let next;
    if (state.mode === 'monthly') {
      const month = defaultMonthForYear({
        year,
        currentYear: context.currentYear,
        currentMonth: context.currentMonth,
        recordedMonths: context.recordedMonths,
      });
      if (!month) return;
      next = applyStatisticsAction(state, { type: 'select-month', year, month }, context).state;
    } else {
      next = applyStatisticsAction(state, { type: 'select-year', year }, context).state;
    }
    await transition(next);
  }

  root.addEventListener('click', onClick);
  root.addEventListener('change', onChange);

  async function enter() {
    if (destroyed) return null;
    active = true;
    return load();
  }

  function leave() {
    active = false;
  }

  function restore(saved = {}) {
    const restored = createStatisticsState({ now: now(), restored: saved });
    state = {
      ...state,
      mode: restored.mode,
      weekStart: restored.weekStart,
      year: restored.year,
      month: restored.month,
    };
    if (state.data) state = normalizePeriod(state);
    lastRenderedSignature = '';
    render();
  }

  async function refresh() {
    requestSequence += 1;
    loadingPromise = null;
    return load({ force: true });
  }

  function destroy() {
    destroyed = true;
    active = false;
    requestSequence += 1;
    root.removeEventListener('click', onClick);
    root.removeEventListener('change', onChange);
  }

  return { enter, leave, restore, refresh, destroy };
}
