const TIMER_KEY = 'weekly-time-budget:last-timer-category';
const MANUAL_KEY = 'weekly-time-budget:last-manual-category';
let restoreScheduled = false;

function rememberTimerCategory(event) {
  if (!event.target.closest?.('#timer-action')) return;
  const select = document.querySelector('#timer-category');
  if (select?.value) localStorage.setItem(TIMER_KEY, select.value);
}

function rememberManualCategory(event) {
  if (!event.target.matches?.('#manual-form')) return;
  const select = event.target.querySelector('#manual-category');
  if (select?.value) localStorage.setItem(MANUAL_KEY, select.value);
}

function restoreSelect(selector, storageKey) {
  const select = document.querySelector(selector);
  if (!select || select.disabled) return;
  const saved = localStorage.getItem(storageKey);
  if (!saved) return;
  const option = [...select.options].find((item) => item.value === saved);
  if (!option) {
    localStorage.removeItem(storageKey);
    return;
  }
  if (select.value !== saved) select.value = saved;
}

function restoreSelections() {
  restoreSelect('#timer-category', TIMER_KEY);
  restoreSelect('#manual-category', MANUAL_KEY);
}

function scheduleRestore() {
  if (restoreScheduled) return;
  restoreScheduled = true;
  queueMicrotask(() => {
    restoreScheduled = false;
    restoreSelections();
  });
}

document.addEventListener('click', rememberTimerCategory, true);
document.addEventListener('submit', rememberManualCategory, true);

const observer = new MutationObserver(scheduleRestore);
observer.observe(document.body, { childList: true, subtree: true });
scheduleRestore();
