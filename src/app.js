import { firebaseConfig } from '../firebase-config.js';
import {
  formatMinutes,
  getWeekRange,
  minutesBetween,
  summarizeCategories,
  toDateKey,
} from './domain.js';

const configured = !Object.values(firebaseConfig).some((value) => String(value).includes('REPLACE_ME'));
const views = ['dashboard', 'record', 'budget', 'history', 'categories'];
const titles = {
  dashboard: '대시보드',
  record: '시간 기록',
  budget: '이번 주 예산',
  history: '기록 내역',
  categories: '대분류 관리',
};
const state = {
  user: null,
  categories: [],
  entries: [],
  weeklyBudget: null,
  timer: null,
  timerInterval: null,
  activeRecordTab: 'timer',
};

let auth;
let db;
let firebase;

const $ = (selector) => document.querySelector(selector);
const escapeHtml = (value = '') => String(value).replace(/[&<>'"]/g, (char) => ({
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  "'": '&#39;',
  '"': '&quot;',
}[char]));

const defaultBudgetMinutes = (category) =>
  Number(category.defaultBudgetMinutes ?? category.budgetMinutes ?? 0);

const currentWeekKey = () => getWeekRange().start;

const effectiveBudgetMinutes = (category) => {
  const weeklyValue = state.weeklyBudget?.budgets?.[category.id];
  return weeklyValue === undefined ? defaultBudgetMinutes(category) : Number(weeklyValue) || 0;
};

const categoriesForSummary = () => state.categories.map((category) => ({
  ...category,
  budgetMinutes: effectiveBudgetMinutes(category),
}));

const optionHtml = (selectedId = '') => state.categories
  .map((category) => `<option value="${category.id}" ${category.id === selectedId ? 'selected' : ''}>${escapeHtml(category.name)}</option>`)
  .join('');

async function initFirebase() {
  if (!configured) {
    $('#config-warning').classList.remove('hidden');
    $('#google-login').disabled = true;
    return;
  }

  const appModule = await import('https://www.gstatic.com/firebasejs/11.10.0/firebase-app.js');
  const authModule = await import('https://www.gstatic.com/firebasejs/11.10.0/firebase-auth.js');
  const storeModule = await import('https://www.gstatic.com/firebasejs/11.10.0/firebase-firestore.js');

  const app = appModule.initializeApp(firebaseConfig);
  auth = authModule.getAuth(app);
  db = storeModule.getFirestore(app);
  firebase = { ...authModule, ...storeModule };

  authModule.onAuthStateChanged(auth, async (user) => {
    state.user = user;
    $('#login-view').classList.toggle('hidden', Boolean(user));
    $('#app-view').classList.toggle('hidden', !user);

    if (user) {
      $('#user-name').textContent = user.displayName || user.email;
      await loadData();
      renderAll();
    }
  });
}

async function loadData() {
  const categoryRef = firebase.collection(db, 'users', state.user.uid, 'categories');
  const entryRef = firebase.collection(db, 'users', state.user.uid, 'entries');
  const weeklyRef = firebase.doc(db, 'users', state.user.uid, 'weeklyBudgets', currentWeekKey());

  const [categorySnapshot, entrySnapshot, weeklySnapshot] = await Promise.all([
    firebase.getDocs(firebase.query(categoryRef, firebase.orderBy('order'))),
    firebase.getDocs(firebase.query(entryRef, firebase.orderBy('date', 'desc'))),
    firebase.getDoc(weeklyRef),
  ]);

  state.categories = categorySnapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
  state.entries = entrySnapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
  state.weeklyBudget = weeklySnapshot.exists()
    ? { id: weeklySnapshot.id, ...weeklySnapshot.data() }
    : null;
}

async function saveCategory({ id, name, defaultBudgetMinutes: budget }) {
  const trimmedName = String(name || '').trim();
  if (!trimmedName) throw new Error('대분류 이름을 입력하세요.');

  const existing = state.categories.find((category) => category.id === id);
  const payload = {
    name: trimmedName,
    defaultBudgetMinutes: Number(budget) || 0,
    order: existing?.order || state.categories.length + 1,
  };

  const collectionRef = firebase.collection(db, 'users', state.user.uid, 'categories');
  if (id) {
    await firebase.setDoc(firebase.doc(collectionRef, id), payload, { merge: true });
  } else {
    await firebase.addDoc(collectionRef, payload);
  }

  await loadData();
  renderAll();
}

async function saveWeeklyBudget(budgets) {
  const weekKey = currentWeekKey();
  await firebase.setDoc(
    firebase.doc(db, 'users', state.user.uid, 'weeklyBudgets', weekKey),
    {
      weekStart: weekKey,
      budgets,
      updatedAt: firebase.serverTimestamp(),
    },
    { merge: true },
  );
  await loadData();
  renderAll();
}

