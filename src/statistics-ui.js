import { firebaseConfig } from '../firebase-config.js';
import {
  calculateRecordedMonthAverage,
  detailedRecordedMonthlyBudgetComparison,
  detailedRecordedYearlyBudgetComparison,
  formatMinutes,
  getWeekRange,
  moveWeekStart,
  summarizeRecordedMonthlyBudgetPeriod,
  summarizeRecordedYearlyBudgetPeriod,
  summarizeWeeklyBudgetPeriod,
} from './domain.js';
import { categoryDisplayName } from './goal-domain.js';

const appModule = await import('https://www.gstatic.com/firebasejs/11.10.0/firebase-app.js');
const authModule = await import('https://www.gstatic.com/firebasejs/11.10.0/firebase-auth.js');
const storeModule = await import('https://www.gstatic.com/firebasejs/11.10.0/firebase-firestore.js');
const app = appModule.getApps().length ? appModule.getApp() : appModule.initializeApp(firebaseConfig);
const auth = authModule.getAuth(app);
const db = storeModule.getFirestore(app);

const TIMER_KEY = 'weekly-time-budget:last-timer-category';
const MANUAL_KEY = 'weekly-time-budget:last-manual-category';
const now = new Date();
const currentWeekStart = getWeekRange(now).start;
const statisticsState = {
  mode: 'weekly',
  weekStart: currentWeekStart,
  year: now.getFullYear(),
  month: now.getMonth() + 1,
  entries: [],
  activeCategories: [],
  archivedCategories: [],
  weeklyBudgets: [],
};
let renderingStatistics = false;
let patchScheduled = false;

const escapeHtml = (value = '') => String(value).replace(/[&<>'"]/g, (char) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;',
}[char]));

function selectedWeekRange() {
  return getWeekRange(new Date(`${statisticsState.weekStart}T12:00:00`));
}

