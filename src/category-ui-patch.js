import { firebaseConfig } from '../firebase-config.js';
import { categoryDisplayName, normalizeGoalType } from './goal-domain.js';
import { isEntryWithinCategoryEffectiveDate } from './category-effective-date.js';

const appModule = await import('https://www.gstatic.com/firebasejs/11.10.0/firebase-app.js');
const authModule = await import('https://www.gstatic.com/firebasejs/11.10.0/firebase-auth.js');
const storeModule = await import('https://www.gstatic.com/firebasejs/11.10.0/firebase-firestore.js');

const app = appModule.getApps().length ? appModule.getApp() : appModule.initializeApp(firebaseConfig);
const auth = authModule.getAuth(app);
const db = storeModule.getFirestore(app);

const escapeHtml = (value = '') => String(value).replace(/[&<>'"]/g, (char) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;',
}[char]));

let selectedCategory = null;
let modalMode = 'choice';
let renderingHistory = false;
let renderingArchiveList = false;

function injectStyles() {
  if (document.querySelector('#category-lifecycle-styles')) return;
  const style = document.createElement('style');
  style.id = 'category-lifecycle-styles';
  style.textContent = `
    .lifecycle-modal-backdrop{position:fixed;inset:0;background:rgba(13,35,30,.48);display:grid;place-items:center;padding:20px;z-index:1000}
    .lifecycle-modal{width:min(500px,100%);background:#fffdf7;border-radius:22px;padding:24px;box-shadow:0 24px 70px rgba(0,0,0,.24)}
    .lifecycle-modal h2{margin-bottom:8px}.lifecycle-modal .warning-box{background:#fff0ed;color:#8b2e25;border-radius:14px;padding:14px;margin:16px 0}
    .lifecycle-modal-actions{display:flex;gap:10px;justify-content:flex-end;margin-top:22px;flex-wrap:wrap}
    .archive-button{background:#ece7d8;color:#5c4c1e;border:0;border-radius:14px;padding:13px 18px;font-weight:800;cursor:pointer}
    .archived-list{display:grid;gap:10px;margin-top:12px}.archived-row{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:12px;border:1px solid #e2e3dc;border-radius:12px;background:#faf8f0}
    .history-tools{display:flex;gap:10px;align-items:center;margin:12px 0 18px}.history-tools input{width:100%;border:1px solid #cdd5d0;border-radius:12px;padding:12px;background:#fff;font:inherit}
    .archived-badge{display:inline-flex;padding:3px 8px;border-radius:999px;background:#ece7d8;color:#5c4c1e;font-size:.75rem;font-weight:800;margin-left:7px}
    @media(max-width:600px){.lifecycle-modal-actions>*{flex:1}.archived-row{align-items:flex-start;flex-direction:column}.archived-row button{width:100%}}
  `;
  document.head.append(style);
}

function ensureModal() {
  let backdrop = document.querySelector('#category-lifecycle-modal');
  if (backdrop) return backdrop;
  backdrop = document.createElement('div');
  backdrop.id = 'category-lifecycle-modal';
  backdrop.className = 'lifecycle-modal-backdrop hidden';
  backdrop.innerHTML = '<div class="lifecycle-modal" role="dialog" aria-modal="true" aria-labelledby="lifecycle-title"><div id="lifecycle-content"></div></div>';
  backdrop.addEventListener('click', (event) => {
    if (event.target === backdrop) closeModal();
  });
  document.body.append(backdrop);
  return backdrop;
}

function closeModal() {
  selectedCategory = null;
  modalMode = 'choice';
  document.querySelector('#category-lifecycle-modal')?.classList.add('hidden');
}

async function countCategoryEntries(categoryId) {
  const user = auth.currentUser;
  if (!user) return 0;
  const query = storeModule.query(
    storeModule.collection(db, 'users', user.uid, 'entries'),
    storeModule.where('categoryId', '==', categoryId),
  );
  const snapshot = await storeModule.getDocs(query);
  return snapshot.size;
}