async function deleteCategory(id) {
  if (!confirm('이 대분류를 삭제할까요? 기존 기록은 유지됩니다.')) return;
  await firebase.deleteDoc(firebase.doc(db, 'users', state.user.uid, 'categories', id));
  await loadData();
  renderAll();
}

async function saveEntry(entry) {
  await firebase.addDoc(
    firebase.collection(db, 'users', state.user.uid, 'entries'),
    { ...entry, createdAt: firebase.serverTimestamp() },
  );
  await loadData();
  renderAll();
}

async function deleteEntry(id) {
  if (!confirm('이 기록을 삭제할까요?')) return;
  await firebase.deleteDoc(firebase.doc(db, 'users', state.user.uid, 'entries', id));
  await loadData();
  renderAll();
}

function renderAll() {
  const range = getWeekRange();
  $('#week-label').textContent = `${range.start} — ${range.end} · 월~토`;
  renderDashboard();
  renderRecord();
  renderBudget();
  renderHistory();
  renderCategories();
}

function renderDashboard() {
  const range = getWeekRange();
  const summary = summarizeCategories(categoriesForSummary(), state.entries, range.start, range.end);
  const totalBudget = summary.reduce((sum, item) => sum + item.budgetMinutes, 0);
  const totalActual = summary.reduce((sum, item) => sum + item.actualMinutes, 0);
  const totalRate = totalBudget ? Math.round((totalActual / totalBudget) * 100) : 0;

  $('#dashboard-view').innerHTML = `
    <div class="grid grid-3">
      <article class="card">
        <p class="muted">전체 달성률</p>
        <div class="metric">${totalRate}%</div>
        <div class="progress"><span style="width:${Math.min(totalRate, 100)}%"></span></div>
      </article>
      <article class="card">
        <p class="muted">이번 주 예산</p>
        <div class="metric">${formatMinutes(totalBudget)}</div>
        <p class="muted">월요일부터 토요일까지</p>
      </article>
      <article class="card">
        <p class="muted">실제 기록</p>
        <div class="metric">${formatMinutes(totalActual)}</div>
        <p class="muted">주일 기록은 달성률에서 제외</p>
      </article>
    </div>
    <div class="card" style="margin-top:18px">
      <div class="section-title">
        <h2>대분류별 달성률</h2>
        <span class="badge">${summary.length}개 분야</span>
      </div>
      ${summary.length
        ? summary.map((item) => `
          <div class="budget-row">
            <div>
              <strong>${escapeHtml(item.name)}</strong>
              <div class="progress"><span style="width:${Math.min(item.percentage, 100)}%"></span></div>
            </div>
            <div>${formatMinutes(item.actualMinutes)} / ${formatMinutes(item.budgetMinutes)}</div>
            <strong>${item.percentage}%</strong>
            <span class="muted">${item.status === 'exceeded'
              ? `${formatMinutes(item.differenceMinutes)} 초과`
              : `${formatMinutes(item.differenceMinutes)} 남음`}</span>
          </div>`).join('')
        : $('#empty-template').innerHTML}
    </div>`;
}

function renderRecord() {
  $('#record-view').innerHTML = `
    <div class="tabs">
      <button class="tab-button ${state.activeRecordTab === 'timer' ? 'active' : ''}" data-record-tab="timer">타이머</button>
      <button class="tab-button ${state.activeRecordTab === 'manual' ? 'active' : ''}" data-record-tab="manual">수동 입력</button>
    </div>
    <div class="card">${state.activeRecordTab === 'timer' ? timerForm() : manualForm()}</div>`;

  document.querySelectorAll('[data-record-tab]').forEach((button) => {
    button.onclick = () => {
      state.activeRecordTab = button.dataset.recordTab;
      renderRecord();
    };
  });

  if (state.activeRecordTab === 'timer') bindTimer();
  else bindManual();
}

function timerForm() {
  const elapsed = state.timer ? Math.floor((Date.now() - state.timer.startedAt) / 1000) : 0;
  const selectedCategoryId = state.timer?.categoryId || '';
  const note = state.timer?.note || '';

  return `
    <div class="form-grid">
      <label>대분류
        <select id="timer-category" ${state.timer ? 'disabled' : ''}>
          <option value="">선택하세요</option>
          ${optionHtml(selectedCategoryId)}
        </select>
      </label>
      <label>메모(선택)
        <textarea id="timer-note" rows="2" ${state.timer ? 'disabled' : ''}>${escapeHtml(note)}</textarea>
      </label>
    </div>
    <div id="timer-display" class="timer">${formatClock(elapsed)}</div>
    <div class="actions">
      <button id="timer-action" class="primary-button">${state.timer ? '종료하고 저장' : '타이머 시작'}</button>
      ${state.timer ? '<button id="timer-cancel" class="secondary-button">취소</button>' : ''}
    </div>`;
}

