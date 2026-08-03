import {
  DAY_KEYS,
  calendarMonthCells,
  effectiveDayWeights,
  explicitBudgetIdSet,
  normalizeDayWeights,
  resolveDailyBudget,
  resolveWeeklyBudgetMinutes,
} from './time-budget-domain.js';
import { categoryDisplayName } from './goal-domain.js';

const DAY_LABELS = Object.freeze({
  mon: '월', tue: '화', wed: '수', thu: '목', fri: '금', sat: '토', sun: '일',
});

const escapeHtml = (value = '') => String(value).replace(/[&<>'"]/g, (char) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;',
}[char]));

const hasOwn = (object, key) => Object.prototype.hasOwnProperty.call(object || {}, key);

const hoursValue = (minutes) => {
  const value = Number(minutes || 0) / 60;
  return Number.isInteger(value) ? String(value) : String(Math.round(value * 10) / 10);
};

const formatMinutes = (minutes) => {
  const value = Math.max(0, Math.round(Number(minutes) || 0));
  const hours = Math.floor(value / 60);
  const rest = value % 60;
  if (!hours) return `${rest}분`;
  if (!rest) return `${hours}시간`;
  return `${hours}시간 ${rest}분`;
};

const percentageText = (value) => value === null || value === undefined ? '—' : `${value}%`;
const goalScoreText = (summary) => summary?.goalComplianceStatus === 'excluded'
  ? '계산 제외'
  : `${summary?.goalComplianceScore ?? 0}점`;
const categoryAchievementText = (item) => item?.hasBudget
  ? percentageText(item.percentage)
  : '달성률 계산 제외';

function categoryProgressHtml(item) {
  const progress = item?.progress || { mode: 'growth', fillPercentage: 0 };
  const className = progress.mode === 'remaining'
    ? 'restraint-progress restraint-remaining'
    : progress.mode === 'overage'
      ? 'restraint-progress restraint-overage'
      : progress.mode === 'exact' || progress.mode === 'excluded'
        ? 'restraint-progress restraint-exact'
        : 'growth-progress';
  return `<div class="progress ${className}"><span style="width:${progress.fillPercentage}%"></span></div>`;
}

function categoryGoalDetail(item) {
  if (!item?.hasBudget) return '달성률 계산 제외';
  if (item.goalType === 'restraint') {
    if (item.status === 'overage') return `${formatMinutes(item.differenceMinutes)} 초과 사용`;
    if (item.status === 'exact') return '예산 소진';
    return `${formatMinutes(Math.abs(item.differenceMinutes))} 남음`;
  }
  if (item.differenceMinutes > 0) return `${formatMinutes(item.differenceMinutes)} 초과 달성`;
  if (item.differenceMinutes < 0) return `${formatMinutes(Math.abs(item.differenceMinutes))} 남음`;
  return '예산과 일치';
}

export function createTimeBudgetUiState(today) {
  return { mode: 'today', today };
}

export function createDashboardUiState(today, currentWeekStart) {
  const date = new Date(`${today}T12:00:00`);
  return {
    mode: 'daily',
    selectedDate: today,
    selectedWeekStart: currentWeekStart,
    calendarYear: date.getFullYear(),
    calendarMonth: date.getMonth() + 1,
  };
}

function renderBudgetTabs(mode) {
  return `<div class="time-budget-tabs tabs" role="tablist" aria-label="시간 예산 구분">
    <button type="button" class="tab-button ${mode === 'today' ? 'active' : ''}" data-budget-mode="today" role="tab" aria-selected="${mode === 'today'}">오늘</button>
    <button type="button" class="tab-button ${mode === 'week' ? 'active' : ''}" data-budget-mode="week" role="tab" aria-selected="${mode === 'week'}">이번 주</button>
  </div>`;
}

