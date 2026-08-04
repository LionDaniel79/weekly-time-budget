import { readFile, writeFile } from 'node:fs/promises';

async function update(path, transform) {
  const before = await readFile(path, 'utf8');
  const after = transform(before);
  if (after === before) throw new Error(`No changes applied to ${path}`);
  await writeFile(path, after);
}

await update('src/app.js', (source) => {
  let next = source;
  next = next.replace(/\nfunction renderHistory\(\) \{[\s\S]*?\n\}\n\nfunction renderCategories\(\)/, `
function publishHistoryState() {
  document.dispatchEvent(new CustomEvent('weekly-time-budget:history-state', {
    detail: {
      categories: state.categories,
      entries: state.entries,
      onDelete: deleteEntry,
      onRetry: retryEntry,
    },
  }));
}

function renderCategories()`);
  next = next.replaceAll('renderHistory();', 'publishHistoryState();');
  next = next.replace(/\n\s*manualEntryTimeLabel,/, '');
  next = next.replace(/,\n\s*isEntryWithinCategoryEffectiveDate/, '');
  return next;
});

await update('index.html', (source) => source.replace(
  '  <script type="module" src="./src/app.js"></script>',
  '  <script type="module" src="./src/history-feature.js"></script>\n  <script type="module" src="./src/app.js"></script>',
));

await update('service-worker.js', (source) => source.replace(
  "  './src/time-budget-feature.js',",
  "  './src/time-budget-feature.js',\n  './src/history-feature.js',",
));

await update('tests/offline-app-integration.test.js', (source) => source.replace(
  "'../src/category-selection-memory.js', '../src/recorded-period-domain.js',",
  "'../src/category-selection-memory.js', '../src/history-feature.js', '../src/recorded-period-domain.js',",
));
