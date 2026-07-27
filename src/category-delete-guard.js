import { firebaseConfig } from '../firebase-config.js';
import { removeUnknownCategoryReferences } from './time-budget-domain.js';
import { getOfflineRuntime } from './offline-runtime.js';

const appModule = await import('https://www.gstatic.com/firebasejs/11.10.0/firebase-app.js');
const authModule = await import('https://www.gstatic.com/firebasejs/11.10.0/firebase-auth.js');
const store = await import('https://www.gstatic.com/firebasejs/11.10.0/firebase-firestore.js');

const app = appModule.getApps().length ? appModule.getApp() : appModule.initializeApp(firebaseConfig);
const auth = authModule.getAuth(app);
const db = store.getFirestore(app);

const esc = (value = '') => String(value).replace(/[&<>'"]/g, (char) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;',
}[char]));

function ensureStyles() {
  if (document.querySelector('#delete-guard-styles')) return;
  const style = document.createElement('style');
  style.id = 'delete-guard-styles';
  style.textContent = `
    .delete-guard-backdrop{position:fixed;inset:0;background:rgba(13,35,30,.5);display:grid;place-items:center;padding:20px;z-index:2000}
    .delete-guard-dialog{width:min(520px,100%);background:#fffdf7;border-radius:22px;padding:24px;box-shadow:0 24px 70px rgba(0,0,0,.28)}
    .delete-guard-dialog h2{margin-bottom:8px}.delete-guard-warning{background:#fff0ed;color:#8b2e25;border-radius:14px;padding:14px;margin:16px 0}
    .delete-guard-actions{display:flex;justify-content:flex-end;gap:10px;flex-wrap:wrap;margin-top:20px}
    .delete-guard-archive{border:0;border-radius:14px;padding:13px 18px;font-weight:800;cursor:pointer;background:#ece7d8;color:#5c4c1e}
    @media(max-width:600px){.delete-guard-actions>*{flex:1}}
  `;
  document.head.append(style);
}

function closeDialog() {
  document.querySelector('#delete-guard-dialog')?.remove();
}

function showDialog(html) {
  closeDialog();
  const backdrop = document.createElement('div');
  backdrop.id = 'delete-guard-dialog';
  backdrop.className = 'delete-guard-backdrop';
  backdrop.innerHTML = `<div class="delete-guard-dialog" role="dialog" aria-modal="true">${html}</div>`;
  backdrop.addEventListener('click', (event) => { if (event.target === backdrop) closeDialog(); });
  document.body.append(backdrop);
  return backdrop;
}

function valuesChanged(original = {}, cleaned = {}) {
  return JSON.stringify(original || {}) !== JSON.stringify(cleaned || {});
}

async function commitOperations(operations) {
  for (let index = 0; index < operations.length; index += 450) {
    const batch = store.writeBatch(db);
    operations.slice(index, index + 450).forEach((operation) => {
      if (operation.type === 'delete') batch.delete(operation.ref);
      else batch.update(operation.ref, operation.data);
    });
    await batch.commit();
  }
}

async function cleanupOrphanCategoryReferences(user) {
  const root = ['users', user.uid];
  const [categories, archived, weeks, days] = await Promise.all([
    store.getDocs(store.collection(db, ...root, 'categories')),
    store.getDocs(store.collection(db, ...root, 'archivedCategories')),
    store.getDocs(store.collection(db, ...root, 'weeklyBudgets')),
    store.getDocs(store.collection(db, ...root, 'dailyBudgets')),
  ]);
  const knownCategoryIds = new Set([
    ...categories.docs.map((item) => item.id),
    ...archived.docs.map((item) => item.id),
  ]);
  const operations = [];

  weeks.docs.forEach((week) => {
    const data = week.data();
    const budgets = removeUnknownCategoryReferences(data.budgets || {}, knownCategoryIds);
    const explicitBudgetIds = Array.isArray(data.explicitBudgetIds)
      ? data.explicitBudgetIds.filter((categoryId) => knownCategoryIds.has(categoryId))
      : undefined;
    const explicitChanged = Array.isArray(data.explicitBudgetIds)
      && JSON.stringify(data.explicitBudgetIds) !== JSON.stringify(explicitBudgetIds);
    if (!valuesChanged(data.budgets || {}, budgets) && !explicitChanged) return;
    operations.push({
      type: 'update',
      ref: week.ref,
      data: {
        budgets,
        ...(explicitBudgetIds === undefined ? {} : { explicitBudgetIds }),
      },
    });
  });

  days.docs.forEach((day) => {
    const data = day.data();
    const overrides = removeUnknownCategoryReferences(data.overrides || {}, knownCategoryIds);
    if (!valuesChanged(data.overrides || {}, overrides)) return;
    operations.push(Object.keys(overrides).length
      ? { type: 'update', ref: day.ref, data: { overrides } }
      : { type: 'delete', ref: day.ref });
  });

  if (!operations.length) return false;
  await commitOperations(operations);
  document.dispatchEvent(new CustomEvent('weekly-time-budget:data-changed'));
  return true;
}

