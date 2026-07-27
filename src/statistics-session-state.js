let desiredState = globalThis.window?.__weeklyTimeBudgetUiState || null;
let restoring = false;
let scheduled = false;
let observer = null;

function statisticsView() {
  return document.querySelector('#statistics-view');
}

function statisticsButton() {
  return document.querySelector('.nav-button[data-view="statistics"]');
}

function selectedMode() {
  return statisticsView()?.querySelector('[data-stat-mode].active')?.dataset.statMode || 'weekly';
}

function selectedWeekStart() {
  const text = statisticsView()?.querySelector('.week-range')?.textContent || '';
  return text.match(/\d{4}-\d{2}-\d{2}/)?.[0] || null;
}

function readStatisticsState() {
  const year = Number(statisticsView()?.querySelector('#statistics-year')?.value);
  const month = Number(statisticsView()?.querySelector('#statistics-month')?.value);
  const saved = desiredState?.statistics || {};
  return {
    mode: selectedMode(),
    weekStart: selectedWeekStart() || saved.weekStart,
    year: Number.isInteger(year) && year > 0 ? year : saved.year,
    month: Number.isInteger(month) && month >= 1 && month <= 12 ? month : saved.month,
  };
}

function persistCurrentStatistics() {
  if (restoring || statisticsView()?.classList.contains('hidden')) return;
  const statistics = readStatisticsState();
  desiredState = {
    ...(desiredState || {}),
    activeView: 'statistics',
    statistics,
  };
  document.dispatchEvent(new CustomEvent('weekly-time-budget:save-ui-state', {
    detail: { activeView: 'statistics', statistics },
  }));
}

function clickControl(selector) {
  const control = statisticsView()?.querySelector(selector);
  if (!control || control.disabled) return false;
  control.click();
  return true;
}

function scheduleRestore() {
  if (scheduled) return;
  scheduled = true;
  queueMicrotask(() => {
    scheduled = false;
    restoreStatisticsState();
  });
}

function restoreStatisticsState() {
  const saved = desiredState?.statistics;
  const view = statisticsView();
  if (!saved || desiredState?.activeView !== 'statistics' || !view) return;

  if (view.classList.contains('hidden') || !view.querySelector('[data-stat-mode]')) {
    const button = statisticsButton();
    if (button) {
      restoring = true;
      button.click();
      setTimeout(() => { restoring = false; scheduleRestore(); }, 0);
    }
    return;
  }

  const activeMode = selectedMode();
  if (saved.mode && activeMode !== saved.mode) {
    restoring = true;
    if (clickControl(`[data-stat-mode="${saved.mode}"]`)) {
      setTimeout(() => { restoring = false; scheduleRestore(); }, 0);
      return;
    }
    restoring = false;
  }

  if (saved.mode === 'weekly' && saved.weekStart) {
    const current = selectedWeekStart();
    if (current && current !== saved.weekStart) {
      restoring = true;
      const selector = current > saved.weekStart ? '[data-week-offset="-1"]' : '[data-week-offset="1"]';
      if (clickControl(selector)) {
        setTimeout(() => { restoring = false; scheduleRestore(); }, 0);
        return;
      }
      restoring = false;
    }
  }

  const yearSelect = view.querySelector('#statistics-year');
  if (yearSelect && saved.year && yearSelect.value !== String(saved.year)) {
    const option = [...yearSelect.options].find((item) => item.value === String(saved.year));
    if (option) {
      restoring = true;
      yearSelect.value = String(saved.year);
      yearSelect.dispatchEvent(new Event('change', { bubbles: true }));
      setTimeout(() => { restoring = false; scheduleRestore(); }, 0);
      return;
    }
  }

  const monthSelect = view.querySelector('#statistics-month');
  if (monthSelect && saved.month && monthSelect.value !== String(saved.month)) {
    restoring = true;
    monthSelect.value = String(saved.month);
    monthSelect.dispatchEvent(new Event('change', { bubbles: true }));
    setTimeout(() => { restoring = false; scheduleRestore(); }, 0);
    return;
  }

  restoring = false;
}

document.addEventListener('weekly-time-budget:ui-state-restored', (event) => {
  desiredState = event.detail || null;
  scheduleRestore();
});

document.addEventListener('click', (event) => {
  const nav = event.target.closest('.nav-button[data-view="statistics"]');
  if (nav) {
    desiredState = { ...(desiredState || {}), activeView: 'statistics' };
    document.dispatchEvent(new CustomEvent('weekly-time-budget:save-ui-state', {
      detail: { activeView: 'statistics' },
    }));
    setTimeout(scheduleRestore, 0);
    return;
  }
  if (event.target.closest('#statistics-view [data-stat-mode], #statistics-view [data-week-offset]')) {
    setTimeout(persistCurrentStatistics, 0);
  }
}, true);

document.addEventListener('change', (event) => {
  if (event.target.matches('#statistics-year, #statistics-month')) {
    setTimeout(persistCurrentStatistics, 0);
  }
}, true);

observer = new MutationObserver(() => {
  if (restoring) scheduleRestore();
});
observer.observe(document.body, { childList: true, subtree: true });

if (desiredState?.activeView === 'statistics') scheduleRestore();
