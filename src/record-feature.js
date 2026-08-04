import { minutesBetween, toDateKey } from './domain.js';
import { MANUAL_INPUT_MODES, createManualDurationEntry } from './manual-entry.js';
import { categoryDisplayName } from './goal-domain.js';
import { filterCategoriesActiveOnDate, isCategoryActiveOnDate } from './category-effective-date.js';

const $ = (selector) => document.querySelector(selector);
const escapeHtml = (value = '') => String(value).replace(/[&<>'"]/g, (char) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;',
}[char]));

let model = {
  categories: [],
  activeRecordTab: 'timer',
  manualInputMode: MANUAL_INPUT_MODES.TIME_RANGE,
  manualCategoryId: '',
  timer: null,
  timerInterval: null,
  onSaveEntry: null,
  onUiChange: null,
  onTimerChange: null,
};

function formatClock(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return [h, m, s].map((value) => String(value).padStart(2, '0')).join(':');
}

function categoryOptionHtml({ date, selectedId = '' }) {
  return filterCategoriesActiveOnDate(model.categories, date)
    .map((category) => `<option value="${category.id}" ${category.id === selectedId ? 'selected' : ''}>${escapeHtml(categoryDisplayName(category))}</option>`)
    .join('');
}

function timerForm() {
  const elapsed = model.timer ? Math.floor((Date.now() - model.timer.startedAt) / 1000) : 0;
  const selectedCategoryId = model.timer?.categoryId || '';
  return `<div class="form-grid"><label>대분류<select id="timer-category" ${model.timer ? 'disabled' : ''}><option value="">선택하세요</option>${categoryOptionHtml({ date: toDateKey(new Date()), selectedId: selectedCategoryId })}</select></label><label>메모(선택)<textarea id="timer-note" rows="2" ${model.timer ? 'disabled' : ''}>${escapeHtml(model.timer?.note || '')}</textarea></label></div><div id="timer-display" class="timer">${formatClock(elapsed)}</div><div class="actions"><button id="timer-action" class="primary-button">${model.timer ? '종료하고 저장' : '타이머 시작'}</button>${model.timer ? '<button id="timer-cancel" class="secondary-button">취소</button>' : ''}</div>`;
}

function manualForm() {
  const now = new Date();
  const end = now.toTimeString().slice(0, 5);
  const start = new Date(now.getTime() - 3600000).toTimeString().slice(0, 5);
  const durationMode = model.manualInputMode === MANUAL_INPUT_MODES.DURATION;
  return `<form id="manual-form" class="form-grid" novalidate><div class="manual-mode-switch" role="group" aria-label="수동 입력 방식"><button type="button" class="tab-button ${durationMode ? '' : 'active'}" data-manual-mode="time-range" aria-pressed="${durationMode ? 'false' : 'true'}">시작·종료 시각</button><button type="button" class="tab-button ${durationMode ? 'active' : ''}" data-manual-mode="duration" aria-pressed="${durationMode ? 'true' : 'false'}">분 직접 입력</button></div><label>대분류<select id="manual-category" required><option value="">선택하세요</option>${categoryOptionHtml({ date: toDateKey(now), selectedId: model.manualCategoryId })}</select></label><label>날짜<input id="manual-date" type="date" value="${toDateKey(now)}" required></label>${durationMode ? `<label>직접 기록할 시간<div class="duration-input-row"><input id="manual-duration" type="number" min="1" max="1440" step="1" inputmode="numeric" autocomplete="off" required><span aria-hidden="true">분</span></div></label>` : `<div class="time-fields"><label>시작<input id="manual-start" type="time" value="${start}" required></label><label>종료<input id="manual-end" type="time" value="${end}" required></label></div>`}<label>메모(선택)<textarea id="manual-note" rows="2"></textarea></label><button class="primary-button" type="submit">기록 저장</button></form>`;
}

function updateUi(patch) {
  Object.assign(model, patch);
  model.onUiChange?.({
    activeRecordTab: model.activeRecordTab,
    manualInputMode: model.manualInputMode,
    manualCategoryId: model.manualCategoryId,
  });
}

function setTimer(timer) {
  model.timer = timer;
  model.onTimerChange?.(timer);
}

function refreshManualCategoryOptions() {
  const select = $('#manual-category');
  const date = $('#manual-date')?.value;
  if (!select || !date) return;
  const selectedId = select.value;
  select.innerHTML = `<option value="">선택하세요</option>${categoryOptionHtml({ date, selectedId })}`;
  if (![...select.options].some((option) => option.value === selectedId)) {
    select.value = '';
    updateUi({ manualCategoryId: '' });
  }
}

