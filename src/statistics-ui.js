import { firebaseConfig } from '../firebase-config.js';
import {
  formatMinutes,
  getMonthRange,
  getYearRange,
  monthlyComparison,
  summarizePeriod,
  yearlyComparison,
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
    .stat-bar-list{display:grid;gap:14px}.stat-bar-row{display:grid;grid-template-columns:minmax(110px,.7fr) minmax(160px,2fr) auto;gap:12px;align-items:center}
    .stat-bar-track{height:14px;background:#e7ebe5;border-radius:999px;overflow:hidden}.stat-bar-fill{height:100%;background:#2b7665;border-radius:inherit;min-width:0}
    .comparison-change{font-size:.82rem;color:#75827d;margin-left:8px}.comparison-change.positive{color:#24705f}.comparison-change.negative{color:#9a3c2f}
    .category-order-actions{display:flex;gap:6px}.category-order-button{border:1px solid #ccd4cf;background:#fff;border-radius:10px;padding:9px 11px;font-weight:800;cursor:pointer}.category-order-button:disabled{opacity:.35;cursor:not-allowed}
    @media(max-width:800px){.statistics-summary{grid-template-columns:1fr}.stat-bar-row{grid-template-columns:1fr}.statistics-controls>*{flex:1;min-width:120px}.category-row-actions{flex-wrap:wrap}.category-order-actions{width:100%}.category-order-button{flex:1}}
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

function setTextIfChanged(node, text) {
  if (node && node.textContent !== text) node.textContent = text;
}

function replaceTextIfChanged(node, replacements) {
  if (!node) return;
  const current = node.textContent;
  const next = replacements.reduce((text, [from, to]) => text.replace(from, to), current);
  if (next !== current) node.textContent = next;
}

function patchSundayCopy() {
  const loginText = document.querySelector('#login-view .login-card > p:not(.eyebrow):not(.warning)');
  setTextIfChanged(loginText, '월요일부터 주일까지 실제 사용 시간을 기록하고, 삶의 중요한 영역에 시간을 충분히 배정했는지 확인합니다.');
  replaceTextIfChanged(document.querySelector('#week-label'), [['월~토', '월~주일']]);
  document.querySelectorAll('.muted').forEach((node) => {
    replaceTextIfChanged(node, [
      ['월요일부터 토요일까지', '월요일부터 주일까지'],
      ['예산은 월요일부터 토요일까지만 적용됩니다.', '예산은 월요일부터 주일까지 적용됩니다.'],
      ['주일 기록은 달성률에서 제외', '월요일부터 주일까지 모두 포함'],
    ]);
  });
}

async function moveCategory(categoryId, direction) {
  const user = auth.currentUser;
  if (!user) return alert('로그인이 필요합니다.');
  const snapshot = await storeModule.getDocs(storeModule.collection(db, 'users', user.uid, 'categories'));
  const categories = snapshot.docs
    .map((docSnapshot, index) => ({ id: docSnapshot.id, index, ...docSnapshot.data() }))
    .sort((a, b) => (Number(a.order) || 999999) - (Number(b.order) || 999999) || a.index - b.index);
  const currentIndex = categories.findIndex((category) => category.id === categoryId);
  const targetIndex = currentIndex + direction;
  if (currentIndex < 0 || targetIndex < 0 || targetIndex >= categories.length) return;
  [categories[currentIndex], categories[targetIndex]] = [categories[targetIndex], categories[currentIndex]];
  const batch = storeModule.writeBatch(db);
  categories.forEach((category, index) => {
    batch.set(storeModule.doc(db, 'users', user.uid, 'categories', category.id), { order: index + 1 }, { merge: true });
  });
  await batch.commit();
  location.reload();
}

function patchCategoryOrderButtons() {
  const rows = [...document.querySelectorAll('#categories-view .category-edit-row')];
  rows.forEach((row, index) => {
    const actions = row.querySelector('.category-row-actions');
    if (!actions || actions.querySelector('.category-order-actions')) return;
    const orderActions = document.createElement('div');
    orderActions.className = 'category-order-actions';
    orderActions.innerHTML = `
      <button type="button" class="category-order-button category-up" aria-label="위로 이동" ${index === 0 ? 'disabled' : ''}>↑</button>
      <button type="button" class="category-order-button category-down" aria-label="아래로 이동" ${index === rows.length - 1 ? 'disabled' : ''}>↓</button>`;
    orderActions.querySelector('.category-up').onclick = () => moveCategory(row.dataset.id, -1);
    orderActions.querySelector('.category-down').onclick = () => moveCategory(row.dataset.id, 1);
    actions.prepend(orderActions);
  });
}

function ensureStatisticsNavigation() {
  const nav = document.querySelector('.sidebar nav');
  const sectionContainer = document.querySelector('.main-content');
  if (!nav || !sectionContainer) return;
  let button = nav.querySelector('[data-statistics-nav]');
  if (!button) {
    button = document.createElement('button');
    button.className = 'nav-button';
    button.dataset.statisticsNav = 'true';
    button.textContent = '통계';
    nav.insertBefore(button, nav.querySelector('[data-view="categories"]'));
    button.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopImmediatePropagation();
      document.querySelectorAll('.view').forEach((view) => view.classList.add('hidden'));
      document.querySelector('#statistics-view')?.classList.remove('hidden');
      document.querySelectorAll('.nav-button').forEach((item) => item.classList.remove('active'));
      button.classList.add('active');
      const title = document.querySelector('#page-title');
      if (title) title.textContent = '통계';
      document.querySelector('.sidebar')?.classList.remove('open');
      renderStatistics();
    }, true);
  }
  if (!document.querySelector('#statistics-view')) {
    const section = document.createElement('section');
    section.id = 'statistics-view';
    section.className = 'view hidden';
    sectionContainer.append(section);
  }
}

function categoryNameMap() {
  const map = new Map();
  statisticsState.archivedCategories.forEach((category) => map.set(category.id, category.name));
  statisticsState.activeCategories.forEach((category) => map.set(category.id, category.name));
  return map;
}

function orderedCategoryRows(categoryTotals) {
  const rows = [];
  const used = new Set();
  statisticsState.activeCategories.forEach((category) => {
    if (categoryTotals[category.name] === undefined) return;
    rows.push([category.name, categoryTotals[category.name]]);
    used.add(category.name);
  });
  Object.entries(categoryTotals)
    .filter(([name]) => !used.has(name))
    .sort(([a], [b]) => a.localeCompare(b, 'ko'))
    .forEach((row) => rows.push(row));
  return rows;
}

function summaryHtml(summary) {
  const rows = orderedCategoryRows(summary.categoryTotals);
  const max = Math.max(1, ...rows.map(([, minutes]) => minutes));
  return `
    <div class="statistics-summary">
      <article class="card"><p class="muted">총 기록 시간</p><div class="metric">${formatMinutes(summary.totalMinutes)}</div></article>
      <article class="card"><p class="muted">기록한 날</p><div class="metric">${summary.recordDays}일</div></article>
      <article class="card"><p class="muted">기록일 기준 일평균</p><div class="metric">${formatMinutes(summary.dailyAverageMinutes)}</div></article>
    </div>
    <div class="card"><div class="section-title"><h2>대분류별 기록</h2><span class="badge">${rows.length}개</span></div>
      ${rows.length ? `<div class="stat-bar-list">${rows.map(([name, minutes]) => `
        <div class="stat-bar-row"><strong>${escapeHtml(name)}</strong><div class="stat-bar-track"><div class="stat-bar-fill" style="width:${minutes / max * 100}%"></div></div><span>${formatMinutes(minutes)}</span></div>`).join('')}</div>` : '<div class="empty-state"><h3>해당 기간의 기록이 없습니다.</h3></div>'}
    </div>`;
}

function changeHtml(current, previous) {
  if (!previous && !current) return '<span class="comparison-change">0%</span>';
  if (!previous) return current ? '<span class="comparison-change positive">새 기록</span>' : '';
  const change = Math.round((current - previous) / previous * 100);
  const className = change > 0 ? 'positive' : change < 0 ? 'negative' : '';
  return `<span class="comparison-change ${className}">${change > 0 ? '+' : ''}${change}%</span>`;
}

function comparisonHtml(items, labelKey, labelFormatter) {
  const max = Math.max(1, ...items.map((item) => item.totalMinutes));
  const hasData = items.some((item) => item.totalMinutes > 0);
  return `<div class="card"><div class="section-title"><h2>기간별 비교</h2></div>${hasData ? `<div class="stat-bar-list">${items.map((item, index) => `
    <div class="stat-bar-row"><strong>${labelFormatter(item[labelKey])}</strong><div class="stat-bar-track"><div class="stat-bar-fill" style="width:${item.totalMinutes / max * 100}%"></div></div><span>${formatMinutes(item.totalMinutes)}${index ? changeHtml(item.totalMinutes, items[index - 1].totalMinutes) : ''}</span></div>`).join('')}</div>` : '<div class="empty-state"><h3>비교할 기록이 없습니다.</h3><p>시간을 기록하면 기간별 변화가 표시됩니다.</p></div>'}</div>`;
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
    let body = '';
    if (mode === 'monthly') {
      const range = getMonthRange(statisticsState.year, statisticsState.month);
      body = summaryHtml(summarizePeriod(statisticsState.entries, categoryNameMap(), range.start, range.end));
    } else if (mode === 'yearly') {
      const range = getYearRange(statisticsState.year);
      body = summaryHtml(summarizePeriod(statisticsState.entries, categoryNameMap(), range.start, range.end));
    } else if (mode === 'monthly-comparison') {
      body = comparisonHtml(monthlyComparison(statisticsState.entries, statisticsState.year), 'month', (month) => `${month}월`);
    } else {
      body = comparisonHtml(yearlyComparison(statisticsState.entries), 'year', (year) => `${year}년`);
    }
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
  patchCategoryOrderButtons();
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