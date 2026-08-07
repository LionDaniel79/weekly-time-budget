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

function switchView(name, { save = true, force = false } = {}) {
  const safe = views.includes(name) ? name : 'dashboard';
  const alreadyVisible = activeView === safe
    && !document.querySelector(`#${safe}-view`)?.classList.contains('hidden');
  if (alreadyVisible && !force) {
    setSidebarOpen(false);
    return false;
  }

  views.forEach((view) => document.querySelector(`#${view}-view`)?.classList.toggle('hidden', view !== safe));
  document.querySelectorAll('.nav-button').forEach((button) => {
    const selected = button.dataset.view === safe;
    button.classList.toggle('active', selected);
    button.setAttribute('aria-current', selected ? 'page' : 'false');
  });
  const title = document.querySelector('#page-title');
  if (title) title.textContent = titles[safe] || '대시보드';
  setSidebarOpen(false);
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
    event.stopPropagation();
    const sidebar = document.querySelector('.sidebar');
    setSidebarOpen(!sidebar?.classList.contains('open'));
    return;
  }

  const button = event.target.closest?.('.nav-button[data-view]');
  if (!button) return;
  event.preventDefault();
  event.stopPropagation();
  switchView(button.dataset.view);
}, true);

document.addEventListener('weekly-time-budget:shell-state', (event) => {
  switchView(event.detail?.activeView || activeView, { save: false });
});

export { switchView };
