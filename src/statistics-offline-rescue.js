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
import { getExistingOfflineRuntime } from './offline-runtime.js';

const appModule = await import('https://www.gstatic.com/firebasejs/11.10.0/firebase-app.js');
const authModule = await import('https://www.gstatic.com/firebasejs/11.10.0/firebase-auth.js');
const storeModule = await import('https://www.gstatic.com/firebasejs/11.10.0/firebase-firestore.js');
const app = appModule.getApps().length ? appModule.getApp() : appModule.initializeApp(firebaseConfig);
const auth = authModule.getAuth(app);
const db = storeModule.getFirestore(app);

export const STATISTICS_SERVER_TIMEOUT_MS = 8000;
const now = new Date();
const currentWeekStart = getWeekRange(now).start;
const state = {
  mode: 'weekly',
  weekStart: currentWeekStart,
  year: now.getFullYear(),
  month: now.getMonth() + 1,
  data: null,
  source: 'none',
  warning: '',
};
let loadSequence = 0;
let activeUserId = null;

const escapeHtml = (value = '') => String(value).replace(/[&<>'"]/g, (char) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;',
}[char]));
const statisticsView = () => document.querySelector('#statistics-view');
const statisticsVisible = () => Boolean(statisticsView() && !statisticsView().classList.contains('hidden'));

function injectStyles() {
  if (document.querySelector('#statistics-rescue-styles')) return;
  const style = document.createElement('style');
  style.id = 'statistics-rescue-styles';
  style.textContent = `
    .statistics-rescue-banner{margin:0 0 16px;padding:12px 14px;border-radius:12px;background:#eef4f1;color:#355c52;line-height:1.5;font-size:.86rem}
    .statistics-rescue-banner.warning{background:#fff4df;color:#7b5722}
    .statistics-rescue-actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:12px}
    .statistics-rescue-table{width:100%;border-collapse:collapse;margin-top:12px}
    .statistics-rescue-table th,.statistics-rescue-table td{padding:9px 7px;border-bottom:1px solid #e1e4de;text-align:right;vertical-align:middle}
    .statistics-rescue-table th:first-child,.statistics-rescue-table td:first-child{text-align:left}
    @media(max-width:800px){
      .statistics-rescue-table thead{display:none}
      .statistics-rescue-table,.statistics-rescue-table tbody{display:grid;gap:10px}
      .statistics-rescue-table tr{display:grid;padding:12px;border:1px solid #dde3de;border-radius:12px}
      .statistics-rescue-table td{display:grid;grid-template-columns:minmax(90px,38%) 1fr;gap:10px;border:0;border-bottom:1px solid #edf0ec;text-align:right}
      .statistics-rescue-table td:last-child{border-bottom:0}
      .statistics-rescue-table td::before{content:attr(data-label);font-size:.8rem;font-weight:700;color:#6d7873;text-align:left}
    }
  `;
  document.head.append(style);
}

function timeoutPromise() {
  return new Promise((_, reject) => {
    setTimeout(() => reject(new Error('서버 응답이 늦어 기기에 저장된 자료를 표시합니다.')), STATISTICS_SERVER_TIMEOUT_MS);
  });
}

function resetUserState(nextUserId = null) {
  loadSequence += 1;
  activeUserId = nextUserId;
  state.data = null;
  state.source = 'none';
  state.warning = '';
}

async function readCachedStatistics(user) {
  const runtime = getExistingOfflineRuntime(user.uid);
  if (!runtime) return null;
  const snapshot = await runtime.store.getSnapshot(user.uid);
  if (!snapshot) return null;
  const cached = snapshot.statisticsData || {};
  const remoteEntries = Array.isArray(cached.entries)
    ? cached.entries
    : (Array.isArray(snapshot.entries) ? snapshot.entries : []);
  const entries = await runtime.mergedEntries(remoteEntries);
  const activeCategories = Array.isArray(cached.activeCategories)
    ? cached.activeCategories
    : (Array.isArray(snapshot.categories) ? snapshot.categories : []);
  const archivedCategories = Array.isArray(cached.archivedCategories) ? cached.archivedCategories : [];
  const weeklyBudgets = Array.isArray(cached.weeklyBudgets)
    ? cached.weeklyBudgets
    : (snapshot.weeklyBudget ? [snapshot.weeklyBudget] : []);
  const hasData = entries.length || activeCategories.length || archivedCategories.length || weeklyBudgets.length;
  return hasData ? { entries, activeCategories, archivedCategories, weeklyBudgets } : null;
}

