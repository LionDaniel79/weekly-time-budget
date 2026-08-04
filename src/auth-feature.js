let state = { configured: true, user: null, errorMessage: '', onLogin: null, onLogout: null };

function render() {
  const loginView = document.querySelector('#login-view');
  const appView = document.querySelector('#app-view');
  const userName = document.querySelector('#user-name');
  const loginButton = document.querySelector('#google-login');
  const warning = document.querySelector('#config-warning');

  loginView?.classList.toggle('hidden', Boolean(state.user));
  appView?.classList.toggle('hidden', !state.user);
  if (userName && state.user) userName.textContent = state.user.displayName || state.user.email || '사용자';
  if (loginButton) loginButton.disabled = !state.configured;
  if (warning) {
    warning.textContent = state.errorMessage || 'Firebase 설정이 필요합니다. README의 설정 방법을 확인하세요.';
    warning.classList.toggle('hidden', state.configured && !state.errorMessage);
  }
}

document.querySelector('#google-login')?.addEventListener('click', async () => {
  try { await state.onLogin?.(); }
  catch (error) { console.error(error); alert(`Google 로그인에 실패했습니다: ${error.message}`); }
});

document.querySelector('#logout')?.addEventListener('click', () => state.onLogout?.());

document.addEventListener('weekly-time-budget:auth-state', (event) => {
  state = { ...state, ...(event.detail || {}) };
  render();
});