function bindTimer() {
  $('#timer-action').onclick = async () => {
    if (!state.timer) {
      const categoryId = $('#timer-category').value;
      if (!categoryId) return alert('대분류를 선택하세요.');

      state.timer = {
        categoryId,
        note: $('#timer-note').value.trim(),
        startedAt: Date.now(),
      };
      renderRecord();

      state.timerInterval = setInterval(() => {
        const display = $('#timer-display');
        if (display) {
          display.textContent = formatClock(Math.floor((Date.now() - state.timer.startedAt) / 1000));
        }
      }, 1000);
      return;
    }

    const durationMinutes = Math.max(1, Math.round((Date.now() - state.timer.startedAt) / 60000));
    const timer = state.timer;
    clearInterval(state.timerInterval);
    state.timer = null;

    await saveEntry({
      categoryId: timer.categoryId,
      note: timer.note,
      date: toDateKey(new Date()),
      durationMinutes,
      startTime: new Date(timer.startedAt).toTimeString().slice(0, 5),
      endTime: new Date().toTimeString().slice(0, 5),
      source: 'timer',
    });
  };

  if ($('#timer-cancel')) {
    $('#timer-cancel').onclick = () => {
      clearInterval(state.timerInterval);
      state.timer = null;
      renderRecord();
    };
  }
}

function manualForm() {
  const now = new Date();
  const end = now.toTimeString().slice(0, 5);
  const startDate = new Date(now.getTime() - 60 * 60 * 1000);
  const start = startDate.toTimeString().slice(0, 5);

  return `
    <form id="manual-form" class="form-grid">
      <label>대분류
        <select id="manual-category" required>
          <option value="">선택하세요</option>
          ${optionHtml()}
        </select>
      </label>
      <label>날짜
        <input id="manual-date" type="date" value="${toDateKey(now)}" required>
      </label>
      <div class="time-fields">
        <label>시작<input id="manual-start" type="time" value="${start}" required></label>
        <label>종료<input id="manual-end" type="time" value="${end}" required></label>
      </div>
      <label>메모(선택)<textarea id="manual-note" rows="2"></textarea></label>
      <button class="primary-button" type="submit">기록 저장</button>
    </form>`;
}

function bindManual() {
  $('#manual-form').onsubmit = async (event) => {
    event.preventDefault();
    const durationMinutes = minutesBetween($('#manual-start').value, $('#manual-end').value);
    if (durationMinutes <= 0 || durationMinutes > 1440) return alert('시간 범위를 확인하세요.');

    await saveEntry({
      categoryId: $('#manual-category').value,
      note: $('#manual-note').value.trim(),
      date: $('#manual-date').value,
      durationMinutes,
      startTime: $('#manual-start').value,
      endTime: $('#manual-end').value,
      source: 'manual',
    });
  };
}

function renderBudget() {
  $('#budget-view').innerHTML = `
    <div class="card">
      <div class="section-title">
        <div>
          <h2>이번 주 시간 예산</h2>
          <p class="muted">이번 주에만 적용됩니다. 다음 주에는 대분류의 기본 예산이 다시 표시됩니다.</p>
        </div>
      </div>
      ${state.categories.length
        ? `<form id="budget-bulk-form">
            <div class="category-list">
              ${state.categories.map((category) => `
                <div class="category-item budget-edit-row" data-id="${category.id}">
                  <div>
                    <strong>${escapeHtml(category.name)}</strong>
                    <div class="muted">기본 ${formatMinutes(defaultBudgetMinutes(category))}</div>
                  </div>
                  <input
                    type="number"
                    name="hours"
                    min="0"
                    step="0.5"
                    value="${effectiveBudgetMinutes(category) / 60}"
                    aria-label="${escapeHtml(category.name)} 이번 주 예산 시간">
                </div>`).join('')}
            </div>
            <div class="bulk-save-actions">
              <button class="primary-button" type="submit">이번 주 예산 저장</button>
            </div>
          </form>`
        : $('#empty-template').innerHTML}
    </div>`;

  if ($('#budget-bulk-form')) {
    $('#budget-bulk-form').onsubmit = async (event) => {
      event.preventDefault();
      const budgets = {};
      document.querySelectorAll('.budget-edit-row').forEach((row) => {
        budgets[row.dataset.id] = Number(row.querySelector('[name="hours"]').value) * 60;
      });
      await saveWeeklyBudget(budgets);
      alert('이번 주 예산을 저장했습니다.');
    };
  }
}