async function fetchServerStatistics(user) {
  const request = Promise.all([
    storeModule.getDocs(storeModule.query(
      storeModule.collection(db, 'users', user.uid, 'entries'),
      storeModule.orderBy('date', 'desc'),
    )),
    storeModule.getDocs(storeModule.collection(db, 'users', user.uid, 'categories')),
    storeModule.getDocs(storeModule.collection(db, 'users', user.uid, 'archivedCategories')),
    storeModule.getDocs(storeModule.collection(db, 'users', user.uid, 'weeklyBudgets')),
  ]);
  const [entrySnapshot, activeSnapshot, archivedSnapshot, weeklyBudgetSnapshot] = await Promise.race([
    request,
    timeoutPromise(),
  ]);
  const serverEntries = entrySnapshot.docs.map((item) => ({ id: item.id, ...item.data() }));
  const activeCategories = activeSnapshot.docs
    .map((item, index) => ({ id: item.id, sourceIndex: index, ...item.data() }))
    .sort((left, right) => (Number(left.order) || 999999) - (Number(right.order) || 999999)
      || left.sourceIndex - right.sourceIndex);
  const archivedCategories = archivedSnapshot.docs.map((item) => ({ id: item.id, ...item.data() }));
  const weeklyBudgets = weeklyBudgetSnapshot.docs.map((item) => ({ id: item.id, ...item.data() }));
  const runtime = getExistingOfflineRuntime(user.uid);
  const entries = runtime ? await runtime.mergedEntries(serverEntries) : serverEntries;
  if (runtime) {
    await runtime.store.patchSnapshot(user.uid, {
      statisticsData: {
        entries: serverEntries,
        activeCategories,
        archivedCategories,
        weeklyBudgets,
        updatedAt: Date.now(),
      },
    });
  }
  return { entries, activeCategories, archivedCategories, weeklyBudgets };
}

function allCategories() {
  const map = new Map();
  (state.data?.archivedCategories || []).forEach((category) => map.set(category.id, category));
  (state.data?.activeCategories || []).forEach((category) => map.set(category.id, category));
  return [...map.values()];
}

function overallAchievement(summary) {
  if (summary.totalBudgetMinutes <= 0 && summary.totalActualMinutes > 0) return '예산 미설정';
  return `${summary.percentage ?? 0}%`;
}

function differenceText(item) {
  if (item.status === 'unbudgeted') {
    return `예산 미설정 · ${formatMinutes(item.actualMinutes ?? item.totalActualMinutes)} 기록`;
  }
  const difference = Number(item.differenceMinutes) || 0;
  if (difference > 0) return `${formatMinutes(difference)} 초과`;
  if (difference < 0) return `${formatMinutes(Math.abs(difference))} 남음`;
  return '예산과 일치';
}

function summaryCards(summary, yearly = false) {
  const monthlyAverage = yearly
    ? calculateRecordedMonthAverage(summary.totalActualMinutes, summary.recordMonthCount)
    : null;
  return `<div class="statistics-summary">
    <article class="card"><p class="muted">기간 예산</p><div class="metric">${formatMinutes(summary.totalBudgetMinutes)}</div></article>
    <article class="card"><p class="muted">실제 기록</p><div class="metric">${formatMinutes(summary.totalActualMinutes)}</div></article>
    <article class="card"><p class="muted">전체 달성률</p><div class="metric">${overallAchievement(summary)}</div><p class="stat-card-note">${differenceText({ ...summary, actualMinutes: summary.totalActualMinutes })}</p></article>
    <article class="card"><p class="muted">기록 일수</p><div class="metric">${summary.recordDays || 0}일</div></article>
    <article class="card"><p class="muted">기록한 날 기준 하루 평균</p><div class="metric">${formatMinutes(summary.dailyAverageMinutes)}</div></article>
    ${yearly ? `<article class="card"><p class="muted">기록이 있는 달 기준 월평균</p><div class="metric">${formatMinutes(monthlyAverage)}</div></article>` : ''}
  </div>`;
}