async function entryCount(user, categoryId) {
  const snapshot = await store.getDocs(store.query(
    store.collection(db, 'users', user.uid, 'entries'),
    store.where('categoryId', '==', categoryId),
  ));
  return snapshot.size;
}

async function archiveCategory(user, categoryId) {
  const categoryRef = store.doc(db, 'users', user.uid, 'categories', categoryId);
  const snapshot = await store.getDoc(categoryRef);
  if (!snapshot.exists()) throw new Error('대분류를 찾을 수 없습니다.');
  const batch = store.writeBatch(db);
  batch.set(store.doc(db, 'users', user.uid, 'archivedCategories', categoryId), {
    ...snapshot.data(),
    archivedAt: store.serverTimestamp(),
  });
  batch.delete(categoryRef);
  await batch.commit();
}

async function permanentlyDelete(user, categoryId) {
  const [entries, weeks, days, activeTimer] = await Promise.all([
    store.getDocs(store.query(
      store.collection(db, 'users', user.uid, 'entries'),
      store.where('categoryId', '==', categoryId),
    )),
    store.getDocs(store.collection(db, 'users', user.uid, 'weeklyBudgets')),
    store.getDocs(store.collection(db, 'users', user.uid, 'dailyBudgets')),
    store.getDoc(store.doc(db, 'users', user.uid, 'activeTimer', 'current')),
  ]);

  const operations = [];
  entries.docs.forEach((item) => operations.push({ type: 'delete', ref: item.ref }));
  operations.push({ type: 'delete', ref: store.doc(db, 'users', user.uid, 'categories', categoryId) });
  operations.push({ type: 'delete', ref: store.doc(db, 'users', user.uid, 'archivedCategories', categoryId) });

  weeks.docs.forEach((week) => {
    const data = week.data();
    const hasBudget = data.budgets?.[categoryId] !== undefined;
    const explicitBudgetIds = Array.isArray(data.explicitBudgetIds)
      ? data.explicitBudgetIds.filter((id) => id !== categoryId)
      : undefined;
    if (!hasBudget && explicitBudgetIds === undefined) return;
    const budgets = { ...(data.budgets || {}) };
    delete budgets[categoryId];
    operations.push({ type: 'update', ref: week.ref, data: {
      budgets,
      ...(explicitBudgetIds === undefined ? {} : { explicitBudgetIds }),
    } });
  });

  days.docs.forEach((day) => {
    const data = day.data();
    if (!Object.prototype.hasOwnProperty.call(data.overrides || {}, categoryId)) return;
    const overrides = { ...(data.overrides || {}) };
    delete overrides[categoryId];
    operations.push(Object.keys(overrides).length
      ? { type: 'update', ref: day.ref, data: { overrides } }
      : { type: 'delete', ref: day.ref });
  });

  if (activeTimer.exists() && activeTimer.data().categoryId === categoryId) {
    operations.push({ type: 'delete', ref: activeTimer.ref });
  }

  await commitOperations(operations);
}

async function cleanupOfflineCategory(runtime, userId, categoryId) {
  await runtime.store.deletePendingByCategory(userId, categoryId);
  const snapshot = await runtime.store.getSnapshot(userId);
  if (!snapshot) return;
  const cleanBudgets = (weeks = []) => weeks.map((week) => {
    const budgets = { ...(week.budgets || {}) };
    delete budgets[categoryId];
    return {
      ...week,
      budgets,
      explicitBudgetIds: Array.isArray(week.explicitBudgetIds)
        ? week.explicitBudgetIds.filter((id) => id !== categoryId)
        : week.explicitBudgetIds,
    };
  });
  const cleanDays = (days = []) => days.map((day) => {
    const overrides = { ...(day.overrides || {}) };
    delete overrides[categoryId];
    return { ...day, overrides };
  });
  await runtime.store.patchSnapshot(userId, {
    categories: (snapshot.categories || []).filter((item) => item.id !== categoryId),
    archivedCategories: (snapshot.archivedCategories || []).filter((item) => item.id !== categoryId),
    entries: (snapshot.entries || []).filter((item) => item.categoryId !== categoryId),
    weeklyBudgets: cleanBudgets(snapshot.weeklyBudgets),
    dailyBudgets: cleanDays(snapshot.dailyBudgets),
    updatedAt: Date.now(),
  });
}