function renderTodayBudget(model) {
  const overrides = model.dailyDocument?.overrides || {};
  const rows = model.categories.map((category) => {
    const automatic = resolveDailyBudget({
      category,
      date: model.today,
      weekDocument: model.weekDocument,
      dailyDocument: null,
      defaultDayWeights: model.defaultDayWeights,
    });
    const direct = hasOwn(overrides, category.id);
    return `<label class="time-budget-category-row">
      <span class="time-budget-category-copy">
        <strong>${escapeHtml(categoryDisplayName(category))}</strong>
        <small>${direct ? '직접 설정' : '요일 비율 적용'} · 자동 ${formatMinutes(automatic.minutes)}</small>
      </span>
      <span class="hours-input"><input type="number" name="${escapeHtml(category.id)}" min="0" step="0.5" inputmode="decimal" value="${direct ? hoursValue(overrides[category.id]) : ''}" placeholder="자동 ${hoursValue(automatic.minutes)}"><span>시간</span></span>
    </label>`;
  }).join('');
  return `<form id="daily-budget-form" class="time-budget-form" novalidate>
    <div class="section-title"><div><h2>오늘 시간 예산</h2><p class="muted">${escapeHtml(model.today)} · 필요한 대분류만 직접 설정하세요. 빈칸은 자동 예산, 0은 명시적 0시간입니다.</p></div></div>
    <div class="time-budget-category-list">${rows || model.emptyHtml || ''}</div>
    <div class="bulk-save-actions"><button class="primary-button" type="submit">저장</button></div>
  </form>`;
}

function renderWeekBudget(model) {
  const explicitIds = explicitBudgetIdSet(model.weekDocument);
  const rows = model.categories.map((category) => {
    const effective = resolveWeeklyBudgetMinutes(category, model.weekDocument);
    const explicit = explicitIds.has(category.id);
    return `<label class="time-budget-category-row">
      <span class="time-budget-category-copy"><strong>${escapeHtml(categoryDisplayName(category))}</strong><small>기본 ${formatMinutes(category.defaultBudgetMinutes ?? category.budgetMinutes ?? 0)} · 적용 ${formatMinutes(effective)}</small></span>
      <span class="hours-input"><input type="number" name="${escapeHtml(category.id)}" min="0" step="0.5" inputmode="decimal" value="${explicit ? hoursValue(model.weekDocument?.budgets?.[category.id]) : ''}" placeholder="기본 ${hoursValue(category.defaultBudgetMinutes ?? category.budgetMinutes ?? 0)}"><span>시간</span></span>
    </label>`;
  }).join('');
  const weights = effectiveDayWeights(model.weekDocument, model.defaultDayWeights);
  const weightInputs = DAY_KEYS.map((key) => `<label><span>${DAY_LABELS[key]}</span><input type="number" min="0" step="any" inputmode="decimal" name="day-weight-${key}" value="${Math.round(weights[key] * 10000) / 100}"></label>`).join('');
  const preview = DAY_KEYS.map((key) => `${DAY_LABELS[key]} ${Math.round(weights[key] * 1000) / 10}%`).join(' · ');
  return `<form id="weekly-budget-form" class="time-budget-form" novalidate>
    <section><div class="section-title"><div><h2>이번 주 전체 예산</h2><p class="muted">빈칸은 기본 주간 예산, 0은 이번 주 명시적 0시간입니다.</p></div></div><div class="time-budget-category-list">${rows || model.emptyHtml || ''}</div></section>
    <section class="day-weight-section"><div class="section-title"><div><h2>요일별 공통 배분 비율</h2><p class="muted">입력값의 상대 비율을 자동으로 100%로 환산해 모든 대분류에 공통 적용합니다.</p></div></div><div class="day-weight-grid">${weightInputs}</div><p id="day-weight-preview" class="day-weight-preview">환산: ${preview}</p></section>
    <div class="bulk-save-actions"><button class="primary-button" type="submit">저장</button></div>
  </form>`;
}

export function renderTimeBudgetHtml(model) {
  const mode = model.mode === 'week' ? 'week' : 'today';
  return `<div class="card">${renderBudgetTabs(mode)}${mode === 'today' ? renderTodayBudget(model) : renderWeekBudget(model)}</div>`;
}