function categoryTable(summary, title) {
  const activeIds = new Set((state.data?.activeCategories || []).map((category) => category.id));
  const rows = summary.categorySummaries.filter((item) => (
    activeIds.has(item.id) || item.budgetMinutes > 0 || item.actualMinutes > 0
  ));
  return `<div class="card statistics-card"><div class="section-title"><h2>${title}</h2><span class="badge">${rows.length}개</span></div>
    ${rows.length ? `<table class="statistics-rescue-table"><thead><tr><th>대분류</th><th>기간 예산</th><th>실제 기록</th><th>달성률</th><th>차이</th></tr></thead><tbody>${rows.map((row) => `<tr>
      <td data-label="대분류"><strong>${escapeHtml(row.name)}</strong></td>
      <td data-label="기간 예산">${formatMinutes(row.budgetMinutes)}</td>
      <td data-label="실제 기록">${formatMinutes(row.actualMinutes)}</td>
      <td data-label="달성률">${row.hasBudget ? `${row.percentage}%` : row.actualMinutes > 0 ? '예산 미설정' : '—'}</td>
      <td data-label="차이">${differenceText(row)}</td>
    </tr>`).join('')}</tbody></table>` : '<div class="empty-statistics">해당 기간에 표시할 통계가 없습니다.</div>'}
  </div>`;
}

function formatChange(item) {
  if (item.changeMinutes === null || item.changeMinutes === undefined) return '—';
  const sign = item.changeMinutes > 0 ? '+' : item.changeMinutes < 0 ? '-' : '';
  const time = `${sign}${formatMinutes(Math.abs(item.changeMinutes))}`;
  if (item.changePercentage === null) return `${time} (신규)`;
  return `${time} (${item.changePercentage > 0 ? '+' : ''}${item.changePercentage}%)`;
}

function comparisonTable(items, key, label, changeLabel) {
  if (!items.length) {
    return '<div class="card statistics-card"><div class="empty-statistics">비교할 기록이 없습니다.</div></div>';
  }
  return `<div class="card statistics-card"><div class="section-title"><h2>기간별 예산과 실제 기록</h2></div>
    <table class="statistics-rescue-table"><thead><tr><th>기간</th><th>기간 예산</th><th>실제 기록</th><th>달성률</th><th>기록 일수</th><th>${changeLabel}</th></tr></thead><tbody>${items.map((item) => `<tr>
      <td data-label="기간"><strong>${label(item[key])}</strong></td>
      <td data-label="기간 예산">${formatMinutes(item.totalBudgetMinutes)}</td>
      <td data-label="실제 기록">${formatMinutes(item.totalActualMinutes)}</td>
      <td data-label="달성률">${overallAchievement(item)}</td>
      <td data-label="기록 일수">${item.recordDays || 0}일</td>
      <td data-label="${changeLabel}">${formatChange(item)}</td>
    </tr>`).join('')}</tbody></table>
  </div>`;
}

function selectedWeekRange() {
  return getWeekRange(new Date(`${state.weekStart}T12:00:00`));
}

function controlsHtml() {
  if (state.mode === 'weekly') {
    const range = selectedWeekRange();
    return `<div class="week-navigation"><button class="secondary-button" data-rescue-week="-1" type="button">← 이전 주</button><strong class="week-range">${range.start} ~ ${range.end}</strong><button class="secondary-button" data-rescue-week="1" type="button" ${state.weekStart >= currentWeekStart ? 'disabled' : ''}>다음 주 →</button></div>`;
  }
  if (state.mode === 'yearly-comparison') return '';
  const years = new Set([now.getFullYear(), state.year]);
  (state.data?.entries || []).forEach((entry) => {
    const year = Number(String(entry.date || '').slice(0, 4));
    if (Number.isFinite(year)) years.add(year);
  });
  const yearOptions = [...years].sort((a, b) => b - a)
    .map((year) => `<option value="${year}" ${year === state.year ? 'selected' : ''}>${year}년</option>`).join('');
  const month = state.mode === 'monthly'
    ? `<label>월<select id="statistics-rescue-month">${Array.from({ length: 12 }, (_, index) => `<option value="${index + 1}" ${index + 1 === state.month ? 'selected' : ''}>${index + 1}월</option>`).join('')}</select></label>`
    : '';
  return `<div class="statistics-controls"><label>연도<select id="statistics-rescue-year">${yearOptions}</select></label>${month}</div>`;
}

