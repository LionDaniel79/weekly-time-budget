import { formatMinutes } from './domain.js';
import { manualEntryTimeLabel } from './manual-entry.js';
import { categoryDisplayName } from './goal-domain.js';
import { isEntryWithinCategoryEffectiveDate } from './category-effective-date.js';
import { showToast } from './app-toast.js';

const escapeHtml = (value = '') => String(value).replace(/[&<>'"]/g, (char) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;',
}[char]));

let model = {
  categories: [],
  entries: [],
  onDelete: null,
  onRetry: null,
};

function renderHistory() {
  const root = document.querySelector('#history-view');
  if (!root) return;

  const categoryById = new Map(model.categories.map((category) => [category.id, category]));
  const entries = model.entries.filter((entry) => (
    isEntryWithinCategoryEffectiveDate(entry, categoryById.get(entry.categoryId))
  ));

  root.innerHTML = `<div class="card"><div class="section-title"><h2>최근 기록</h2><span class="badge">${entries.length}건</span></div>${entries.length ? entries.map((entry) => {
    const category = categoryById.get(entry.categoryId);
    const timeDescription = manualEntryTimeLabel(entry, formatMinutes);
    const pending = entry.syncStatus === 'pending';
    const failed = entry.syncStatus === 'failed';
    return `<div class="entry"><strong>${entry.date}</strong><div><strong>${escapeHtml(category ? categoryDisplayName(category) : '삭제된 대분류')}</strong><div>${escapeHtml(timeDescription)}</div>${entry.note ? `<p class="muted">${escapeHtml(entry.note)}</p>` : ''}${pending ? '<span class="sync-status pending">동기화 대기</span>' : ''}${failed ? `<span class="sync-status failed">동기화 실패</span><button class="sync-retry" data-id="${entry.id}" type="button">다시 시도</button>` : ''}</div><div class="entry-actions"><button class="text-button delete-entry" data-id="${entry.id}">삭제</button></div></div>`;
  }).join('') : '<div class="empty-state"><h3>아직 기록이 없습니다.</h3><p>타이머 또는 수동 입력으로 첫 시간을 기록하세요.</p></div>'}</div>`;

  root.querySelectorAll('.delete-entry').forEach((button) => {
    button.onclick = () => model.onDelete?.(button.dataset.id);
  });
  root.querySelectorAll('.sync-retry').forEach((button) => {
    button.onclick = () => Promise.resolve(model.onRetry?.(button.dataset.id)).catch((error) => {
      showToast({ type: 'error', title: '동기화하지 못했습니다.', message: error.message });
    });
  });
}

document.addEventListener('weekly-time-budget:history-state', (event) => {
  model = {
    categories: Array.isArray(event.detail?.categories) ? event.detail.categories : [],
    entries: Array.isArray(event.detail?.entries) ? event.detail.entries : [],
    onDelete: event.detail?.onDelete,
    onRetry: event.detail?.onRetry,
  };
  renderHistory();
});