function renderHistory() {
  $('#history-view').innerHTML = `
    <div class="card">
      <div class="section-title">
        <h2>최근 기록</h2>
        <span class="badge">${state.entries.length}건</span>
      </div>
      ${state.entries.length
        ? state.entries.map((entry) => {
            const category = state.categories.find((item) => item.id === entry.categoryId);
            return `
              <div class="entry">
                <strong>${entry.date}</strong>
                <div>
                  <strong>${escapeHtml(category?.name || '삭제된 대분류')}</strong>
                  <div>${entry.startTime || ''}–${entry.endTime || ''} · ${formatMinutes(entry.durationMinutes)}</div>
                  ${entry.note ? `<p class="muted">${escapeHtml(entry.note)}</p>` : ''}
                </div>
                <div class="entry-actions">
                  <button class="text-button delete-entry" data-id="${entry.id}">삭제</button>
                </div>
              </div>`;
          }).join('')
        : '<div class="empty-state"><h3>아직 기록이 없습니다.</h3><p>타이머 또는 수동 입력으로 첫 시간을 기록하세요.</p></div>'}
    </div>`;

  document.querySelectorAll('.delete-entry').forEach((button) => {
    button.onclick = () => deleteEntry(button.dataset.id);
  });
}

function renderCategories() {
  $('#categories-view').innerHTML = `
    <div class="grid grid-2">
      <div class="card">
        <h2>대분류 추가</h2>
        <form id="category-add" class="form-grid">
          <label>이름
            <input name="name" placeholder="예: 논문" required maxlength="30">
          </label>
          <label>기본 주간 예산(시간)
            <input name="hours" type="number" min="0" step="0.5" value="0">
          </label>
          <button class="primary-button">추가</button>
        </form>
      </div>
      <div class="card">
        <h2>등록된 대분류</h2>
        ${state.categories.length
          ? `<div class="category-list">
              ${state.categories.map((category) => `
                <form class="category-item category-edit-row" data-id="${category.id}">
                  <input name="name" value="${escapeHtml(category.name)}" required aria-label="대분류 이름">
                  <input
                    name="hours"
                    type="number"
                    min="0"
                    step="0.5"
                    value="${defaultBudgetMinutes(category) / 60}"
                    aria-label="${escapeHtml(category.name)} 기본 예산 시간">
                  <div class="category-row-actions">
                    <button class="secondary-button" type="submit">수정</button>
                    <button class="danger-button category-delete" type="button">삭제</button>
                  </div>
                </form>`).join('')}
            </div>`
          : $('#empty-template').innerHTML}
      </div>
    </div>`;

  $('#category-add').onsubmit = async (event) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    await saveCategory({
      name: data.get('name'),
      defaultBudgetMinutes: Number(data.get('hours')) * 60,
    });
    const nameInput = $('#category-add input[name="name"]');
    if (nameInput) nameInput.focus();
  };

  document.querySelectorAll('.category-edit-row').forEach((form) => {
    form.onsubmit = async (event) => {
      event.preventDefault();
      await saveCategory({
        id: form.dataset.id,
        name: form.querySelector('[name="name"]').value,
        defaultBudgetMinutes: Number(form.querySelector('[name="hours"]').value) * 60,
      });
      alert('대분류를 수정했습니다.');
    };

    form.querySelector('.category-delete').onclick = () => deleteCategory(form.dataset.id);
  });
}

function formatClock(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return [h, m, s].map((value) => String(value).padStart(2, '0')).join(':');
}

function switchView(name) {
  views.forEach((view) => $(`#${view}-view`).classList.toggle('hidden', view !== name));
  document.querySelectorAll('.nav-button').forEach((button) => {
    button.classList.toggle('active', button.dataset.view === name);
  });
  $('#page-title').textContent = titles[name];
  $('.sidebar').classList.remove('open');
}

document.querySelectorAll('.nav-button').forEach((button) => {
  button.onclick = () => switchView(button.dataset.view);
});
$('#mobile-menu').onclick = () => $('.sidebar').classList.toggle('open');
$('#google-login').onclick = async () => {
  const provider = new firebase.GoogleAuthProvider();
  await firebase.signInWithPopup(auth, provider);
};
$('#logout').onclick = () => firebase.signOut(auth);

initFirebase().catch((error) => {
  console.error(error);
  $('#config-warning').textContent = `초기화 오류: ${error.message}`;
  $('#config-warning').classList.remove('hidden');
});
