import { firebaseConfig } from '../firebase-config.js';
import {
  calculateYearMonthlyAverage,
  categoryBreakdown,
  detailedMonthlyComparison,
  detailedYearlyComparison,
  formatMinutes,
  getMonthRange,
  getYearRange,
  summarizePeriod,
} from './domain.js';

const appModule = await import('https://www.gstatic.com/firebasejs/11.10.0/firebase-app.js');
const authModule = await import('https://www.gstatic.com/firebasejs/11.10.0/firebase-auth.js');
const storeModule = await import('https://www.gstatic.com/firebasejs/11.10.0/firebase-firestore.js');
const app = appModule.getApps().length ? appModule.getApp() : appModule.initializeApp(firebaseConfig);
const auth = authModule.getAuth(app);
const db = storeModule.getFirestore(app);

const TIMER_KEY = 'weekly-time-budget:last-timer-category';
const MANUAL_KEY = 'weekly-time-budget:last-manual-category';
const now = new Date();
const statisticsState = {
  mode: 'monthly',
  year: now.getFullYear(),
  month: now.getMonth() + 1,
  entries: [],
  activeCategories: [],
  archivedCategories: [],
};
let renderingStatistics = false;
let patchScheduled = false;

const escapeHtml = (value = '') => String(value).replace(/[&<>'"]/g, (char) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;',
}[char]));

