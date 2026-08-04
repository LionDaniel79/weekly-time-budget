import { readFile, writeFile } from 'node:fs/promises';

const appPath = 'src/app.js';
let app = await readFile(appPath, 'utf8');

app = app.replace("import { createAppDataSource } from './app-data-source.js';\n", "import { createAppDataSource } from './app-data-source.js';\nimport { createAppSessionState } from './app-session-state.js';\n");
app = app.replace("  createDefaultUiState,\n  mergeUiState,\n  normalizeUiState,\n", "  createDefaultUiState,\n");
app = app.replace('let dataSource;\nlet loadingData = false;', 'let dataSource;\nlet sessionState;\nlet loadingData = false;');

app = app.replace(/function applySnapshotToState\(snapshot = \{\}\) \{[\s\S]*?\n\}\n\n/, '');
app = app.replace(/async function persistUiState\(partial\) \{[\s\S]*?\n\}\n\n/, `async function saveUiState(partial) {\n  if (!sessionState) return;\n  state.uiState = await sessionState.persist(state.uiState, partial);\n  window.__weeklyTimeBudgetUiState = state.uiState;\n}\n\n`);
app = app.replace(/async function restoreCachedState\(\) \{[\s\S]*?\n\}\n\n/, '');

const runtimeMarker = `    } catch (error) {\n      console.error('오프라인 저장소 초기화 실패', error);\n      showLocalSaveError();\n      return;\n    }\n\n    const hadSnapshot = await restoreCachedState();`;
const runtimeReplacement = `    } catch (error) {\n      console.error('오프라인 저장소 초기화 실패', error);\n      showLocalSaveError();\n      return;\n    }\n\n    sessionState = createAppSessionState({\n      store: state.offlineRuntime.store,\n      userId: user.uid,\n      uiContext,\n      onSnapshot: (snapshot) => {\n        if (Array.isArray(snapshot?.categories)) state.categories = snapshot.categories;\n        if (Array.isArray(snapshot?.entries)) state.remoteEntries = snapshot.entries;\n      },\n      onUiState: (uiState) => {\n        state.uiState = uiState;\n        state.activeView = uiState.activeView;\n        state.activeRecordTab = uiState.record.tab;\n        state.manualInputMode = uiState.record.manualMode;\n        window.__weeklyTimeBudgetUiState = uiState;\n      },\n      refreshMergedEntries,\n    });\n\n    const hadSnapshot = await sessionState.restore();`;
if (!app.includes(runtimeMarker)) throw new Error('offline runtime marker not found');
app = app.replace(runtimeMarker, runtimeReplacement);
app = app.replace(/persistUiState\(/g, 'saveUiState(');
app = app.replace('      state.offlineRuntime = null;\n      return;', '      state.offlineRuntime = null;\n      sessionState = null;\n      return;');
await writeFile(appPath, app);

await writeFile('src/app-session-state.js', `import {\n  createDefaultUiState,\n  mergeUiState,\n  normalizeUiState,\n} from './ui-session-state.js';\n\nexport function createAppSessionState({\n  store,\n  userId,\n  uiContext,\n  onSnapshot = () => {},\n  onUiState = () => {},\n  refreshMergedEntries = async () => {},\n}) {\n  if (!store || !userId || typeof uiContext !== 'function') {\n    throw new Error('Session state dependencies are required.');\n  }\n\n  return {\n    async persist(currentUiState, partial) {\n      const next = mergeUiState(\n        currentUiState || createDefaultUiState(uiContext()),\n        partial,\n        uiContext(),\n      );\n      await store.putUiState(userId, next);\n      onUiState(next);\n      return next;\n    },\n\n    async restore() {\n      const [snapshot, savedUi] = await Promise.all([\n        store.getSnapshot(userId),\n        store.getUiState(userId),\n      ]);\n      if (snapshot) onSnapshot(snapshot);\n      await refreshMergedEntries();\n      const uiState = normalizeUiState(savedUi || {}, uiContext());\n      onUiState(uiState);\n      return Boolean(snapshot);\n    },\n  };\n}\n`);

let worker = await readFile('service-worker.js', 'utf8');
worker = worker.replace("  './src/app-data-source.js',\n", "  './src/app-data-source.js',\n  './src/app-session-state.js',\n");
await writeFile('service-worker.js', worker);

let ci = await readFile('.github/workflows/ci.yml', 'utf8');
ci = ci.replace('          test -f _site/src/app-data-source.js\n', '          test -f _site/src/app-data-source.js\n          test -f _site/src/app-session-state.js\n');
await writeFile('.github/workflows/ci.yml', ci);