export function bindTimeBudgetControls({ root, state, rerender, onSaveDaily, onSaveWeekly }) {
  root.querySelectorAll('[data-budget-mode]').forEach((button) => {
    button.addEventListener('click', () => {
      state.mode = button.dataset.budgetMode;
      rerender();
    });
  });
  root.querySelector('#daily-budget-form')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const button = event.currentTarget.querySelector('button[type="submit"]');
    const values = Object.fromEntries([...event.currentTarget.querySelectorAll('input[name]')].map((input) => [input.name, input.value]));
    await runSave(button, () => onSaveDaily(values));
  });
  const weeklyForm = root.querySelector('#weekly-budget-form');
  weeklyForm?.querySelectorAll('[name^="day-weight-"]').forEach((input) => {
    input.addEventListener('input', () => updateWeightPreview(weeklyForm));
  });
  weeklyForm?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const budgetInputs = Object.fromEntries([...event.currentTarget.querySelectorAll('.time-budget-category-row input[name]')].map((input) => [input.name, input.value]));
    const dayWeightInputs = Object.fromEntries(DAY_KEYS.map((key) => [key, event.currentTarget.querySelector(`[name="day-weight-${key}"]`)?.value ?? '']));
    await runSave(event.currentTarget.querySelector('button[type="submit"]'), () => onSaveWeekly({ budgetInputs, dayWeightInputs }));
  });
}

async function runSave(button, callback) {
  if (!button || button.disabled) return;
  button.disabled = true;
  button.textContent = '저장 중…';
  try {
    await callback();
  } catch (error) {
    alert(error instanceof Error ? error.message : String(error));
  } finally {
    if (button.isConnected) {
      button.disabled = false;
      button.textContent = '저장';
    }
  }
}

function updateWeightPreview(form) {
  const raw = Object.fromEntries(DAY_KEYS.map((key) => [key, form.querySelector(`[name="day-weight-${key}"]`)?.value ?? '']));
  const preview = form.querySelector('#day-weight-preview');
  try {
    const weights = normalizeDayWeights(raw);
    preview.textContent = `환산: ${DAY_KEYS.map((key) => `${DAY_LABELS[key]} ${Math.round(weights[key] * 1000) / 10}%`).join(' · ')}`;
  } catch (error) {
    preview.textContent = error.message;
  }
}

function renderSummaryCards(summary, budgetLabel) {
  return `<div class="grid grid-3 dashboard-summary">
    <article class="card"><p class="muted">목표 준수</p><div class="metric">${goalScoreText(summary)}</div></article>
    <article class="card"><p class="muted">${budgetLabel}</p><div class="metric">${formatMinutes(summary.totalBudgetMinutes)}</div></article>
    <article class="card"><p class="muted">실제 기록</p><div class="metric">${formatMinutes(summary.totalActualMinutes)}</div></article>
  </div>`;
}

function renderCategorySummary(summary) {
  const items = summary.categorySummaries || [];
  return `<div class="card dashboard-category-card"><div class="section-title"><h2>대분류별 달성률</h2><span class="badge">${items.length}개 분야</span></div>${items.length ? items.map((item) => `<div class="dashboard-category-row"><div><strong>${escapeHtml(item.name)}</strong>${item.budgetSource ? `<small>${item.budgetSource === 'direct' ? '직접 설정' : '요일 비율 적용'}</small>` : ''}${categoryProgressHtml(item)}<small class="goal-detail">${categoryGoalDetail(item)}</small></div><span>${formatMinutes(item.actualMinutes)} / ${formatMinutes(item.budgetMinutes)}</span><strong class="dashboard-achievement-text">${categoryAchievementText(item)}</strong></div>`).join('') : '<div class="empty-state"><p>표시할 대분류가 없습니다.</p></div>'}</div>`;
}

