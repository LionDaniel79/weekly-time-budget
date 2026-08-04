import { readFile, writeFile } from 'node:fs/promises';

const read = (path) => readFile(path, 'utf8');
const write = (path, content) => writeFile(path, content, 'utf8');

const authFeature = `let state = { configured: true, user: null, errorMessage: '', onLogin: null, onLogout: null };

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
  catch (error) { console.error(error); alert(\`Google 로그인에 실패했습니다: \${error.message}\`); }
});

document.querySelector('#logout')?.addEventListener('click', () => state.onLogout?.());

document.addEventListener('weekly-time-budget:auth-state', (event) => {
  state = { ...state, ...(event.detail || {}) };
  render();
});
`;
await write('src/auth-feature.js', authFeature);

let app = await read('src/app.js');
app = app.replace("    $('#config-warning').classList.remove('hidden');\n    $('#google-login').disabled = true;\n    return;", "    publishAuthState({ configured: false });\n    return;");
app = app.replace("    $('#login-view').classList.toggle('hidden', Boolean(user));\n    $('#app-view').classList.toggle('hidden', !user);\n", "    publishAuthState({ user });\n");
app = app.replace("\n    $('#user-name').textContent = user.displayName || user.email;", '');
app = app.replace(/\n\$\('#google-login'\)\.onclick = async \(\) => \{[\s\S]*?\n\$\('#logout'\)\.onclick = \(\) => firebase\.signOut\(auth\);\n/, '\n');
app = app.replace("initFirebase().catch((error) => {\n  console.error(error);\n  $('#config-warning').textContent = `초기화 오류: ${error.message}`;\n  $('#config-warning').classList.remove('hidden');\n});", "initFirebase().catch((error) => {\n  console.error(error);\n  publishAuthState({ configured: false, errorMessage: `초기화 오류: ${error.message}` });\n});");
const marker = 'async function initFirebase() {';
app = app.replace(marker, `function publishAuthState(overrides = {}) {\n  document.dispatchEvent(new CustomEvent('weekly-time-budget:auth-state', {\n    detail: {\n      configured,\n      user: state.user,\n      onLogin: async () => {\n        if (!firebase || !auth) throw new Error('로그인 기능을 준비하는 중입니다. 잠시 후 다시 눌러주세요.');\n        await firebase.signInWithPopup(auth, new firebase.GoogleAuthProvider());\n      },\n      onLogout: () => firebase?.signOut(auth),\n      ...overrides,\n    },\n  }));\n}\n\n${marker}`);
await write('src/app.js', app);

let html = await read('index.html');
html = html.replace('  <script type="module" src="./src/app-shell.js"></script>\n', '  <script type="module" src="./src/app-shell.js"></script>\n  <script type="module" src="./src/auth-feature.js"></script>\n');
await write('index.html', html);

let worker = await read('service-worker.js');
worker = worker.replace("  './src/app-shell.js',\n", "  './src/app-shell.js',\n  './src/auth-feature.js',\n");
await write('service-worker.js', worker);