function bodyHtml() {
  const entries = state.data?.entries || [];
  const categories = allCategories();
  const budgets = state.data?.weeklyBudgets || [];
  if (state.mode === 'weekly') {
    const summary = summarizeWeeklyBudgetPeriod(entries, categories, budgets, state.weekStart);
    return `${summaryCards(summary)}${categoryTable(summary, '대분류별 주간 예산 달성')}`;
  }
  if (state.mode === 'monthly') {
    const summary = summarizeRecordedMonthlyBudgetPeriod(entries, categories, budgets, state.year, state.month);
    return `${summaryCards(summary)}${categoryTable(summary, '대분류별 월간 예산 달성')}`;
  }
  if (state.mode === 'yearly') {
    const summary = summarizeRecordedYearlyBudgetPeriod(entries, categories, budgets, state.year);
    return `${summaryCards(summary, true)}${categoryTable(summary, '대분류별 연간 예산 달성')}`;
  }
  if (state.mode === 'monthly-comparison') {
    const items = detailedRecordedMonthlyBudgetComparison(entries, categories, budgets, state.year);
    return comparisonTable(items, 'month', (month) => `${month}월`, '전월 대비');
  }
  const items = detailedRecordedYearlyBudgetComparison(entries, categories, budgets);
  return comparisonTable(items, 'year', (year) => `${year}년`, '전년 대비');
}

function headerText() {
  if (state.mode === 'weekly') {
    const range = selectedWeekRange();
    return `${range.start} — ${range.end} · 주별 예산 대비 통계`;
  }
  if (state.mode === 'monthly') return `${state.year}년 ${state.month}월 · 예산 대비 통계`;
  if (state.mode === 'yearly') return `${state.year}년 · 예산 대비 통계`;
  if (state.mode === 'monthly-comparison') return `${state.year}년 기록 월 비교 · 예산 대비 통계`;
  return '전체 연도 비교 · 예산 대비 통계';
}

function persistState() {
  document.dispatchEvent(new CustomEvent('weekly-time-budget:save-ui-state', {
    detail: {
      activeView: 'statistics',
      statistics: {
        mode: state.mode,
        weekStart: state.weekStart,
        year: state.year,
        month: state.month,
      },
    },
  }));
}

function renderStatistics() {
  const target = statisticsView();
  if (!target || !state.data) return;
  target.dataset.statisticsRescue = 'true';
  const sourceMessage = state.source === 'cache'
    ? '기기에 저장된 자료를 먼저 표시하고 있습니다. 과거의 변동 예산은 서버 연결 후 최신 자료로 자동 갱신됩니다.'
    : '서버의 최신 자료로 통계를 표시하고 있습니다.';
  const notice = state.warning
    ? `<div class="statistics-rescue-banner warning">${escapeHtml(state.warning)}<div class="statistics-rescue-actions"><button id="statistics-rescue-retry" class="secondary-button" type="button">통계를 다시 불러오기</button></div></div>`
    : `<div class="statistics-rescue-banner">${sourceMessage}</div>`;
  target.innerHTML = `<div class="statistics-tabs">${[
    ['weekly', '주별 통계'],
    ['monthly', '월간 통계'],
    ['yearly', '연간 통계'],
    ['monthly-comparison', '월간 비교'],
    ['yearly-comparison', '연도별 비교'],
  ].map(([mode, label]) => `<button class="tab-button ${state.mode === mode ? 'active' : ''}" data-rescue-stat-mode="${mode}" type="button">${label}</button>`).join('')}</div>${controlsHtml()}${notice}${bodyHtml()}`;
  const label = document.querySelector('#week-label');
  const title = document.querySelector('#page-title');
  if (label) label.textContent = headerText();
  if (title) title.textContent = '통계';
}

function showLoading() {
  const target = statisticsView();
  if (!target) return;
  target.classList.remove('hidden');
  target.dataset.statisticsRescue = 'loading';
  target.innerHTML = '<div class="card"><h2>통계를 불러오는 중…</h2><p class="muted">기기에 저장된 자료를 확인하고 있습니다.</p></div>';
}

function showFailure(error) {
  const target = statisticsView();
  if (!target) return;
  target.dataset.statisticsRescue = 'error';
  target.innerHTML = `<div class="card"><h2>통계를 불러오지 못했습니다.</h2><p class="warning">${escapeHtml(error.message || '통계 자료를 확인하지 못했습니다.')}</p><button id="statistics-rescue-retry" class="primary-button" type="button">통계를 다시 불러오기</button></div>`;
}