async function openChoice(categoryId, categoryName) {
  const user = auth.currentUser;
  if (!user) return alert('로그인이 필요합니다.');
  const runtime = await getOfflineRuntime({ userId: user.uid, firestore: store, db });
  const [count, pendingCount] = await Promise.all([
    entryCount(user, categoryId),
    runtime.store.countPendingByCategory(user.uid, categoryId),
  ]);
  const dialog = showDialog(`
    <h2>${esc(categoryName)} 처리</h2>
    <p>완전히 삭제하거나 보관할 수 있습니다.</p>
    <div class="delete-guard-warning">
      <strong>삭제</strong>: 서버 시간 기록 ${count}건과 동기화 대기 기록 ${pendingCount}건, 일간·주간 예산과 진행 중 타이머 데이터를 완전히 삭제합니다.<br>
      <strong>보관</strong>: 새 기록과 예산에서는 숨기고 과거 기록과 이름은 유지합니다.
    </div>
    <div class="delete-guard-actions">
      <button type="button" class="secondary-button" data-action="cancel">취소</button>
      <button type="button" class="delete-guard-archive" data-action="archive">보관</button>
      <button type="button" class="danger-button" data-action="delete">삭제</button>
    </div>`);

  dialog.querySelector('[data-action="cancel"]').onclick = closeDialog;
  dialog.querySelector('[data-action="archive"]').onclick = async (event) => {
    event.currentTarget.disabled = true;
    event.currentTarget.textContent = '보관 중…';
    try { await archiveCategory(user, categoryId); location.reload(); }
    catch (error) {
      alert(`보관하지 못했습니다: ${error.message}`);
      event.currentTarget.disabled = false;
      event.currentTarget.textContent = '보관';
    }
  };
  dialog.querySelector('[data-action="delete"]').onclick = () => {
    if (!count && !pendingCount) return executeDelete(user, runtime, categoryId, categoryName, count, pendingCount);
    const warning = showDialog(`
      <h2>정말 완전히 삭제할까요?</h2>
      <div class="delete-guard-warning"><strong>${esc(categoryName)}</strong>에 연결된 서버 시간 기록 <strong>${count}건</strong>과 아직 서버에 반영되지 않은 <strong>동기화 대기 기록 ${pendingCount}건</strong>이 있습니다.<br>완전 삭제하면 대분류, 모든 시간 기록, 일간·주간 예산과 진행 중 타이머가 사라지며 복구할 수 없습니다.</div>
      <div class="delete-guard-actions">
        <button type="button" class="secondary-button" data-action="cancel">취소</button>
        <button type="button" class="danger-button" data-action="confirm">그래도 완전 삭제</button>
      </div>`);
    warning.querySelector('[data-action="cancel"]').onclick = closeDialog;
    warning.querySelector('[data-action="confirm"]').onclick = () => executeDelete(user, runtime, categoryId, categoryName, count, pendingCount);
  };
}

async function executeDelete(user, runtime, categoryId, categoryName, count, pendingCount) {
  const button = document.querySelector('#delete-guard-dialog [data-action="confirm"], #delete-guard-dialog [data-action="delete"]');
  if (button) { button.disabled = true; button.textContent = '삭제 중…'; }
  try {
    await permanentlyDelete(user, categoryId);
    await cleanupOfflineCategory(runtime, user.uid, categoryId);
    document.dispatchEvent(new CustomEvent('weekly-time-budget:entries-changed', { detail: { userId: user.uid } }));
    document.dispatchEvent(new CustomEvent('weekly-time-budget:data-changed'));
    alert(`${categoryName} 대분류와 서버 기록 ${count}건, 동기화 대기 기록 ${pendingCount}건을 완전히 삭제했습니다.`);
    location.reload();
  } catch (error) {
    alert(`완전히 삭제하지 못했습니다: ${error.message}`);
    if (button) { button.disabled = false; button.textContent = count || pendingCount ? '그래도 완전 삭제' : '삭제'; }
  }
}

ensureStyles();
authModule.onAuthStateChanged(auth, (user) => {
  if (!user) return;
  cleanupOrphanCategoryReferences(user).catch((error) => {
    console.error('고아 대분류 참조 정리 실패', error);
  });
});

document.addEventListener('click', (event) => {
  const button = event.target.closest('.category-delete');
  if (!button) return;
  event.preventDefault();
  event.stopPropagation();
  event.stopImmediatePropagation();
  const row = button.closest('.category-edit-row');
  if (!row) return;
  const name = row.querySelector('[name="name"]')?.value?.trim() || '대분류';
  openChoice(row.dataset.id, name).catch((error) => alert(`대분류 정보를 확인하지 못했습니다: ${error.message}`));
}, true);