function bindTimer() {
  const action = $('#timer-action');
  if (!action) return;
  action.onclick = async () => {
    if (!model.timer) {
      const categoryId = $('#timer-category').value;
      if (!categoryId) return alert('대분류를 선택하세요.');
      const startedDate = toDateKey(new Date());
      const category = model.categories.find((item) => item.id === categoryId);
      if (!category || !isCategoryActiveOnDate(category, startedDate)) {
        return alert('이 대분류는 추가일부터 타이머를 시작할 수 있습니다.');
      }
      setTimer({ categoryId, note: $('#timer-note').value.trim(), startedAt: Date.now() });
      renderRecord();
      clearInterval(model.timerInterval);
      model.timerInterval = setInterval(() => {
        const display = $('#timer-display');
        if (display && model.timer) display.textContent = formatClock(Math.floor((Date.now() - model.timer.startedAt) / 1000));
      }, 1000);
      return;
    }

    const timer = model.timer;
    const endedAt = Date.now();
    await model.onSaveEntry?.({
      categoryId: timer.categoryId,
      note: timer.note,
      date: toDateKey(new Date(timer.startedAt)),
      durationMinutes: Math.max(1, Math.round((endedAt - timer.startedAt) / 60000)),
      startTime: new Date(timer.startedAt).toTimeString().slice(0, 5),
      endTime: new Date(endedAt).toTimeString().slice(0, 5),
      source: 'timer',
    });
    clearInterval(model.timerInterval);
    model.timerInterval = null;
    setTimer(null);
    renderRecord();
  };

  const cancel = $('#timer-cancel');
  if (cancel) cancel.onclick = () => {
    clearInterval(model.timerInterval);
    model.timerInterval = null;
    setTimer(null);
    renderRecord();
  };
}

function bindManual() {
  $('#manual-date')?.addEventListener('change', refreshManualCategoryOptions);
  document.querySelectorAll('[data-manual-mode]').forEach((button) => {
    button.onclick = () => {
      updateUi({
        manualCategoryId: $('#manual-category')?.value || model.manualCategoryId,
        manualInputMode: button.dataset.manualMode,
      });
      renderRecord();
    };
  });

  const form = $('#manual-form');
  if (!form) return;
  form.onsubmit = async (event) => {
    event.preventDefault();
    const submit = form.querySelector('[type="submit"]');
    const categoryId = $('#manual-category').value;
    const date = $('#manual-date').value;
    if (!categoryId) return alert('대분류를 선택하세요.');
    if (!date) return alert('날짜를 선택하세요.');
    const category = model.categories.find((item) => item.id === categoryId);
    if (!category || !isCategoryActiveOnDate(category, date)) {
      alert('이 대분류는 추가일 이전 날짜에 기록할 수 없습니다.');
      refreshManualCategoryOptions();
      return;
    }

    updateUi({ manualCategoryId: categoryId });
    let entry;
    try {
      if (model.manualInputMode === MANUAL_INPUT_MODES.DURATION) {
        entry = createManualDurationEntry({
          categoryId,
          date,
          note: $('#manual-note').value,
          durationMinutes: $('#manual-duration').value,
        });
      } else {
        const startTime = $('#manual-start').value;
        const endTime = $('#manual-end').value;
        if (!startTime || !endTime) throw new Error('시간 범위를 확인하세요.');
        const durationMinutes = minutesBetween(startTime, endTime);
        if (durationMinutes <= 0 || durationMinutes > 1440) throw new Error('시간 범위를 확인하세요.');
        entry = { categoryId, note: $('#manual-note').value.trim(), date, durationMinutes, startTime, endTime, source: 'manual' };
      }
      submit.disabled = true;
      await model.onSaveEntry?.(entry, { onLocalSaved: () => { if (form.isConnected) renderRecord(); } });
    } catch (error) {
      if (!/오프라인 저장소|기기에 기록/.test(String(error.message || error))) {
        alert(error instanceof Error ? error.message : String(error));
      }
    } finally {
      if (submit.isConnected) submit.disabled = false;
    }
  };
}

function renderRecord() {
  const root = $('#record-view');
  if (!root) return;
  root.innerHTML = `<div class="tabs"><button class="tab-button ${model.activeRecordTab === 'timer' ? 'active' : ''}" data-record-tab="timer">타이머</button><button class="tab-button ${model.activeRecordTab === 'manual' ? 'active' : ''}" data-record-tab="manual">수동 입력</button></div><div class="card">${model.activeRecordTab === 'timer' ? timerForm() : manualForm()}</div>`;
  root.querySelectorAll('[data-record-tab]').forEach((button) => {
    button.onclick = () => {
      updateUi({ activeRecordTab: button.dataset.recordTab });
      renderRecord();
    };
  });
  if (model.activeRecordTab === 'timer') bindTimer();
  else bindManual();
}

document.addEventListener('weekly-time-budget:record-state', (event) => {
  model = {
    ...model,
    categories: Array.isArray(event.detail?.categories) ? event.detail.categories : [],
    activeRecordTab: event.detail?.activeRecordTab || 'timer',
    manualInputMode: event.detail?.manualInputMode || MANUAL_INPUT_MODES.TIME_RANGE,
    manualCategoryId: event.detail?.manualCategoryId || '',
    timer: event.detail?.timer || null,
    onSaveEntry: event.detail?.onSaveEntry,
    onUiChange: event.detail?.onUiChange,
    onTimerChange: event.detail?.onTimerChange,
  };
  renderRecord();
});