async function loadStatistics({ keepCurrent = false } = {}) {
  const user = auth.currentUser;
  if (!user) return;
  if (activeUserId !== user.uid) {
    state.data = null;
    state.source = 'none';
    state.warning = '';
    activeUserId = user.uid;
  }
  const sequence = ++loadSequence;
  if (!keepCurrent || !state.data) showLoading();
  let cached = null;
  try {
    cached = await readCachedStatistics(user);
    if (sequence !== loadSequence || activeUserId !== user.uid) return;
    if (cached) {
      state.data = cached;
      state.source = 'cache';
      state.warning = '';
      renderStatistics();
    }
  } catch (error) {
    console.warn('통계 기기 캐시를 읽지 못했습니다.', error);
  }
  try {
    const server = await fetchServerStatistics(user);
    if (sequence !== loadSequence || activeUserId !== user.uid) return;
    state.data = server;
    state.source = 'server';
    state.warning = '';
    renderStatistics();
  } catch (error) {
    if (sequence !== loadSequence || activeUserId !== user.uid) return;
    if (state.data || cached) {
      state.warning = error.message || '서버 통계 자료를 갱신하지 못했습니다.';
      renderStatistics();
    } else {
      showFailure(error);
    }
  }
}

function activateStatistics(button) {
  document.querySelectorAll('.view').forEach((item) => item.classList.add('hidden'));
  statisticsView()?.classList.remove('hidden');
  document.querySelectorAll('.nav-button').forEach((item) => item.classList.toggle('active', item === button));
  document.querySelector('.sidebar')?.classList.remove('open');
  persistState();
  loadStatistics();
}

injectStyles();

authModule.onAuthStateChanged(auth, (user) => {
  const nextUserId = user?.uid || null;
  if (nextUserId === activeUserId) return;
  resetUserState(nextUserId);
  if (!user) {
    const target = statisticsView();
    if (target) {
      delete target.dataset.statisticsRescue;
      target.innerHTML = '';
    }
  }
});

document.addEventListener('click', (event) => {
  const statisticsButton = event.target.closest?.('.nav-button[data-view="statistics"]');
  if (statisticsButton) {
    event.preventDefault();
    event.stopImmediatePropagation();
    activateStatistics(statisticsButton);
    return;
  }
  if (!statisticsVisible() || statisticsView()?.dataset.statisticsRescue === undefined) return;
  const modeButton = event.target.closest?.('[data-rescue-stat-mode]');
  if (modeButton) {
    event.preventDefault();
    event.stopImmediatePropagation();
    state.mode = modeButton.dataset.rescueStatMode;
    state.warning = '';
    persistState();
    renderStatistics();
    return;
  }
  const weekButton = event.target.closest?.('[data-rescue-week]');
  if (weekButton) {
    event.preventDefault();
    event.stopImmediatePropagation();
    state.weekStart = moveWeekStart(state.weekStart, Number(weekButton.dataset.rescueWeek), now);
    persistState();
    renderStatistics();
    return;
  }
  if (event.target.closest?.('#statistics-rescue-retry')) {
    event.preventDefault();
    event.stopImmediatePropagation();
    state.warning = '';
    loadStatistics({ keepCurrent: Boolean(state.data) });
  }
}, true);

document.addEventListener('change', (event) => {
  if (!statisticsVisible() || statisticsView()?.dataset.statisticsRescue === undefined) return;
  if (event.target.matches('#statistics-rescue-year')) {
    event.stopImmediatePropagation();
    state.year = Number(event.target.value);
    persistState();
    renderStatistics();
  }
  if (event.target.matches('#statistics-rescue-month')) {
    event.stopImmediatePropagation();
    state.month = Number(event.target.value);
    persistState();
    renderStatistics();
  }
}, true);

document.addEventListener('weekly-time-budget:data-changed', (event) => {
  if (!statisticsVisible()) return;
  event.stopImmediatePropagation();
  loadStatistics({ keepCurrent: true });
}, true);

document.addEventListener('weekly-time-budget:ui-state-restored', (event) => {
  const restored = event.detail;
  if (restored?.statistics) {
    state.mode = restored.statistics.mode || state.mode;
    state.weekStart = restored.statistics.weekStart || state.weekStart;
    state.year = Number(restored.statistics.year) || state.year;
    state.month = Number(restored.statistics.month) || state.month;
  }
  if (restored?.activeView === 'statistics') {
    queueMicrotask(() => {
      const button = document.querySelector('.nav-button[data-view="statistics"]');
      if (button) activateStatistics(button);
    });
  }
});