function renderCalendar(model) {
  const cells = calendarMonthCells(model.calendarYear, model.calendarMonth, model.recordDates || [], model.today);
  const todayYear = Number(model.today.slice(0, 4));
  const todayMonth = Number(model.today.slice(5, 7));
  const futureMonth = model.calendarYear > todayYear || (model.calendarYear === todayYear && model.calendarMonth >= todayMonth);
  return `<div class="record-calendar" aria-label="기록 날짜 선택"><div class="record-calendar-header"><button type="button" class="secondary-button" data-calendar-direction="prev" aria-label="이전 달">‹</button><strong>${model.calendarYear}년 ${model.calendarMonth}월</strong><button type="button" class="secondary-button" data-calendar-direction="next" aria-label="다음 달" ${futureMonth ? 'disabled' : ''}>›</button></div><div class="record-calendar-weekdays">${['월','화','수','목','금','토','일'].map((day) => `<span>${day}</span>`).join('')}</div><div class="record-calendar-grid">${cells.map((cell) => cell.date ? `<button type="button" data-dashboard-date="${cell.date}" ${cell.disabled ? 'disabled' : ''} class="${cell.date === model.selectedDate ? 'selected' : ''}">${cell.day}</button>` : '<span></span>').join('')}</div></div>`;
}

function renderDashboardTabs(mode) {
  return `<div class="dashboard-tabs tabs" role="tablist" aria-label="대시보드 기간"><button type="button" class="tab-button ${mode === 'daily' ? 'active' : ''}" data-dashboard-mode="daily" role="tab" aria-selected="${mode === 'daily'}">일간</button><button type="button" class="tab-button ${mode === 'weekly' ? 'active' : ''}" data-dashboard-mode="weekly" role="tab" aria-selected="${mode === 'weekly'}">주간</button></div>`;
}

export function renderDashboardHtml(model) {
  const mode = model.mode === 'weekly' ? 'weekly' : 'daily';
  if (mode === 'weekly') {
    const previousDisabled = !model.previousWeekStart;
    const nextDisabled = !model.nextWeekStart;
    return `${renderDashboardTabs(mode)}<div class="period-navigation"><button type="button" class="secondary-button" data-week-direction="prev" ${previousDisabled ? 'disabled aria-disabled="true"' : 'aria-disabled="false"'}>전주</button><strong>${escapeHtml(model.weekRangeLabel || model.selectedWeekStart)}</strong><button type="button" class="secondary-button" data-week-direction="next" ${nextDisabled ? 'disabled aria-disabled="true"' : 'aria-disabled="false"'}>다음 주</button></div>${renderSummaryCards(model.weeklySummary, '주간 예산')}${renderCategorySummary(model.weeklySummary)}`;
  }
  const previousDisabled = !model.previousDate;
  const nextDisabled = model.selectedDate >= model.today;
  return `${renderDashboardTabs(mode)}<div class="period-navigation daily-navigation"><button type="button" class="secondary-button" data-date-direction="prev" ${previousDisabled ? 'disabled' : ''}>전날</button><strong>${escapeHtml(model.selectedDate)}</strong><button type="button" class="secondary-button" data-date-direction="next" ${nextDisabled ? 'disabled' : ''}>다음날</button><button type="button" class="text-button today-button" data-dashboard-today ${model.selectedDate === model.today ? 'disabled' : ''}>오늘</button></div><div class="daily-dashboard-layout"><div>${renderSummaryCards(model.dailySummary, '적용 예산')}${renderCategorySummary(model.dailySummary)}</div>${renderCalendar(model)}</div>`;
}

export function bindDashboardControls({ root, state, rerender, onPreviousDate, onNextDate, onSelectDate, onCalendarMove, onWeekMove }) {
  root.querySelectorAll('[data-dashboard-mode]').forEach((button) => button.addEventListener('click', () => {
    state.mode = button.dataset.dashboardMode;
    rerender();
  }));
  root.querySelector('[data-date-direction="prev"]')?.addEventListener('click', onPreviousDate);
  root.querySelector('[data-date-direction="next"]')?.addEventListener('click', onNextDate);
  root.querySelector('[data-dashboard-today]')?.addEventListener('click', () => onSelectDate(state.today));
  root.querySelectorAll('[data-dashboard-date]').forEach((button) => button.addEventListener('click', () => onSelectDate(button.dataset.dashboardDate)));
  root.querySelectorAll('[data-calendar-direction]').forEach((button) => button.addEventListener('click', () => onCalendarMove(button.dataset.calendarDirection)));
  root.querySelectorAll('[data-week-direction]').forEach((button) => button.addEventListener('click', () => onWeekMove(button.dataset.weekDirection)));
}