function injectStyles() {
  if (document.querySelector('#statistics-ui-styles')) return;
  const style = document.createElement('style');
  style.id = 'statistics-ui-styles';
  style.textContent = `
    .statistics-tabs{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:18px}
    .statistics-controls{display:flex;gap:12px;align-items:end;flex-wrap:wrap;margin-bottom:18px}
    .statistics-controls label{display:grid;gap:6px;font-weight:700}
    .statistics-controls select{border:1px solid #cdd5d0;border-radius:12px;padding:10px 12px;background:#fff;font:inherit}
    .week-navigation{display:grid;grid-template-columns:auto minmax(210px,1fr) auto;gap:12px;align-items:center;margin-bottom:18px}
    .week-navigation .week-range{padding:11px 14px;border:1px solid #d7ddd8;border-radius:12px;background:#fffdf7;text-align:center}
    .week-navigation button{white-space:nowrap}
    .statistics-summary{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:16px;margin-bottom:18px}
    .stat-card-note{font-size:.78rem;color:#77817d;margin-top:7px}
    .statistics-card{margin-top:18px}
    .statistics-explanation{margin:0 0 14px;color:#68736e;font-size:.9rem;line-height:1.6}
    .achievement-cell{min-width:160px}
    .achievement-line{display:grid;grid-template-columns:minmax(80px,1fr) 52px;align-items:center;gap:7px}
    .stat-bar-track{height:12px;background:#e7ebe5;border-radius:999px;overflow:hidden}
    .stat-bar-fill{height:100%;background:#2b7665;border-radius:inherit;min-width:0}
    .stat-bar-fill.over{background:#a15f31}
    .stat-bar-fill.unbudgeted{background:#a8afa9}
    .stat-bar-fill.restraint-remaining{background:#2f6fb2}
    .stat-bar-fill.restraint-overage{background:#c23b36}
    .stat-bar-fill.restraint-exact{width:0!important}
    .difference.remaining{color:#64716c}.difference.exceeded{color:#9a4d2f}.difference.unbudgeted{color:#876a28}
    .statistics-table-wrap{overflow-x:auto;margin-top:14px;max-width:100%}
    .statistics-table{width:100%;border-collapse:collapse;min-width:620px;table-layout:auto}
    .statistics-table th,.statistics-table td{padding:9px 7px;border-bottom:1px solid #e1e4de;text-align:right;white-space:normal;vertical-align:middle;font-size:.9rem}
    .statistics-table th:first-child,.statistics-table td:first-child{text-align:left;position:sticky;left:0;min-width:88px;background:#fffdf7;z-index:1}
    .statistics-table thead th{font-size:.8rem;color:#68736e;background:#f3f3ed}
    .statistics-table thead th:first-child{background:#f3f3ed}
    .comparison-list{display:grid;gap:18px;margin-top:14px}
    .comparison-row{display:grid;grid-template-columns:64px minmax(220px,1fr) minmax(160px,auto);gap:14px;align-items:center}
    .comparison-bars{display:grid;gap:7px}
    .comparison-bar-line{display:grid;grid-template-columns:42px 1fr;gap:8px;align-items:center;font-size:.8rem;color:#68736e}
    .comparison-bar-line.actual .stat-bar-fill{background:#2b7665}
    .comparison-bar-line.budget .stat-bar-fill{background:#8aa49c}
    .comparison-values{display:grid;gap:3px;text-align:right;font-size:.85rem}
    .comparison-change{font-size:.78rem;color:#75827d}.comparison-change.positive{color:#24705f}.comparison-change.negative{color:#9a3c2f}
    .matrix-cell{display:grid;gap:2px;min-width:118px}.matrix-cell small{color:#75827d}.matrix-cell strong{font-size:.86rem}
    .empty-statistics{padding:34px 10px;text-align:center;color:#78817d}
    .statistics-note{margin-top:14px;padding:12px 14px;border-radius:12px;background:#f2f3ed;color:#65706b;font-size:.84rem;line-height:1.55}
    @media(max-width:800px){
      .statistics-tabs{gap:6px}
      .statistics-tabs .tab-button{flex:1 1 calc(50% - 6px);padding:9px 8px}
      .statistics-controls>*{flex:1;min-width:120px}
      .week-navigation{grid-template-columns:1fr 1fr}
      .week-navigation .week-range{grid-column:1/-1;grid-row:1}
      .statistics-summary{grid-template-columns:1fr 1fr;gap:10px}
      .statistics-summary .card{padding:14px}
      .statistics-card{padding:16px}
      .statistics-explanation,.statistics-note{font-size:.82rem}
      .comparison-row{grid-template-columns:1fr}
      .comparison-values{text-align:left}
      .statistics-table-wrap{overflow-x:visible;margin-top:12px}
      .statistics-table{display:block;width:100%;min-width:0}
      .statistics-table thead{display:none}
      .statistics-table tbody{display:grid;gap:12px;width:100%}
      .statistics-table tr{display:grid;width:100%;padding:14px;border:1px solid #dde3de;border-radius:14px;background:#fffdf7;box-sizing:border-box}
      .statistics-table td,.statistics-table td:first-child{position:static;display:grid;grid-template-columns:minmax(92px,38%) minmax(0,1fr);gap:10px;align-items:center;width:100%;min-width:0;padding:8px 0;border:0;border-bottom:1px solid #edf0ec;text-align:right;white-space:normal;font-size:.875rem;background:transparent}
      .statistics-table td:last-child{border-bottom:0}
      .statistics-table td::before{content:attr(data-label);color:#6d7873;font-size:.8rem;font-weight:700;text-align:left}
      .statistics-table .statistics-card-title{display:block;padding:0 0 10px;margin-bottom:2px;border-bottom:1px solid #dfe4df;text-align:left;font-size:1rem}
      .statistics-table .statistics-card-title::before{display:none}
      .achievement-cell{min-width:0}
      .achievement-line{grid-template-columns:minmax(0,1fr) 52px;width:100%}
      .matrix-cell{min-width:0;text-align:right;white-space:normal}
      .statistics-matrix-table td:not(.statistics-card-title){align-items:start}
      .statistics-matrix-total{margin-top:4px;padding-top:11px!important;border-top:1px solid #d7ddd8!important}
    }
    @media(max-width:360px){
      .statistics-summary{grid-template-columns:1fr}
    }
  `;
  document.head.append(style);
}