function renderChoiceModal(category, entryCount) {
  const modal = ensureModal();
  const content = modal.querySelector('#lifecycle-content');
  content.innerHTML = `
    <h2 id="lifecycle-title">${escapeHtml(categoryDisplayName(category))} 처리</h2>
    <p>이 대분류를 완전히 삭제하거나 보관할 수 있습니다.</p>
    <div class="warning-box">
      <strong>삭제</strong>: 대분류와 연결된 시간 기록 ${entryCount}건, 주간 예산 데이터를 완전히 삭제합니다.<br>
      <strong>보관</strong>: 새 기록과 예산에서는 숨기지만 과거 기록과 이름은 유지합니다.
    </div>
    <div class="lifecycle-modal-actions">
      <button type="button" class="secondary-button" data-action="cancel">취소</button>
      <button type="button" class="archive-button" data-action="archive">보관</button>
      <button type="button" class="danger-button" data-action="delete">삭제</button>
    </div>`;
  content.querySelector('[data-action="cancel"]').onclick = closeModal;
  content.querySelector('[data-action="archive"]').onclick = () => archiveCategory(category);
  content.querySelector('[data-action="delete"]').onclick = () => {
    if (entryCount > 0) renderDeleteWarning(category, entryCount);
    else permanentlyDeleteCategory(category, 0);
  };
  modal.classList.remove('hidden');
}

function renderDeleteWarning(category, entryCount) {
  modalMode = 'warning';
  const content = ensureModal().querySelector('#lifecycle-content');
  content.innerHTML = `
    <h2 id="lifecycle-title">정말 완전히 삭제할까요?</h2>
    <div class="warning-box">
      <strong>${escapeHtml(categoryDisplayName(category))}</strong>에 연결된 시간 기록 <strong>${entryCount}건</strong>이 있습니다.<br>
      삭제하면 대분류, 시간 기록, 주간 예산 데이터가 모두 사라지며 복구할 수 없습니다.
    </div>
    <div class="lifecycle-modal-actions">
      <button type="button" class="secondary-button" data-action="back">이전</button>
      <button type="button" class="danger-button" data-action="confirm-delete">그래도 완전 삭제</button>
    </div>`;
  content.querySelector('[data-action="back"]').onclick = () => renderChoiceModal(category, entryCount);
  content.querySelector('[data-action="confirm-delete"]').onclick = () => permanentlyDeleteCategory(category, entryCount);
}

async function openLifecycleModal(categoryId, name) {
  const user = auth.currentUser;
  if (!user) return alert('로그인이 필요합니다.');
  selectedCategory = { id: categoryId, name, goalType: normalizeGoalType(document.querySelector(`.category-edit-row[data-id="${categoryId}"]`)?.dataset.goalType) };
  const modal = ensureModal();
  modal.querySelector('#lifecycle-content').innerHTML = '<h2>데이터를 확인하는 중…</h2>';
  modal.classList.remove('hidden');
  try {
    const entryCount = await countCategoryEntries(categoryId);
    renderChoiceModal(selectedCategory, entryCount);
  } catch (error) {
    console.error(error);
    closeModal();
    alert(`대분류 정보를 확인하지 못했습니다: ${error.message}`);
  }
}

async function archiveCategory(category) {
  const user = auth.currentUser;
  if (!user) return;
  const archiveButton = document.querySelector('[data-action="archive"]');
  if (archiveButton) { archiveButton.disabled = true; archiveButton.textContent = '보관 중…'; }
  try {
    const categoryRef = storeModule.doc(db, 'users', user.uid, 'categories', category.id);
    const snapshot = await storeModule.getDoc(categoryRef);
    if (!snapshot.exists()) throw new Error('대분류를 찾을 수 없습니다.');
    const batch = storeModule.writeBatch(db);
    batch.set(storeModule.doc(db, 'users', user.uid, 'archivedCategories', category.id), {
      ...snapshot.data(),
      archivedAt: storeModule.serverTimestamp(),
    });
    batch.delete(categoryRef);
    await batch.commit();
    closeModal();
    location.reload();
  } catch (error) {
    console.error(error);
    alert(`보관하지 못했습니다: ${error.message}`);
    if (archiveButton) { archiveButton.disabled = false; archiveButton.textContent = '보관'; }
  }
}

