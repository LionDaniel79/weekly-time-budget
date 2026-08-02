let currentView = document.querySelector('.nav-button.active[data-view]')?.dataset.view || 'dashboard';

document.addEventListener('click', (event) => {
  const button = event.target.closest?.('.nav-button[data-view]');
  if (!button) return;
  const nextView = button.dataset.view;
  queueMicrotask(() => {
    if (!nextView || nextView === currentView) return;
    currentView = nextView;
    document.dispatchEvent(new CustomEvent('weekly-time-budget:view-changed', {
      detail: { view: nextView },
    }));
  });
});

document.addEventListener('weekly-time-budget:ui-state-restored', (event) => {
  if (event.detail?.activeView) currentView = event.detail.activeView;
});
