import {
  calculateRecordedMonthAverage,
  detailedRecordedMonthlyBudgetComparison,
  detailedRecordedYearlyBudgetComparison,
  formatMinutes,
  getWeekRange,
  summarizeRecordedMonthlyBudgetPeriod,
  summarizeRecordedYearlyBudgetPeriod,
  summarizeWeeklyBudgetPeriod,
} from './domain.js';
import {
  buildRecordedPeriodIndex,
  monthOptionStates,
  nextRecordedPeriodOrCurrent,
  previousRecordedPeriod,
  recordedYearOptions,
} from './recorded-period-domain.js';

const MODE_LABELS = Object.freeze({
  weekly: '주별 통계',
  monthly: '월간 통계',
  yearly: '연간 통계',
  'monthly-comparison': '월간 비교',
  'yearly-comparison': '연도별 비교',
});

const escapeHtml = (value = '') => String(value).replace(/[&<>'"]/g, (character) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;',
}[character]));

function dateKey(date) {
  const pad = (value) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function mergeCategories(data) {
  const map = new Map();
  (data?.archivedCategories || []).forEach((category) => map.set(category.id, category));
  (data?.activeCategories || []).forEach((category) => map.set(category.id, category));
  return [...map.values()];
}

function achievementText(summary) {
  if ((Number(summary?.totalBudgetMinutes) || 0) === 0
      && (Number(summary?.totalActualMinutes) || 0) === 0) return '—';
  if (summary?.goalComplianceStatus === 'excluded') return '계산 제외';
  return `${summary?.goalComplianceScore ?? 0}점`;
}

function differenceText(item) {
  if (!item?.hasBudget) return '달성률 계산 제외';
  if (item.goalType === 'restraint') {
    if (item.status === 'overage') return `${formatMinutes(item.differenceMinutes)} 초과 사용`;
    if (item.status === 'exact') return '예산 소진';
    return `${formatMinutes(Math.abs(item.differenceMinutes))} 남음`;
  }
  const difference = Number(item.differenceMinutes) || 0;
  if (difference > 0) return `${formatMinutes(difference)} 초과 달성`;
  if (difference < 0) return `${formatMinutes(Math.abs(difference))} 남음`;
  return '예산과 일치';
}

function changeText(item) {
  if (item.changeMinutes === null || item.changeMinutes === undefined) return '—';
  const sign = item.changeMinutes > 0 ? '+' : item.changeMinutes < 0 ? '-' : '';
  const time = `${sign}${formatMinutes(Math.abs(item.changeMinutes))}`;
  if (item.changePercentage === null) return `${time} (신규)`;
  return `${time} (${item.changePercentage > 0 ? '+' : ''}${item.changePercentage}%)`;
}

function headerText(state) {
  if (state.mode === 'weekly') {
    const range = getWeekRange(new Date(`${state.weekStart}T12:00:00`));
    return `${range.start} — ${range.end} · 주별 예산 대비 통계`;
  }
  if (state.mode === 'monthly') return `${state.year}년 ${state.month}월 · 예산 대비 통계`;
  if (state.mode === 'yearly') return `${state.year}년 · 예산 대비 통계`;
  if (state.mode === 'monthly-comparison') return `${state.year}년 기록 월 비교 · 예산 대비 통계`;
  return '전체 연도 비교 · 예산 대비 통계';
}

export function buildStatisticsViewModel(state, { now = new Date() } = {}) {
  if (!state?.data) throw new Error('통계 데이터가 준비되지 않았습니다.');
  const data = state.data;
  const entries = data.entries || [];
  const categories = mergeCategories(data);
  const budgets = data.weeklyBudgets || [];
  const currentDateKey = dateKey(now);
  const currentWeekStart = getWeekRange(now).start;
  const periods = buildRecordedPeriodIndex(entries, currentDateKey);
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth() + 1;
  const activeIds = new Set((data.activeCategories || []).map((category) => category.id));
  let summary = null;
  let comparison = null;
  let categoryTitle = '';
  let comparisonKind = '';

  if (state.mode === 'weekly') {
    summary = summarizeWeeklyBudgetPeriod(entries, categories, budgets, state.weekStart);
    categoryTitle = '대분류별 주간 예산 달성';
  }
  if (state.mode === 'monthly') {
    summary = summarizeRecordedMonthlyBudgetPeriod(entries, categories, budgets, state.year, state.month);
    categoryTitle = '대분류별 월간 예산 달성';
  }
  if (state.mode === 'yearly') {
    summary = summarizeRecordedYearlyBudgetPeriod(entries, categories, budgets, state.year);
    categoryTitle = '대분류별 연간 예산 달성';
  }
  if (state.mode === 'monthly-comparison') {
    comparison = detailedRecordedMonthlyBudgetComparison(entries, categories, budgets, state.year);
    comparisonKind = 'monthly';
  }
  if (state.mode === 'yearly-comparison') {
    comparison = detailedRecordedYearlyBudgetComparison(entries, categories, budgets);
    comparisonKind = 'yearly';
  }

  const weekRange = state.mode === 'weekly'
    ? getWeekRange(new Date(`${state.weekStart}T12:00:00`))
    : null;
  const previousWeekStart = state.mode === 'weekly'
    ? previousRecordedPeriod(periods.weekStarts, state.weekStart)
    : null;
  const nextWeekStart = state.mode === 'weekly'
    ? nextRecordedPeriodOrCurrent(periods.weekStarts, state.weekStart, currentWeekStart)
    : null;
  const years = recordedYearOptions(periods.years, currentYear);
  if (!years.includes(state.year) && state.year <= currentYear) years.push(state.year);
  years.sort((left, right) => right - left);
  const months = state.mode === 'monthly'
    ? monthOptionStates({
      recordedMonths: periods.months,
      year: state.year,
      currentYear,
      currentMonth,
    }).map((option) => ({ ...option, disabled: !option.enabled }))
    : [];

  const categoryRows = summary
    ? summary.categorySummaries.filter((item) => (
      activeIds.has(item.id) || item.budgetMinutes > 0 || item.actualMinutes > 0
    ))
    : [];

  return {
    mode: state.mode,
    modeLabel: MODE_LABELS[state.mode] || '통계',
    tabs: Object.entries(MODE_LABELS).map(([mode, label]) => ({ mode, label, active: mode === state.mode })),
    source: state.source,
    warning: state.warning || '',
    headerText: headerText(state),
    year: state.year,
    month: state.month,
    yearOptions: years,
    monthOptions: months,
    weekRange,
    previousWeekStart,
    nextWeekStart,
    summary: summary ? {
      ...summary,
      achievementText: achievementText(summary),
      monthlyAverageMinutes: state.mode === 'yearly'
        ? calculateRecordedMonthAverage(summary.totalActualMinutes, summary.recordMonthCount)
        : null,
    } : null,
    categoryTitle,
    categoryRows,
    comparison,
    comparisonKind,
  };
}

function tabsHtml(model) {
  return `<div class="statistics-tabs">${model.tabs.map((tab) => (
    `<button class="tab-button ${tab.active ? 'active' : ''}" data-statistics-mode="${tab.mode}" type="button">${tab.label}</button>`
  )).join('')}</div>`;
}

function controlsHtml(model) {
  if (model.mode === 'weekly') {
    return `<div class="week-navigation"><button class="secondary-button" data-statistics-week="previous" type="button" ${model.previousWeekStart ? '' : 'disabled aria-disabled="true"'}>← 이전 주</button><strong class="week-range">${model.weekRange.start} ~ ${model.weekRange.end}</strong><button class="secondary-button" data-statistics-week="next" type="button" ${model.nextWeekStart ? '' : 'disabled aria-disabled="true"'}>다음 주 →</button></div>`;
  }
  if (model.mode === 'yearly-comparison') return '';
  const year = `<label>연도<select id="statistics-year">${model.yearOptions.map((value) => (
    `<option value="${value}" ${value === model.year ? 'selected' : ''}>${value}년</option>`
  )).join('')}</select></label>`;
  const month = model.mode === 'monthly'
    ? `<label>월<select id="statistics-month">${model.monthOptions.map((option) => (
      `<option value="${option.month}" ${option.month === model.month ? 'selected' : ''} ${option.disabled ? 'disabled aria-disabled="true" class="is-unavailable"' : ''}>${option.month}월${option.current ? ' · 이번 달' : ''}</option>`
    )).join('')}</select></label>`
    : '';
  return `<div class="statistics-controls">${year}${month}</div>`;
}

function noticeHtml(model) {
  if (model.warning) {
    return `<div class="statistics-rescue-banner warning">${escapeHtml(model.warning)}<div class="statistics-rescue-actions"><button data-statistics-retry class="secondary-button" type="button">통계를 다시 불러오기</button></div></div>`;
  }
  const message = model.source === 'cache'
    ? '기기에 저장된 자료를 먼저 표시하고 있습니다. 서버 연결 후 최신 자료로 자동 갱신됩니다.'
    : '서버의 최신 자료로 통계를 표시하고 있습니다.';
  return `<div class="statistics-rescue-banner">${message}</div>`;
}

function summaryCardsHtml(model) {
  const summary = model.summary;
  if (!summary) return '';
  return `<div class="statistics-summary">
    <article class="card"><p class="muted">기간 예산</p><div class="metric">${formatMinutes(summary.totalBudgetMinutes)}</div></article>
    <article class="card"><p class="muted">실제 기록</p><div class="metric">${formatMinutes(summary.totalActualMinutes)}</div></article>
    <article class="card"><p class="muted">목표 준수</p><div class="metric">${summary.achievementText}</div><p class="stat-card-note">실제 기록과 예산 합계는 별도 시간 지표입니다.</p></article>
    <article class="card"><p class="muted">기록 일수</p><div class="metric">${summary.recordDays || 0}일</div></article>
    <article class="card"><p class="muted">기록한 날 기준 하루 평균</p><div class="metric">${formatMinutes(summary.dailyAverageMinutes)}</div></article>
    ${model.mode === 'yearly' ? `<article class="card"><p class="muted">기록이 있는 달 기준 월평균</p><div class="metric">${formatMinutes(summary.monthlyAverageMinutes)}</div></article>` : ''}
  </div>`;
}

function categoryTableHtml(model) {
  if (!model.summary) return '';
  const rows = model.categoryRows;
  return `<div class="card statistics-card"><div class="section-title"><h2>${model.categoryTitle}</h2><span class="badge">${rows.length}개</span></div>
    ${rows.length ? `<div class="statistics-table-wrap"><table class="statistics-rescue-table"><thead><tr><th>대분류</th><th>기간 예산</th><th>실제 기록</th><th>달성률</th><th>차이</th></tr></thead><tbody>${rows.map((row) => `<tr>
      <td data-label="대분류"><strong>${escapeHtml(row.name)}</strong></td>
      <td data-label="기간 예산">${formatMinutes(row.budgetMinutes)}</td>
      <td data-label="실제 기록">${formatMinutes(row.actualMinutes)}</td>
      <td data-label="달성률">${row.hasBudget ? `${row.percentage}%` : '달성률 계산 제외'}</td>
      <td data-label="차이">${differenceText(row)}</td>
    </tr>`).join('')}</tbody></table></div>` : '<div class="empty-statistics">해당 기간에 표시할 통계가 없습니다.</div>'}
  </div>`;
}

function comparisonHtml(model) {
  const rows = model.comparison || [];
  if (!model.comparison) return '';
  if (!rows.length) return '<div class="card statistics-card"><div class="empty-statistics">비교할 기록이 없습니다.</div></div>';
  const monthly = model.comparisonKind === 'monthly';
  const changeLabel = monthly ? '전월 대비' : '전년 대비';
  return `<div class="card statistics-card"><div class="section-title"><h2>기간별 예산과 실제 기록</h2></div><div class="statistics-table-wrap">
    <table class="statistics-rescue-table"><thead><tr><th>기간</th><th>기간 예산</th><th>실제 기록</th><th>목표 준수</th><th>기록 일수</th><th>${changeLabel}</th></tr></thead><tbody>${rows.map((item) => `<tr>
      <td data-label="기간"><strong>${monthly ? `${item.month}월` : `${item.year}년`}</strong></td>
      <td data-label="기간 예산">${formatMinutes(item.totalBudgetMinutes)}</td>
      <td data-label="실제 기록">${formatMinutes(item.totalActualMinutes)}</td>
      <td data-label="목표 준수">${achievementText(item)}</td>
      <td data-label="기록 일수">${item.recordDays || 0}일</td>
      <td data-label="${changeLabel}">${changeText(item)}</td>
    </tr>`).join('')}</tbody></table></div>
  </div>`;
}

export function renderStatisticsHtml(model) {
  return `<div data-statistics-feature data-statistics-mode="${model.mode}">${tabsHtml(model)}${controlsHtml(model)}${noticeHtml(model)}${summaryCardsHtml(model)}${categoryTableHtml(model)}${comparisonHtml(model)}</div>`;
}

export function renderStatisticsFailure({ mode, stage, message }) {
  const label = MODE_LABELS[mode] || '통계';
  return `<div class="card statistics-error" data-statistics-error><h2>${label}를 표시하지 못했습니다.</h2><p class="warning">문제가 발생한 단계: ${escapeHtml(stage || '알 수 없음')}</p><p class="muted">${escapeHtml(message || '통계 자료를 처리하지 못했습니다.')}</p><button data-statistics-retry class="primary-button" type="button">다시 시도</button></div>`;
}