async function permanentlyDeleteCategory(category, entryCount) {
  const user = auth.currentUser;
  if (!user) return;
  const button = document.querySelector('[data-action="confirm-delete"], [data-action="delete"]');
  if (button) { button.disabled = true; button.textContent = '삭제 중…'; }
  try {
    const [entriesSnapshot, weeklySnapshot] = await Promise.all([
      storeModule.getDocs(storeModule.query(
        storeModule.collection(db, 'users', user.uid, 'entries'),
        storeModule.where('categoryId', '==', category.id),
      )),
      storeModule.getDocs(storeModule.collection(db, 'users', user.uid, 'weeklyBudgets')),
    ]);

    const operations = [];
    entriesSnapshot.docs.forEach((docSnapshot) => operations.push({ type: 'delete', ref: docSnapshot.ref }));
    operations.push({ type: 'delete', ref: storeModule.doc(db, 'users', user.uid, 'categories', category.id) });
    operations.push({ type: 'delete', ref: storeModule.doc(db, 'users', user.uid, 'archivedCategories', category.id) });
    weeklySnapshot.docs.forEach((docSnapshot) => {
      const data = docSnapshot.data();
      if (!data.budgets || data.budgets[category.id] === undefined) return;
      const budgets = { ...data.budgets };
      delete budgets[category.id];
      operations.push({ type: 'set', ref: docSnapshot.ref, data: { budgets } });
    });

    for (let index = 0; index < operations.length; index += 450) {
      const batch = storeModule.writeBatch(db);
      operations.slice(index, index + 450).forEach((operation) => {
        if (operation.type === 'delete') batch.delete(operation.ref);
        else batch.set(operation.ref, operation.data, { merge: true });
      });
      await batch.commit();
    }

    closeModal();
    alert(`${categoryDisplayName(category)} 대분류와 연결된 시간 기록 ${entryCount}건을 완전히 삭제했습니다.`);
    location.reload();
  } catch (error) {
    console.error(error);
    alert(`완전히 삭제하지 못했습니다: ${error.message}`);
    if (button) { button.disabled = false; button.textContent = entryCount > 0 ? '그래도 완전 삭제' : '삭제'; }
  }
}

async function restoreCategory(categoryId) {
  const user = auth.currentUser;
  if (!user) return;
  try {
    const archivedRef = storeModule.doc(db, 'users', user.uid, 'archivedCategories', categoryId);
    const snapshot = await storeModule.getDoc(archivedRef);
    if (!snapshot.exists()) return;
    const data = snapshot.data();
    const batch = storeModule.writeBatch(db);
    batch.set(storeModule.doc(db, 'users', user.uid, 'categories', categoryId), {
      name: data.name,
      defaultBudgetMinutes: Number(data.defaultBudgetMinutes ?? data.budgetMinutes ?? 0),
      order: data.order || 999,
      goalType: normalizeGoalType(data.goalType),
      ...(data.createdDate !== undefined ? { createdDate: data.createdDate } : {}),
    });
    batch.delete(archivedRef);
    await batch.commit();
    location.reload();
  } catch (error) {
    console.error(error);
    alert(`복원하지 못했습니다: ${error.message}`);
  }
}

async function renderArchivedCategories() {
  if (renderingArchiveList) return;
  const user = auth.currentUser;
  const categoriesView = document.querySelector('#categories-view');
  if (!user || !categoriesView || categoriesView.querySelector('#archived-categories-card')) return;
  renderingArchiveList = true;
  try {
    const snapshot = await storeModule.getDocs(storeModule.collection(db, 'users', user.uid, 'archivedCategories'));
    if (!snapshot.empty) {
      const card = document.createElement('div');
      card.id = 'archived-categories-card';
      card.className = 'card';
      card.style.marginTop = '18px';
      card.innerHTML = `<div class="section-title"><div><h2>보관된 대분류</h2><p class="muted">과거 기록과 검색에는 유지되며 새 기록과 예산에서는 숨겨집니다.</p></div><span class="badge">${snapshot.size}개</span></div><div class="archived-list">${snapshot.docs.map((docSnapshot) => { const data = docSnapshot.data(); return `<div class="archived-row"><div><strong>${escapeHtml(categoryDisplayName(data))}</strong><div class="muted">기본 ${Math.round(Number(data.defaultBudgetMinutes ?? data.budgetMinutes ?? 0) / 60 * 10) / 10}시간</div></div><button type="button" class="secondary-button archived-restore" data-id="${docSnapshot.id}">복원</button></div>`; }).join('')}</div>`;
      card.querySelectorAll('.archived-restore').forEach((button) => {
        button.onclick = () => restoreCategory(button.dataset.id);
      });
      categoriesView.append(card);
    }
  } catch (error) {
    console.error('보관된 대분류 조회 실패', error);
  } finally {
    renderingArchiveList = false;
  }
}

