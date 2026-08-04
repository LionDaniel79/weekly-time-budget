import { readFile, writeFile } from 'node:fs/promises';

const read = (path) => readFile(path, 'utf8');
const write = (path, content) => writeFile(path, content);

let app = await read('src/app.js');
app = app.replace(/const titles = \{[\s\S]*?\n\};\n/, '');
app = app.replace(/\nfunction switchView\([\s\S]*?\n}\n\nfunction restoreVisibleState\(\) \{/, '\nfunction restoreVisibleState() {');
app = app.replace("  switchView(restored.activeView, { save: false });\n", "  document.dispatchEvent(new CustomEvent('weekly-time-budget:shell-state', { detail: { activeView: restored.activeView } }));\n");
app = app.replace(/\ndocument\.querySelectorAll\('\.nav-button'\)[^\n]*\n/, '\n');
app = app.replace(/\n\$\('#mobile-menu'\)\.onclick = [^\n]*\n/, '\n');
await write('src/app.js', app);

let html = await read('index.html');
if (!html.includes('./src/app-shell.js')) {
  html = html.replace('  <script type="module" src="./src/app.js"></script>', '  <script type="module" src="./src/app-shell.js"></script>\n  <script type="module" src="./src/app.js"></script>');
}
await write('index.html', html);

let worker = await read('service-worker.js');
if (!worker.includes("'./src/app-shell.js'")) {
  worker = worker.replace("  './src/history-feature.js',", "  './src/history-feature.js',\n  './src/app-shell.js',");
}
await write('service-worker.js', worker);

let ci = await read('.github/workflows/ci.yml');
if (!ci.includes('_site/src/app-shell.js')) {
  ci = ci.replace('          test -f _site/src/history-feature.js', '          test -f _site/src/history-feature.js\n          test -f _site/src/app-shell.js');
}
await write('.github/workflows/ci.yml', ci);