function rememberSelections(event) {
  const timerButton = event.target.closest?.('#timer-action');
  if (timerButton) {
    const select = document.querySelector('#timer-category');
    if (select?.value) localStorage.setItem(TIMER_KEY, select.value);
  }
  if (event.type === 'submit' && event.target.matches?.('#manual-form')) {
    const select = event.target.querySelector('#manual-category');
    if (select?.value) localStorage.setItem(MANUAL_KEY, select.value);
  }
}

document.addEventListener('click', rememberSelections, true);
document.addEventListener('submit', rememberSelections, true);

function restoreSelect(selector, storageKey) {
  const select = document.querySelector(selector);
  if (!select || select.disabled) return;
  const saved = localStorage.getItem(storageKey);
  if (!saved) return;
  const option = [...select.options].find((item) => item.value === saved);
  if (option && select.value !== saved) select.value = saved;
  else if (!option) localStorage.removeItem(storageKey);
}

function patchSundayCopy() {
  const loginText = document.querySelector('#login-view .login-card > p:not(.eyebrow):not(.warning)');
  const expected = '월요일부터 주일까지 실제 사용 시간을 기록하고, 삶의 중요한 영역에 시간을 충분히 배정했는지 확인합니다.';
  if (loginText && loginText.textContent !== expected) loginText.textContent = expected;
  const weekLabel = document.querySelector('#week-label');
  if (weekLabel?.textContent.includes('월~토')) weekLabel.textContent = weekLabel.textContent.replace('월~토', '월~주일');
}

function statisticsHeaderText() {
  if (statisticsState.mode === 'weekly') {
    const range = selectedWeekRange();
    return `${range.start} — ${range.end} · 주별 예산 대비 통계`;
  }
  if (statisticsState.mode === 'monthly') return `${statisticsState.year}년 ${statisticsState.month}월 · 예산 대비 통계`;
  if (statisticsState.mode === 'yearly') return `${statisticsState.year}년 · 예산 대비 통계`;
  if (statisticsState.mode === 'monthly-comparison') return `${statisticsState.year}년 기록 월 비교 · 예산 대비 통계`;
  return '전체 연도 비교 · 예산 대비 통계';
}

function updateStatisticsHeader() {
  const label = document.querySelector('#week-label');
  if (label) label.textContent = statisticsHeaderText();
}

function restoreWeeklyHeader() {
  const range = getWeekRange();
  const label = document.querySelector('#week-label');
  if (label) label.textContent = `${range.start} — ${range.end} · 월~주일`;
}

function showStatisticsView(button) {
  document.querySelectorAll('.view').forEach((view) => view.classList.add('hidden'));
  document.querySelector('#statistics-view')?.classList.remove('hidden');
  document.querySelectorAll('.nav-button').forEach((item) => item.classList.remove('active'));
  button.classList.add('active');
  const title = document.querySelector('#page-title');
  if (title) title.textContent = '통계';
  document.querySelector('.sidebar')?.classList.remove('open');
  updateStatisticsHeader();
  renderStatistics();
}

function ensureStatisticsNavigation() {
  const nav = document.querySelector('.sidebar nav');
  if (!nav) return;
  let button = nav.querySelector('[data-view="statistics"]');
  if (!button) {
    button = document.createElement('button');
    button.className = 'nav-button';
    button.dataset.view = 'statistics';
    button.textContent = '통계';
    nav.insertBefore(button, nav.querySelector('[data-view="categories"]'));
  }
  if (button.dataset.statisticsBound !== 'true') {
    button.dataset.statisticsBound = 'true';
    button.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopImmediatePropagation();
      showStatisticsView(button);
    }, true);
  }
}

// 기록 내역을 포함한 다른 메뉴에서는 통계 내용과 통계 기간 제목을 모두 숨긴다.
document.addEventListener('click', (event) => {
  const navButton = event.target.closest('.nav-button');
  if (!navButton || navButton.dataset.view === 'statistics') return;
  document.querySelector('#statistics-view')?.classList.add('hidden');
  restoreWeeklyHeader();
}, true);