function injectStyles() {
  if (document.querySelector('#statistics-ui-styles')) return;
  const style = document.createElement('style');
  style.id = 'statistics-ui-styles';
  style.textContent = `
    .statistics-tabs{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:18px}
    .statistics-controls{display:flex;gap:12px;align-items:end;flex-wrap:wrap;margin-bottom:18px}
    .statistics-controls label{display:grid;gap:6px;font-weight:700}
    .statistics-controls select{border:1px solid #cdd5d0;border-radius:12px;padding:10px 12px;background:#fff;font:inherit}
    .statistics-summary{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:16px;margin-bottom:18px}
    .statistics-summary.yearly{grid-template-columns:repeat(4,minmax(0,1fr))}
    .stat-card-note{font-size:.78rem;color:#77817d;margin-top:7px}
    .stat-bar-list{display:grid;gap:14px}
    .stat-bar-row{display:grid;grid-template-columns:minmax(90px,.6fr) minmax(170px,2fr) minmax(150px,auto);gap:12px;align-items:center}
    .stat-bar-track{height:14px;background:#e7ebe5;border-radius:999px;overflow:hidden}
    .stat-bar-fill{height:100%;background:#2b7665;border-radius:inherit;min-width:0}
    .comparison-change{font-size:.82rem;color:#75827d;margin-left:8px;white-space:nowrap}
    .comparison-change.positive{color:#24705f}.comparison-change.negative{color:#9a3c2f}
    .statistics-card{margin-top:18px}
    .statistics-table-wrap{overflow-x:auto;margin-top:14px}
    .statistics-table{width:100%;border-collapse:collapse;min-width:650px}
    .statistics-table th,.statistics-table td{padding:12px 10px;border-bottom:1px solid #e1e4de;text-align:right;white-space:nowrap}
    .statistics-table th:first-child,.statistics-table td:first-child{text-align:left;position:sticky;left:0;background:#fffdf7;z-index:1}
    .statistics-table thead th{font-size:.82rem;color:#68736e;background:#f3f3ed}
    .statistics-table thead th:first-child{background:#f3f3ed}
    .category-share-cell{min-width:190px}
    .category-share{display:grid;grid-template-columns:minmax(100px,1fr) 48px;align-items:center;gap:8px}
    .category-share .stat-bar-track{height:10px}
    .empty-statistics{padding:34px 10px;text-align:center;color:#78817d}
    @media(max-width:1000px){.statistics-summary.yearly{grid-template-columns:repeat(2,minmax(0,1fr))}}
    @media(max-width:800px){.statistics-summary,.statistics-summary.yearly{grid-template-columns:1fr}.stat-bar-row{grid-template-columns:1fr}.statistics-controls>*{flex:1;min-width:120px}}
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

function showStatisticsView(button) {
  document.querySelectorAll('.view').forEach((view) => view.classList.add('hidden'));
  document.querySelector('#statistics-view')?.classList.remove('hidden');
  document.querySelectorAll('.nav-button').forEach((item) => item.classList.remove('active'));
  button.classList.add('active');
  const title = document.querySelector('#page-title');
  if (title) title.textContent = '통계';
  document.querySelector('.sidebar')?.classList.remove('open');
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

// 기록 내역을 포함한 다른 메뉴를 누르면 통계 화면은 반드시 사라진다.
document.addEventListener('click', (event) => {
  const navButton = event.target.closest('.nav-button');
  if (!navButton || navButton.dataset.view === 'statistics') return;
  document.querySelector('#statistics-view')?.classList.add('hidden');
}, true);

function categoryNameMap() {
  const map = new Map();
  statisticsState.archivedCategories.forEach((category) => map.set(category.id, category.name));
  statisticsState.activeCategories.forEach((category) => map.set(category.id, category.name));
  return map;
}

function orderedNames(names) {
  const available = new Set(names);
  const ordered = [];
  const append = (category) => {
    if (available.has(category.name) && !ordered.includes(category.name)) ordered.push(category.name);
  };
  statisticsState.activeCategories.forEach(append);
  [...statisticsState.archivedCategories]
    .sort((a, b) => (Number(a.order) || 999999) - (Number(b.order) || 999999) || String(a.name).localeCompare(String(b.name), 'ko'))
    .forEach(append);
  [...available].sort((a, b) => a.localeCompare(b, 'ko')).forEach((name) => {
    if (!ordered.includes(name)) ordered.push(name);
  });
  return ordered;
}

function orderedBreakdown(summary) {
  const rows = categoryBreakdown(summary);
  const byName = new Map(rows.map((row) => [row.name, row]));
  return orderedNames(rows.map((row) => row.name)).map((name) => byName.get(name));
}

function summaryCards(summary, yearly = false) {
  const monthlyAverage = yearly ? calculateYearMonthlyAverage(summary.totalMinutes, statisticsState.year, now) : null;
  return `
    <div class="statistics-summary ${yearly ? 'yearly' : ''}">
      <article class="card"><p class="muted">${yearly ? '연간 총 기록 시간' : '총 기록 시간'}</p><div class="metric">${formatMinutes(summary.totalMinutes)}</div></article>
      <article class="card"><p class="muted">기록 일수</p><div class="metric">${summary.recordDays}일</div></article>
      <article class="card"><p class="muted">기록한 날 기준 하루 평균</p><div class="metric">${formatMinutes(summary.dailyAverageMinutes)}</div></article>
      ${yearly ? `<article class="card"><p class="muted">월평균 기록 시간</p><div class="metric">${formatMinutes(monthlyAverage)}</div><p class="stat-card-note">${statisticsState.year === now.getFullYear() ? `1월~${now.getMonth() + 1}월 기준` : '12개월 기준'}</p></article>` : ''}
    </div>`;
}

function categorySummaryTable(summary, title) {
  const rows = orderedBreakdown(summary);
  return `
    <div class="card statistics-card">
      <div class="section-title"><h2>${title}</h2><span class="badge">${rows.length}개</span></div>
      ${rows.length ? `<div class="statistics-table-wrap"><table class="statistics-table">
        <thead><tr><th>대분류</th><th>기록 시간</th><th>전체 비율</th><th>그래프</th></tr></thead>
        <tbody>${rows.map((row) => `<tr>
          <td><strong>${escapeHtml(row.name)}</strong></td>
          <td>${formatMinutes(row.minutes)}</td>
          <td>${row.percentage}%</td>
          <td class="category-share-cell"><div class="category-share"><div class="stat-bar-track"><div class="stat-bar-fill" style="width:${Math.min(row.percentage, 100)}%"></div></div><span>${row.percentage}%</span></div></td>
        </tr>`).join('')}</tbody>
      </table></div>` : '<div class="empty-statistics">해당 기간의 기록이 없습니다.</div>'}
    </div>`;
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
  const max = Math.max(1, ...items.map((item) => item.totalMinutes));
  return `<div class="card statistics-card"><div class="section-title"><h2>기간별 총 기록 시간</h2></div>
    <div class="stat-bar-list">${items.map((item) => {
      const changeClass = Number(item.changeMinutes) > 0 ? 'positive' : Number(item.changeMinutes) < 0 ? 'negative' : '';
      return `<div class="stat-bar-row"><strong>${labelFormatter(item[labelKey])}</strong><div class="stat-bar-track"><div class="stat-bar-fill" style="width:${item.totalMinutes / max * 100}%"></div></div><span>${formatMinutes(item.totalMinutes)}<span class="comparison-change ${changeClass}">${changeLabel}: ${formatChange(item)}</span></span></div>`;
    }).join('')}</div></div>`;
}

function comparisonDetailTable(items, labelKey, labelFormatter, changeLabel) {
  return `<div class="card statistics-card"><div class="section-title"><h2>기간별 상세 비교</h2></div>
    <div class="statistics-table-wrap"><table class="statistics-table">
      <thead><tr><th>기간</th><th>총 기록 시간</th><th>기록 일수</th><th>하루 평균</th><th>${changeLabel}</th></tr></thead>
      <tbody>${items.map((item) => `<tr><td><strong>${labelFormatter(item[labelKey])}</strong></td><td>${formatMinutes(item.totalMinutes)}</td><td>${item.recordDays}일</td><td>${formatMinutes(item.dailyAverageMinutes)}</td><td>${formatChange(item)}</td></tr>`).join('')}</tbody>
    </table></div></div>`;
}

function categoryMatrix(items, labelKey, labelFormatter, title) {
  const names = orderedNames([...new Set(items.flatMap((item) => Object.keys(item.categoryTotals || {})))]);
  return `<div class="card statistics-card"><div class="section-title"><h2>${title}</h2></div>
    ${names.length ? `<div class="statistics-table-wrap"><table class="statistics-table">
      <thead><tr><th>기간</th>${names.map((name) => `<th>${escapeHtml(name)}</th>`).join('')}<th>합계</th></tr></thead>
      <tbody>${items.map((item) => `<tr><td><strong>${labelFormatter(item[labelKey])}</strong></td>${names.map((name) => `<td>${formatMinutes(item.categoryTotals?.[name] || 0)}</td>`).join('')}<td><strong>${formatMinutes(item.totalMinutes)}</strong></td></tr>`).join('')}</tbody>
    </table></div>` : '<div class="empty-statistics">비교할 대분류 기록이 없습니다.</div>'}
  </div>`;
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
  const [entrySnapshot, activeSnapshot, archivedSnapshot] = await Promise.all([
    storeModule.getDocs(storeModule.query(storeModule.collection(db, 'users', user.uid, 'entries'), storeModule.orderBy('date', 'desc'))),
    storeModule.getDocs(storeModule.collection(db, 'users', user.uid, 'categories')),
    storeModule.getDocs(storeModule.collection(db, 'users', user.uid, 'archivedCategories')),
  ]);
  statisticsState.entries = entrySnapshot.docs.map((docSnapshot) => ({ id: docSnapshot.id, ...docSnapshot.data() }));
  statisticsState.activeCategories = activeSnapshot.docs
    .map((docSnapshot, index) => ({ id: docSnapshot.id, sourceIndex: index, ...docSnapshot.data() }))
    .sort((a, b) => (Number(a.order) || 999999) - (Number(b.order) || 999999) || a.sourceIndex - b.sourceIndex);
  statisticsState.archivedCategories = archivedSnapshot.docs.map((docSnapshot) => ({ id: docSnapshot.id, ...docSnapshot.data() }));
  return true;
}

function monthlyStatisticsHtml() {
  const range = getMonthRange(statisticsState.year, statisticsState.month);
  const summary = summarizePeriod(statisticsState.entries, categoryNameMap(), range.start, range.end);
  return `${summaryCards(summary)}${categorySummaryTable(summary, '대분류별 월간 기록')}`;
}

function yearlyStatisticsHtml() {
  const range = getYearRange(statisticsState.year);
  const summary = summarizePeriod(statisticsState.entries, categoryNameMap(), range.start, range.end);
  return `${summaryCards(summary, true)}${categorySummaryTable(summary, '대분류별 연간 기록')}`;
}

function monthlyComparisonHtml() {
  const items = detailedMonthlyComparison(statisticsState.entries, categoryNameMap(), statisticsState.year);
  return `${comparisonChart(items, 'month', (month) => `${month}월`, '전월 대비')}${comparisonDetailTable(items, 'month', (month) => `${month}월`, '전월 대비')}${categoryMatrix(items, 'month', (month) => `${month}월`, '월별 대분류 합계')}`;
}

function yearlyComparisonHtml() {
  const items = detailedYearlyComparison(statisticsState.entries, categoryNameMap());
  if (!items.length) return '<div class="card"><div class="empty-statistics">비교할 연도별 기록이 없습니다.</div></div>';
  return `${comparisonChart(items, 'year', (year) => `${year}년`, '전년 대비')}${comparisonDetailTable(items, 'year', (year) => `${year}년`, '전년 대비')}${categoryMatrix(items, 'year', (year) => `${year}년`, '연도별 대분류 합계')}`;
}

async function renderStatistics() {
  const view = document.querySelector('#statistics-view');
  if (!view || renderingStatistics || !auth.currentUser) return;
  renderingStatistics = true;
  view.innerHTML = '<div class="card"><h2>통계를 불러오는 중…</h2></div>';
  try {
    await loadStatisticsData();
    const mode = statisticsState.mode;
    const needsYear = mode !== 'yearly-comparison';
    const needsMonth = mode === 'monthly';
    const body = mode === 'monthly'
      ? monthlyStatisticsHtml()
      : mode === 'yearly'
        ? yearlyStatisticsHtml()
        : mode === 'monthly-comparison'
          ? monthlyComparisonHtml()
          : yearlyComparisonHtml();

    view.innerHTML = `
      <div class="statistics-tabs">
        ${[['monthly','월간 통계'],['yearly','연간 통계'],['monthly-comparison','월간 비교'],['yearly-comparison','연도별 비교']].map(([value, label]) => `<button class="tab-button ${mode === value ? 'active' : ''}" data-stat-mode="${value}">${label}</button>`).join('')}
      </div>
      ${needsYear ? `<div class="statistics-controls"><label>연도<select id="statistics-year">${yearOptions()}</select></label>${needsMonth ? `<label>월<select id="statistics-month">${Array.from({ length: 12 }, (_, index) => `<option value="${index + 1}" ${index + 1 === statisticsState.month ? 'selected' : ''}>${index + 1}월</option>`).join('')}</select></label>` : ''}</div>` : ''}
      ${body}`;

    view.querySelectorAll('[data-stat-mode]').forEach((button) => {
      button.onclick = () => { statisticsState.mode = button.dataset.statMode; renderStatistics(); };
    });
    view.querySelector('#statistics-year')?.addEventListener('change', (event) => { statisticsState.year = Number(event.target.value); renderStatistics(); });
    view.querySelector('#statistics-month')?.addEventListener('change', (event) => { statisticsState.month = Number(event.target.value); renderStatistics(); });
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
patchUi();