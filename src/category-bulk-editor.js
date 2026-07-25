import { firebaseConfig } from '../firebase-config.js';
import { reorderItems } from './domain.js';

const appModule = await import('https://www.gstatic.com/firebasejs/11.10.0/firebase-app.js');
const authModule = await import('https://www.gstatic.com/firebasejs/11.10.0/firebase-auth.js');
const storeModule = await import('https://www.gstatic.com/firebasejs/11.10.0/firebase-firestore.js');

const app = appModule.getApps().length ? appModule.getApp() : appModule.initializeApp(firebaseConfig);
const auth = authModule.getAuth(app);
const db = storeModule.getFirestore(app);
const RETURN_VIEW_KEY = 'weekly-time-budget:return-to-categories';

let patchScheduled = false;
let applying = false;

function injectStyles() {
  if (document.querySelector('#category-bulk-editor-styles')) return;
  const style = document.createElement('style');
  style.id = 'category-bulk-editor-styles';
  style.textContent = `
    .category-bulk-actions{display:flex;justify-content:flex-end;margin-top:18px}
    .category-bulk-actions .primary-button{min-width:190px}
    .category-order-actions{display:flex;gap:6px}
    .category-order-button{border:1px solid #ccd4cf;background:#fff;border-radius:10px;padding:9px 11px;font-weight:800;cursor:pointer}
    .category-order-button:disabled{opacity:.35;cursor:not-allowed}
    @media(max-width:700px){.category-bulk-actions .primary-button{width:100%}}
  `;
  document.head.append(style);
}

function categoryRows() {
  return [...document.querySelectorAll('#categories-view .category-edit-row')];
}

function updateOrderButtons() {
  const rows = categoryRows();
  rows.forEach((row, index) => {
    const up = row.querySelector('.category-up');
    const down = row.querySelector('.category-down');
    if (up) up.disabled = index === 0;
    if (down) down.disabled = index === rows.length - 1;
  });
}

function moveRow(row, direction) {
  const rows = categoryRows().map((element) => ({ id: element.dataset.id, element }));
  const reordered = reorderItems(rows, row.dataset.id, direction);
  const list = row.parentElement;
  reordered.forEach((item) => list.append(item.element));
  updateOrderButtons();
}

async function applyAllCategories(button) {
  if (applying) return;
  const user = auth.currentUser;
  if (!user) return alert('로그인이 필요합니다.');

  const rows = categoryRows();
  const updates = [];
  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index];
    const nameInput = row.querySelector('[name="name"]');
    const hoursInput = row.querySelector('[name="hours"]');
    const name = nameInput?.value.trim() || '';
    const hours = Number(hoursInput?.value);
    if (!name) {
      alert('대분류 이름을 입력하세요.');
      nameInput?.focus();
      return;
    }
    if (!Number.isFinite(hours) || hours < 0) {
      alert(`${name}의 기본 예산 시간을 확인하세요.`);
      hoursInput?.focus();
      return;
    }
    updates.push({
      id: row.dataset.id,
      name,
      defaultBudgetMinutes: hours * 60,
      order: index + 1,
    });
  }

  applying = true;
  const originalText = button.textContent;
  button.disabled = true;
  button.textContent = '적용 중…';
  try {
    const batch = storeModule.writeBatch(db);
    updates.forEach((update) => {
      batch.set(
        storeModule.doc(db, 'users', user.uid, 'categories', update.id),
        {
          name: update.name,
          defaultBudgetMinutes: update.defaultBudgetMinutes,
          order: update.order,
        },
        { merge: true },
      );
    });
    await batch.commit();
    sessionStorage.setItem(RETURN_VIEW_KEY, 'true');
    alert('대분류 이름, 기본 예산, 순서를 일괄 적용했습니다.');
    location.reload();
  } catch (error) {
    console.error(error);
    alert(`대분류 변경사항을 적용하지 못했습니다: ${error.message}`);
    button.disabled = false;
    button.textContent = originalText;
    applying = false;
  }
}

function enhanceCategoryEditor() {
  const view = document.querySelector('#categories-view');
  const rows = categoryRows();
  if (!view || !rows.length) return;

  rows.forEach((row) => {
    row.querySelector('button[type="submit"]')?.remove();
    row.onsubmit = (event) => {
      event.preventDefault();
      document.querySelector('#category-bulk-apply')?.click();
    };

    const actions = row.querySelector('.category-row-actions');
    if (!actions) return;
    let orderActions = actions.querySelector('.category-order-actions');
    if (!orderActions) {
      orderActions = document.createElement('div');
      orderActions.className = 'category-order-actions';
      actions.prepend(orderActions);
    }
    if (orderActions.dataset.bulkOrder !== 'true') {
      orderActions.dataset.bulkOrder = 'true';
      orderActions.innerHTML = `
        <button type="button" class="category-order-button category-up" aria-label="위로 이동">↑</button>
        <button type="button" class="category-order-button category-down" aria-label="아래로 이동">↓</button>`;
      orderActions.querySelector('.category-up').onclick = () => moveRow(row, -1);
      orderActions.querySelector('.category-down').onclick = () => moveRow(row, 1);
    }
  });

  if (!view.querySelector('#category-bulk-apply')) {
    const registeredCard = rows[0].closest('.card');
    const actions = document.createElement('div');
    actions.className = 'category-bulk-actions';
    actions.innerHTML = '<button id="category-bulk-apply" type="button" class="primary-button">대분류 변경사항 적용</button>';
    actions.querySelector('button').onclick = (event) => applyAllCategories(event.currentTarget);
    registeredCard?.append(actions);
  }
  updateOrderButtons();
}

function schedulePatch() {
  if (patchScheduled) return;
  patchScheduled = true;
  queueMicrotask(() => {
    patchScheduled = false;
    enhanceCategoryEditor();
  });
}

function restoreCategoryView(user) {
  if (!user || sessionStorage.getItem(RETURN_VIEW_KEY) !== 'true') return;
  sessionStorage.removeItem(RETURN_VIEW_KEY);
  requestAnimationFrame(() => {
    document.querySelector('[data-view="categories"]')?.click();
  });
}

injectStyles();
const observer = new MutationObserver(schedulePatch);
observer.observe(document.body, { childList: true, subtree: true });
authModule.onAuthStateChanged(auth, (user) => {
  schedulePatch();
  restoreCategoryView(user);
});
schedulePatch();
