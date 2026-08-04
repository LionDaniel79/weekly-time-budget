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

function switchView(name, { save = true } = {}) {
  const safe = views.includes(name) ? name : 'dashboard';
  views.forEach((view) => document.querySelector(`#${view}-view`)?.classList.toggle('hidden', view !== safe));
  document.querySelectorAll('.nav-button').forEach((button) => button.classList.toggle('active', button.dataset.view === safe));
  const title = document.querySelector('#page-title');
  if (title) title.textContent = titles[safe] || '대시보드';
  document.querySelector('.sidebar')?.classList.remove('open');
  activeView = safe;
  if (save) {
    document.dispatchEvent(new CustomEvent('weekly-time-budget:save-ui-state', {
      detail: { activeView: safe },
    }));
  }
  document.dispatchEvent(new CustomEvent('weekly-time-budget:view-changed', {
    detail: { view: safe },
  }));
}

document.querySelectorAll('.nav-button').forEach((button) => {
  button.onclick = () => switchView(button.dataset.view);
});

document.querySelector('#mobile-menu')?.addEventListener('click', () => {
  document.querySelector('.sidebar')?.classList.toggle('open');
});

document.addEventListener('weekly-time-budget:shell-state', (event) => {
  switchView(event.detail?.activeView || activeView, { save: false });
});