function allCategories() {
  const map = new Map();
  statisticsState.archivedCategories.forEach((category) => map.set(category.id, category));
  statisticsState.activeCategories.forEach((category) => map.set(category.id, category));
  return [...map.values()];
}

function visibleCategorySummaries(summary) {
  const activeIds = new Set(statisticsState.activeCategories.map((category) => category.id));
  return summary.categorySummaries.filter((item) => activeIds.has(item.id) || item.budgetMinutes > 0 || item.actualMinutes > 0);
}

function achievementText(item) {
  if (!item?.hasBudget) return '달성률 계산 제외';
  return `${item.percentage}%`;
}

function achievementWidth(item) {
  return Number(item?.progress?.fillPercentage) || 0;
}

function achievementBarClass(item) {
  const mode = item?.progress?.mode;
  if (mode === 'remaining') return 'restraint-remaining';
  if (mode === 'overage') return 'restraint-overage';
  if (mode === 'exact') return 'restraint-exact';
  if (mode === 'excluded') return 'unbudgeted';
  return item?.status === 'exceeded' ? 'over' : '';
}

function differenceText(item) {
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

function differenceClass(item) {
  if (!item?.hasBudget) return 'unbudgeted';
  if (item.goalType === 'restraint' && item.status === 'overage') return 'overage';
  return item.differenceMinutes > 0 ? 'exceeded' : 'remaining';
}

function overallAchievementText(summary) {
  if (summary?.goalComplianceStatus === 'excluded') return '계산 제외';
  return `${summary?.goalComplianceScore ?? 0}점`;
}

function summaryCards(summary, yearly = false) {
  const monthlyAverage = yearly
    ? calculateRecordedMonthAverage(summary.totalActualMinutes, summary.recordMonthCount)
    : null;
  return `
    <div class="statistics-summary">
      <article class="card"><p class="muted">기간 예산</p><div class="metric">${formatMinutes(summary.totalBudgetMinutes)}</div></article>
      <article class="card"><p class="muted">실제 기록</p><div class="metric">${formatMinutes(summary.totalActualMinutes)}</div></article>
      <article class="card"><p class="muted">목표 준수</p><div class="metric">${overallAchievementText(summary)}</div><p class="stat-card-note">실제 기록과 예산 합계는 별도 시간 지표입니다.</p></article>
      <article class="card"><p class="muted">기록 일수</p><div class="metric">${summary.recordDays}일</div></article>
      <article class="card"><p class="muted">기록한 날 기준 하루 평균</p><div class="metric">${formatMinutes(summary.dailyAverageMinutes)}</div></article>
      ${yearly ? `<article class="card"><p class="muted">기록이 있는 달 기준 월평균 기록 시간</p><div class="metric">${formatMinutes(monthlyAverage)}</div><p class="stat-card-note">${summary.recordMonthCount || 0}개월 기록 기준</p></article>` : ''}
    </div>`;
}

function categoryAchievementTable(summary, title, note) {
  const rows = visibleCategorySummaries(summary);
  return `
    <div class="card statistics-card">
      <div class="section-title"><h2>${title}</h2><span class="badge">${rows.length}개</span></div>
      <p class="statistics-explanation">성장 목표는 많이 기록할수록 높아지고, 절제 목표는 예산 안에서 100~200%, 초과하면 음수로 표시합니다.</p>
      ${rows.length ? `<div class="statistics-table-wrap"><table class="statistics-table">
        <thead><tr><th>대분류</th><th>기간 예산</th><th>실제 기록</th><th>달성률</th><th>차이</th></tr></thead>
        <tbody>${rows.map((row) => `<tr>
          <td data-label="대분류" class="statistics-card-title"><strong>${escapeHtml(row.name)}</strong></td>
          <td data-label="기간 예산">${formatMinutes(row.budgetMinutes)}</td>
          <td data-label="실제 기록">${formatMinutes(row.actualMinutes)}</td>
          <td data-label="달성률" class="achievement-cell"><div class="achievement-line"><div class="stat-bar-track"><div class="stat-bar-fill ${achievementBarClass(row)}" style="width:${achievementWidth(row)}%"></div></div><strong>${achievementText(row)}</strong></div></td>
          <td data-label="차이"><span class="difference ${differenceClass(row)}">${differenceText(row)}</span></td>
        </tr>`).join('')}</tbody>
      </table></div>` : '<div class="empty-statistics">해당 기간에 표시할 대분류가 없습니다.</div>'}
      <div class="statistics-note">${note}</div>
    </div>`;
}

function emptyPeriodNotice(message) {
  return `<div class="card statistics-card"><div class="empty-statistics">${message}</div></div>`;
}

function formatChange(item) {
  if (item.changeMinutes === null || item.changeMinutes === undefined) return '—';
  const sign = item.changeMinutes > 0 ? '+' : item.changeMinutes < 0 ? '-' : '';
  const time = `${sign}${formatMinutes(Math.abs(item.changeMinutes))}`;
  if (item.changePercentage === null) return `${time} (신규)`;
  const rateSign = item.changePercentage > 0 ? '+' : '';
  return `${time} (${rateSign}${item.changePercentage}%)`;
}

function comparisonChart(items, labelKey, labelFormatter, changeLabel) {
  const max = Math.max(1, ...items.flatMap((item) => [item.totalBudgetMinutes, item.totalActualMinutes]));
  const hasData = items.some((item) => item.totalBudgetMinutes > 0 || item.totalActualMinutes > 0);
  if (!hasData) return emptyPeriodNotice('비교할 예산과 기록이 없습니다.');
  return `<div class="card statistics-card"><div class="section-title"><h2>기간별 예산과 실제 기록</h2></div>
    <p class="statistics-explanation">회색 막대는 기간 예산, 초록 막대는 실제 기록입니다.</p>
    <div class="comparison-list">${items.map((item) => {
      const changeClass = Number(item.changeMinutes) > 0 ? 'positive' : Number(item.changeMinutes) < 0 ? 'negative' : '';
      return `<div class="comparison-row">
        <strong>${labelFormatter(item[labelKey])}</strong>
        <div class="comparison-bars">
          <div class="comparison-bar-line budget"><span>예산</span><div class="stat-bar-track"><div class="stat-bar-fill" style="width:${item.totalBudgetMinutes / max * 100}%"></div></div></div>
          <div class="comparison-bar-line actual"><span>실제</span><div class="stat-bar-track"><div class="stat-bar-fill" style="width:${item.totalActualMinutes / max * 100}%"></div></div></div>
        </div>
        <div class="comparison-values"><span>예산 ${formatMinutes(item.totalBudgetMinutes)}</span><strong>실제 ${formatMinutes(item.totalActualMinutes)} · ${overallAchievementText(item)}</strong><span class="comparison-change ${changeClass}">${changeLabel} ${formatChange(item)}</span></div>
      </div>`;
    }).join('')}</div></div>`;
}

function comparisonChangeCell(item, changeLabel) {
  if (changeLabel === '전월 대비') return `<td data-label="전월 대비">${formatChange(item)}</td>`;
  return `<td data-label="전년 대비">${formatChange(item)}</td>`;
}

function comparisonDetailTable(items, labelKey, labelFormatter, changeLabel) {
  if (!items.length) return '';
  return `<div class="card statistics-card"><div class="section-title"><h2>기간별 상세 비교</h2></div>
    <div class="statistics-table-wrap"><table class="statistics-table">
      <thead><tr><th>기간</th><th>기간 예산</th><th>실제 기록</th><th>목표 준수</th><th>기록 일수</th><th>하루 평균</th><th>${changeLabel}</th></tr></thead>
      <tbody>${items.map((item) => `<tr>
        <td data-label="기간" class="statistics-card-title"><strong>${labelFormatter(item[labelKey])}</strong></td>
        <td data-label="기간 예산">${formatMinutes(item.totalBudgetMinutes)}</td>
        <td data-label="실제 기록">${formatMinutes(item.totalActualMinutes)}</td>
        <td data-label="목표 준수">${overallAchievementText(item)}</td>
        <td data-label="기록 일수">${item.recordDays}일</td>
        <td data-label="하루 평균">${formatMinutes(item.dailyAverageMinutes)}</td>
        ${comparisonChangeCell(item, changeLabel)}
      </tr>`).join('')}</tbody>
    </table></div></div>`;
}

function categoryBudgetMatrix(items, labelKey, labelFormatter, title) {
  const activeOrder = statisticsState.activeCategories.map((category) => category.id);
  const allIds = new Set(items.flatMap((item) => item.categorySummaries.map((category) => category.id)));
  const orderedIds = [
    ...activeOrder.filter((id) => allIds.has(id)),
    ...[...allIds].filter((id) => !activeOrder.includes(id)),
  ];
  const categoryById = new Map(allCategories().map((category) => [category.id, category]));
  if (!orderedIds.length) return '';
  return `<div class="card statistics-card"><div class="section-title"><h2>${title}</h2></div>
    <p class="statistics-explanation">각 칸은 실제 기록 / 기간 예산과 달성률을 표시합니다.</p>
    <div class="statistics-table-wrap"><table class="statistics-table statistics-matrix-table">
      <thead><tr><th>기간</th>${orderedIds.map((id) => `<th>${escapeHtml(categoryById.get(id) ? categoryDisplayName(categoryById.get(id)) : '삭제된 대분류')}</th>`).join('')}<th>전체</th></tr></thead>
      <tbody>${items.map((item) => {
        const byId = new Map(item.categorySummaries.map((category) => [category.id, category]));
        return `<tr><td data-label="기간" class="statistics-card-title"><strong>${labelFormatter(item[labelKey])}</strong></td>${orderedIds.map((id) => {
          const categoryName = escapeHtml(categoryById.get(id) ? categoryDisplayName(categoryById.get(id)) : '삭제된 대분류');
          const category = byId.get(id);
          if (!category) {
            return `<td data-label="${categoryName}"><span class="muted">—</span></td>`;
          }
          return `<td data-label="${categoryName}"><div class="matrix-cell"><strong>${formatMinutes(category.actualMinutes)} / ${formatMinutes(category.budgetMinutes)}</strong><small>${achievementText(category)}</small></div></td>`;
        }).join('')}<td data-label="전체" class="statistics-matrix-total"><div class="matrix-cell"><strong>${formatMinutes(item.totalActualMinutes)} / ${formatMinutes(item.totalBudgetMinutes)}</strong><small>${overallAchievementText(item)}</small></div></td></tr>`;
      }).join('')}</tbody>
    </table></div></div>`;
}

function yearOptions() {
  const years = new Set([now.getFullYear(), statisticsState.year]);
  statisticsState.entries.forEach((entry) => {
    const year = Number(String(entry.date || '').slice(0, 4));
    if (Number.isFinite(year)) years.add(year);
  });
  return [...years].sort((a, b) => b - a).map((year) => `<option value="${year}" ${year === statisticsState.year ? 'selected' : ''}>${year}년</option>`).join('');
}

async function loadStatisticsData() {
  const user = auth.currentUser;
  if (!user) return false;
  const [entrySnapshot, activeSnapshot, archivedSnapshot, weeklyBudgetSnapshot] = await Promise.all([
    storeModule.getDocs(storeModule.query(storeModule.collection(db, 'users', user.uid, 'entries'), storeModule.orderBy('date', 'desc'))),
    storeModule.getDocs(storeModule.collection(db, 'users', user.uid, 'categories')),
    storeModule.getDocs(storeModule.collection(db, 'users', user.uid, 'archivedCategories')),
    storeModule.getDocs(storeModule.collection(db, 'users', user.uid, 'weeklyBudgets')),
  ]);
  statisticsState.entries = entrySnapshot.docs.map((docSnapshot) => ({ id: docSnapshot.id, ...docSnapshot.data() }));
  statisticsState.activeCategories = activeSnapshot.docs
    .map((docSnapshot, index) => ({ id: docSnapshot.id, sourceIndex: index, ...docSnapshot.data() }))
    .sort((a, b) => (Number(a.order) || 999999) - (Number(b.order) || 999999) || a.sourceIndex - b.sourceIndex);
  statisticsState.archivedCategories = archivedSnapshot.docs.map((docSnapshot) => ({ id: docSnapshot.id, ...docSnapshot.data() }));
  statisticsState.weeklyBudgets = weeklyBudgetSnapshot.docs.map((docSnapshot) => ({ id: docSnapshot.id, ...docSnapshot.data() }));
  return true;
}

function weeklyStatisticsHtml() {
  const summary = summarizeWeeklyBudgetPeriod(
    statisticsState.entries,
    allCategories(),
    statisticsState.weeklyBudgets,
    statisticsState.weekStart,
  );
  return `${summaryCards(summary)}${categoryAchievementTable(
    summary,
    '대분류별 주간 예산 달성',
    '선택한 주는 기록 여부와 관계없이 월요일부터 주일까지의 전체 주간 예산을 사용합니다. 별도의 주간 예산이 저장되지 않았다면 대분류의 기본 예산을 사용합니다.',
  )}`;
}

function monthlyStatisticsHtml() {
  const summary = summarizeRecordedMonthlyBudgetPeriod(
    statisticsState.entries,
    allCategories(),
    statisticsState.weeklyBudgets,
    statisticsState.year,
    statisticsState.month,
  );
  const empty = summary.recordWeekCount
    ? ''
    : emptyPeriodNotice('이 달에는 시간 기록이 없어 월간 예산 계산에서 포함할 주가 없습니다.');
  return `${summaryCards(summary)}${empty}${categoryAchievementTable(
    summary,
    '대분류별 월간 예산 달성',
    '이 달에 실제 기록이 있는 주의 예산만 합산합니다. 월 경계에 걸친 주는 해당 월 날짜 수만큼 7일로 나누며, 해당 월에 기록이 없으면 그 달의 배정 예산도 제외합니다.',
  )}`;
}

function yearlyStatisticsHtml() {
  const summary = summarizeRecordedYearlyBudgetPeriod(
    statisticsState.entries,
    allCategories(),
    statisticsState.weeklyBudgets,
    statisticsState.year,
  );
  const empty = summary.recordMonthCount
    ? ''
    : emptyPeriodNotice('이 연도에는 시간 기록이 없어 연간 예산 계산에서 포함할 달이 없습니다.');
  return `${summaryCards(summary, true)}${empty}${categoryAchievementTable(
    summary,
    '대분류별 연간 예산 달성',
    '실제 기록이 있는 달들의 월간 예산만 합산합니다. 각 월간 예산은 다시 그 달에 기록이 있는 주들의 실제 주간 예산을 합산한 값입니다.',
  )}`;
}

function monthlyComparisonHtml() {
  const items = detailedRecordedMonthlyBudgetComparison(
    statisticsState.entries,
    allCategories(),
    statisticsState.weeklyBudgets,
    statisticsState.year,
  );
  if (!items.length) return emptyPeriodNotice('선택한 연도에는 비교할 기록 월이 없습니다.');
  return `${comparisonChart(items, 'month', (month) => `${month}월`, '전월 대비')}${comparisonDetailTable(items, 'month', (month) => `${month}월`, '전월 대비')}${categoryBudgetMatrix(items, 'month', (month) => `${month}월`, '월별 대분류 예산·실제')}`;
}

function yearlyComparisonHtml() {
  const items = detailedRecordedYearlyBudgetComparison(
    statisticsState.entries,
    allCategories(),
    statisticsState.weeklyBudgets,
  );
  if (!items.length) return emptyPeriodNotice('비교할 연도별 기록이 없습니다.');
  return `${comparisonChart(items, 'year', (year) => `${year}년`, '전년 대비')}${comparisonDetailTable(items, 'year', (year) => `${year}년`, '전년 대비')}${categoryBudgetMatrix(items, 'year', (year) => `${year}년`, '연도별 대분류 예산·실제')}`;
}

function weeklyNavigationHtml() {
  const range = selectedWeekRange();
  const atCurrentWeek = statisticsState.weekStart >= currentWeekStart;
  return `<div class="week-navigation">
    <button type="button" class="secondary-button" data-week-offset="-1">← 이전 주</button>
    <strong class="week-range">${range.start} ~ ${range.end}</strong>
    <button type="button" class="secondary-button" data-week-offset="1" ${atCurrentWeek ? 'disabled' : ''}>다음 주 →</button>
  </div>`;
}

function statisticsControlsHtml(mode) {
  if (mode === 'weekly') return weeklyNavigationHtml();
  if (mode === 'yearly-comparison') return '';
  const needsMonth = mode === 'monthly';
  return `<div class="statistics-controls"><label>연도<select id="statistics-year">${yearOptions()}</select></label>${needsMonth ? `<label>월<select id="statistics-month">${Array.from({ length: 12 }, (_, index) => `<option value="${index + 1}" ${index + 1 === statisticsState.month ? 'selected' : ''}>${index + 1}월</option>`).join('')}</select></label>` : ''}</div>`;
}

async function renderStatistics() {
  const view = document.querySelector('#statistics-view');
  if (!view || renderingStatistics || !auth.currentUser) return;
  renderingStatistics = true;
  updateStatisticsHeader();
  view.innerHTML = '<div class="card"><h2>통계를 불러오는 중…</h2></div>';
  try {
    await loadStatisticsData();
    const mode = statisticsState.mode;
    const body = mode === 'weekly'
      ? weeklyStatisticsHtml()
      : mode === 'monthly'
        ? monthlyStatisticsHtml()
        : mode === 'yearly'
          ? yearlyStatisticsHtml()
          : mode === 'monthly-comparison'
            ? monthlyComparisonHtml()
            : yearlyComparisonHtml();

    view.innerHTML = `
      <div class="statistics-tabs">
        ${[['weekly','주별 통계'],['monthly','월간 통계'],['yearly','연간 통계'],['monthly-comparison','월간 비교'],['yearly-comparison','연도별 비교']].map(([value, label]) => `<button class="tab-button ${mode === value ? 'active' : ''}" data-stat-mode="${value}">${label}</button>`).join('')}
      </div>
      ${statisticsControlsHtml(mode)}
      ${body}`;

    view.querySelectorAll('[data-stat-mode]').forEach((button) => {
      button.onclick = () => {
        statisticsState.mode = button.dataset.statMode;
        updateStatisticsHeader();
        renderStatistics();
      };
    });
    view.querySelectorAll('[data-week-offset]').forEach((button) => {
      button.onclick = () => {
        statisticsState.weekStart = moveWeekStart(
          statisticsState.weekStart,
          Number(button.dataset.weekOffset),
          now,
        );
        updateStatisticsHeader();
        renderStatistics();
      };
    });
    view.querySelector('#statistics-year')?.addEventListener('change', (event) => {
      statisticsState.year = Number(event.target.value);
      updateStatisticsHeader();
      renderStatistics();
    });
    view.querySelector('#statistics-month')?.addEventListener('change', (event) => {
      statisticsState.month = Number(event.target.value);
      updateStatisticsHeader();
      renderStatistics();
    });
  } catch (error) {
    console.error(error);
    view.innerHTML = `<div class="card"><h2>통계를 불러오지 못했습니다.</h2><p class="warning">${escapeHtml(error.message)}</p></div>`;
  } finally {
    renderingStatistics = false;
  }
}

function patchUi() {
  restoreSelect('#timer-category', TIMER_KEY);
  restoreSelect('#manual-category', MANUAL_KEY);
  patchSundayCopy();
  ensureStatisticsNavigation();
}

function schedulePatch() {
  if (patchScheduled) return;
  patchScheduled = true;
  queueMicrotask(() => {
    patchScheduled = false;
    patchUi();
  });
}

injectStyles();
ensureStatisticsNavigation();
const observer = new MutationObserver(schedulePatch);
observer.observe(document.body, { childList: true, subtree: true });
authModule.onAuthStateChanged(auth, (user) => {
  if (user) {
    patchUi();
    if (!document.querySelector('#statistics-view')?.classList.contains('hidden')) renderStatistics();
  }
});
document.addEventListener('weekly-time-budget:data-changed', () => {
  if (!document.querySelector('#statistics-view')?.classList.contains('hidden')) renderStatistics();
});
patchUi();
