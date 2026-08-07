const views = ['dashboard', 'record', 'budget', 'history', 'statistics', 'categories'];
const titles = {
  dashboard: '대시보드',
  record: '시간 기록',
  budget: '시간 예산',
  history: '기록 내역',
  statistics: '통계',
  categories: '대분류 관리',
};

let activeView = 'dashboard';

function setSidebarOpen(open) {
  const sidebar = document.querySelector('.sidebar');
  const menu = document.querySelector('#mobile-menu');
  sidebar?.classList.toggle('open', Boolean(open));
  menu?.setAttribute('aria-expanded', String(Boolean(open)));
}

function ensureViewFeedback(name) {
  const root = document.querySelector(`#${name}-view`);
  if (!root || root.childElementCount > 0 || root.textContent.trim()) return;
  root.innerHTML = '<div class="view-loading" role="status" aria-live="polite">불러오는 중…</div>';
}

function switchView(name, { save = true, force = false, closeSidebar = true } = {}) {
  const safe = views.includes(name) ? name : 'dashboard';
  const alreadyVisible = activeView === safe
    && !document.querySelector(`#${safe}-view`)?.classList.contains('hidden');
  if (alreadyVisible && !force) {
    if (closeSidebar) setSidebarOpen(false);
    return false;
  }

  ensureViewFeedback(safe);
  views.forEach((view) => document.querySelector(`#${view}-view`)?.classList.toggle('hidden', view !== safe));
  document.querySelectorAll('.nav-button').forEach((button) => {
    const selected = button.dataset.view === safe;
    button.classList.toggle('active', selected);
    button.setAttribute('aria-current', selected ? 'page' : 'false');
  });
  const title = document.querySelector('#page-title');
  if (title) title.textContent = titles[safe] || '대시보드';
  if (closeSidebar) setSidebarOpen(false);
  activeView = safe;
  if (save) {
    document.dispatchEvent(new CustomEvent('weekly-time-budget:save-ui-state', {
      detail: { activeView: safe },
    }));
  }
  document.dispatchEvent(new CustomEvent('weekly-time-budget:view-changed', {
    detail: { view: safe },
  }));
  return true;
}

document.addEventListener('click', (event) => {
  const menuButton = event.target.closest?.('#mobile-menu');
  if (menuButton) {
    event.preventDefault();
    const sidebar = document.querySelector('.sidebar');
    setSidebarOpen(!sidebar?.classList.contains('open'));
    return;
  }

  const button = event.target.closest?.('.nav-button[data-view]');
  if (!button) return;
  event.preventDefault();
  switchView(button.dataset.view);
});

document.addEventListener('weekly-time-budget:shell-state', (event) => {
  switchView(event.detail?.activeView || activeView, { save: false, closeSidebar: false });
});

export { switchView };
