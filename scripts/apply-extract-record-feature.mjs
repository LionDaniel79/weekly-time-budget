import { readFile, writeFile, rm } from 'node:fs/promises';

async function update(path, transform) {
  const before = await readFile(path, 'utf8');
  const after = transform(before);
  if (after === before) throw new Error(`No changes applied to ${path}`);
  await writeFile(path, after);
}

await update('src/app.js', (source) => {
  let next = source;
  next = next.replace('  renderRecord(); publishHistoryState(); publishCategoryState();', '  publishRecordState(); publishHistoryState(); publishCategoryState();');
  next = next.replace(/\nfunction renderRecord\(\) \{[\s\S]*?\nfunction publishHistoryState\(\) \{/, `
function publishRecordState() {
  document.dispatchEvent(new CustomEvent('weekly-time-budget:record-state', {
    detail: {
      categories: state.categories,
      activeRecordTab: state.activeRecordTab,
      manualInputMode: state.manualInputMode,
      manualCategoryId: state.manualCategoryId,
      timer: state.timer,
      onSaveEntry: saveEntry,
      onUiChange: ({ activeRecordTab, manualInputMode, manualCategoryId }) => {
        state.activeRecordTab = activeRecordTab;
        state.manualInputMode = manualInputMode;
        state.manualCategoryId = manualCategoryId;
        persistUiState({ record: { tab: activeRecordTab, manualMode: manualInputMode } }).catch(console.error);
      },
      onTimerChange: (timer) => { state.timer = timer; },
    },
  }));
}

function publishHistoryState() {`);
  return next;
});

await update('index.html', (source) => source.replace(
  '  <script type="module" src="./src/history-feature.js"></script>',
  '  <script type="module" src="./src/record-feature.js"></script>\n  <script type="module" src="./src/history-feature.js"></script>',
));

await update('service-worker.js', (source) => source.replace(
  "  './src/history-feature.js',",
  "  './src/record-feature.js',\n  './src/history-feature.js',",
));

await update('tests/app-view-ownership.test.js', (source) => source
  .replace('app의 전체 렌더는 기록 입력을 갱신하고 기록 내역·대분류 상태를 발행한다', 'app의 전체 렌더는 기록 입력·내역·대분류 상태를 발행한다')
  .replace(/assert\.match\(body, \/renderRecord\\\(\\\)\/\);/, 'assert.match(body, /publishRecordState\\(\\)/);')
  .replace(/renderDashboard\|renderBudget\|renderHistory\|renderCategories/, 'renderDashboard|renderBudget|renderHistory|renderCategories|renderRecord')
);

await update('tests/ui-contract.test.js', (source) => {
  let next = source.replaceAll("const appSource = await read('src/app.js');", "const appSource = await read('src/record-feature.js');");
  next = next.replaceAll("const appSource = await read('src/app.js');", "const appSource = await read('src/record-feature.js');");
  return next;
});

await update('tests/offline-app-integration.test.js', (source) => source.replace(
  "'../src/category-selection-memory.js', '../src/history-feature.js', '../src/category-feature.js', '../src/recorded-period-domain.js',",
  "'../src/category-selection-memory.js', '../src/record-feature.js', '../src/history-feature.js', '../src/category-feature.js', '../src/recorded-period-domain.js',",
));

await rm('docs/.record-feature-placeholder', { force: true });
await rm('docs/record-feature-plan.md', { force: true });