async function patchHistoryView() {
  if (renderingHistory) return;
  const user = auth.currentUser;
  const view = document.querySelector('#history-view');
  if (!user || !view || view.dataset.archiveAware === 'true') return;
  renderingHistory = true;
  try {
    const [entriesSnapshot, activeSnapshot, archivedSnapshot] = await Promise.all([
      storeModule.getDocs(storeModule.query(
        storeModule.collection(db, 'users', user.uid, 'entries'),
        storeModule.orderBy('date', 'desc'),
      )),
      storeModule.getDocs(storeModule.collection(db, 'users', user.uid, 'categories')),
      storeModule.getDocs(storeModule.collection(db, 'users', user.uid, 'archivedCategories')),
    ]);
    const activeCategories = new Map(activeSnapshot.docs.map((docSnapshot) => [docSnapshot.id, { id: docSnapshot.id, ...docSnapshot.data() }]));
    const archivedCategories = new Map(archivedSnapshot.docs.map((docSnapshot) => [docSnapshot.id, { id: docSnapshot.id, ...docSnapshot.data() }]));
    const categoryById = new Map([...archivedCategories, ...activeCategories]);
    const entries = entriesSnapshot.docs
      .map((docSnapshot) => ({ id: docSnapshot.id, ...docSnapshot.data() }))
      .filter((entry) => isEntryWithinCategoryEffectiveDate(entry, categoryById.get(entry.categoryId)));

    view.dataset.archiveAware = 'true';
    view.innerHTML = `<div class="card"><div class="section-title"><h2>최근 기록</h2><span class="badge">${entries.length}건</span></div><div class="history-tools"><input id="history-category-search" type="search" placeholder="대분류 이름 또는 메모 검색" aria-label="기록 검색"></div><div id="archive-aware-entry-list">${entries.length ? entries.map((entry) => {
      const activeCategory = activeCategories.get(entry.categoryId);
      const archivedCategory = archivedCategories.get(entry.categoryId);
      const category = activeCategory || archivedCategory;
      const name = category ? categoryDisplayName(category) : '삭제된 대분류';
      const searchable = `${name} ${entry.note || ''} ${entry.date || ''}`.toLowerCase();
      return `<div class="entry archive-aware-entry" data-search="${escapeHtml(searchable)}"><strong>${escapeHtml(entry.date || '')}</strong><div><strong>${escapeHtml(name)}</strong>${archivedCategory ? '<span class="archived-badge">보관</span>' : ''}<div>${escapeHtml(entry.startTime || '')}–${escapeHtml(entry.endTime || '')} · ${Math.round(Number(entry.durationMinutes) || 0)}분</div>${entry.note ? `<p class="muted">${escapeHtml(entry.note)}</p>` : ''}</div><div class="entry-actions"><button class="text-button lifecycle-delete-entry" data-id="${entry.id}">삭제</button></div></div>`;
    }).join('') : '<div class="empty-state"><h3>아직 기록이 없습니다.</h3><p>타이머 또는 수동 입력으로 첫 시간을 기록하세요.</p></div>'}</div></div>`;

    view.querySelector('#history-category-search')?.addEventListener('input', (event) => {
      const query = event.target.value.trim().toLowerCase();
      view.querySelectorAll('.archive-aware-entry').forEach((row) => {
        row.classList.toggle('hidden', query && !row.dataset.search.includes(query));
      });
    });
    view.querySelectorAll('.lifecycle-delete-entry').forEach((button) => {
      button.onclick = async () => {
        if (!confirm('이 시간 기록을 삭제할까요?')) return;
        await storeModule.deleteDoc(storeModule.doc(db, 'users', user.uid, 'entries', button.dataset.id));
        location.reload();
      };
    });
  } catch (error) {
    console.error('기록 내역 보관 정보 표시 실패', error);
  } finally {
    renderingHistory = false;
  }
}

function interceptDeleteButtons() {
  document.addEventListener('click', (event) => {
    const button = event.target.closest('.category-delete');
    if (!button) return;
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    const row = button.closest('.category-edit-row');
    if (!row) return;
    const name = row.querySelector('[name="name"]')?.value?.trim() || '대분류';
    openLifecycleModal(row.dataset.id, name);
  }, true);
}

function patchViews() {
  renderArchivedCategories();
  patchHistoryView();
}

injectStyles();
ensureModal();
interceptDeleteButtons();
const observer = new MutationObserver(patchViews);
observer.observe(document.body, { childList: true, subtree: true });
authModule.onAuthStateChanged(auth, patchViews);
patchViews();
