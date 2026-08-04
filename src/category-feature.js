import { categoryDisplayName, normalizeGoalType } from './goal-domain.js';

const escapeHtml = (value = '') => String(value).replace(/[&<>'"]/g, (char) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;',
}[char]));
const defaultBudgetMinutes = (category) => Number(category.defaultBudgetMinutes ?? category.budgetMinutes ?? 0);

let model = {
  categories: [],
  archivedCategories: [],
  onSave: null,
  onArchive: null,
  onRestore: null,
  onDelete: null,
};

function renderCategories() {
  const root = document.querySelector('#categories-view');
  if (!root) return;
  const empty = document.querySelector('#empty-template')?.innerHTML || '';
  const archivedHtml = model.archivedCategories.length
    ? `<div class="card"><div class="section-title"><div><h2>보관된 대분류</h2><p class="muted">과거 기록은 유지되고 새 기록과 예산에서는 숨겨집니다.</p></div><span class="badge">${model.archivedCategories.length}개</span></div><div class="category-list">${model.archivedCategories.map((category) => `<div class="category-item archived-category-row" data-id="${category.id}"><span>${escapeHtml(categoryDisplayName(category))}</span><button class="secondary-button category-restore" type="button">복원</button></div>`).join('')}</div></div>`
    : '';

  root.innerHTML = `<div class="grid grid-2"><div class="card"><h2>대분류 추가</h2><form id="category-add" class="form-grid"><label>이름<input name="name" placeholder="예: 논문" required maxlength="30"></label><label>기본 주간 예산(시간)<input name="hours" type="number" min="0" step="0.5" value="0"></label><label class="restraint-goal-option"><input name="restraint" type="checkbox"><span><strong>절제 목표</strong><small>설정한 예산시간 이하로 사용하는 것이 목표입니다.</small></span></label><button class="primary-button">추가</button></form></div><div class="card"><h2>등록된 대분류</h2>${model.categories.length ? `<div class="category-list">${model.categories.map((category) => `<form class="category-item category-edit-row" data-id="${category.id}" data-goal-type="${normalizeGoalType(category.goalType)}"><span class="category-name-edit"><input name="name" value="${escapeHtml(category.name)}" required aria-label="대분류 이름">${normalizeGoalType(category.goalType) === 'restraint' ? '<span class="goal-type-label">(절제)</span>' : ''}</span><input name="hours" type="number" min="0" step="0.5" value="${defaultBudgetMinutes(category) / 60}" aria-label="${escapeHtml(categoryDisplayName(category))} 기본 예산 시간"><div class="category-row-actions"><button class="secondary-button" type="submit">수정</button><button class="archive-button category-archive" type="button">보관</button><button class="danger-button category-delete" type="button">삭제</button></div></form>`).join('')}</div>` : empty}</div>${archivedHtml}</div>`;

  const addForm = root.querySelector('#category-add');
  addForm.onsubmit = async (event) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    await model.onSave?.({
      name: data.get('name'),
      defaultBudgetMinutes: Number(data.get('hours')) * 60,
      goalType: data.get('restraint') === 'on' ? 'restraint' : 'growth',
    });
    root.querySelector('#category-add input[name="name"]')?.focus();
  };

  root.querySelectorAll('.category-edit-row').forEach((form) => {
    form.onsubmit = async (event) => {
      event.preventDefault();
      await model.onSave?.({
        id: form.dataset.id,
        name: form.querySelector('[name="name"]').value,
        defaultBudgetMinutes: Number(form.querySelector('[name="hours"]').value) * 60,
      });
      alert('대분류를 수정했습니다.');
    };
    form.querySelector('.category-archive').onclick = async () => {
      if (!confirm('이 대분류를 보관할까요? 과거 기록은 유지됩니다.')) return;
      await model.onArchive?.(form.dataset.id);
    };
    form.querySelector('.category-delete').onclick = () => model.onDelete?.(form.dataset.id);
  });

  root.querySelectorAll('.archived-category-row').forEach((row) => {
    row.querySelector('.category-restore').onclick = () => model.onRestore?.(row.dataset.id);
  });
}

document.addEventListener('weekly-time-budget:category-state', (event) => {
  model = {
    categories: Array.isArray(event.detail?.categories) ? event.detail.categories : [],
    archivedCategories: Array.isArray(event.detail?.archivedCategories) ? event.detail.archivedCategories : [],
    onSave: event.detail?.onSave,
    onArchive: event.detail?.onArchive,
    onRestore: event.detail?.onRestore,
    onDelete: event.detail?.onDelete,
  };
  renderCategories();
});
