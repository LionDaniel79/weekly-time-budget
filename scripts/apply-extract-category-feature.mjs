import { readFile, writeFile } from 'node:fs/promises';

async function update(path, transform) {
  const before = await readFile(path, 'utf8');
  const after = transform(before);
  if (after === before) throw new Error(`No changes applied to ${path}`);
  await writeFile(path, after);
}

await update('src/app.js', (source) => {
  let next = source;
  next = next.replace(/\nconst defaultBudgetMinutes = \(category\) =>[^\n]+;/, '');
  next = next.replace('renderRecord(); publishHistoryState(); renderCategories();', 'renderRecord(); publishHistoryState(); publishCategoryState();');
  next = next.replace(/\nfunction renderCategories\(\) \{[\s\S]*?\n\}\n\nfunction formatClock/, `
function publishCategoryState() {
  document.dispatchEvent(new CustomEvent('weekly-time-budget:category-state', {
    detail: {
      categories: state.categories,
      onSave: saveCategory,
      onDelete: deleteCategory,
    },
  }));
}

function formatClock`);
  return next;
});

await update('index.html', (source) => source.replace(
  '  <script type="module" src="./src/history-feature.js"></script>',
  '  <script type="module" src="./src/history-feature.js"></script>\n  <script type="module" src="./src/category-feature.js"></script>',
));

await update('service-worker.js', (source) => source.replace(
  "  './src/history-feature.js',",
  "  './src/history-feature.js',\n  './src/category-feature.js',",
));

await update('.github/workflows/ci.yml', (source) => source.replace(
  '          test -f _site/src/history-feature.js',
  '          test -f _site/src/history-feature.js\n          test -f _site/src/category-feature.js',
));

await update('tests/offline-app-integration.test.js', (source) => source.replace(
  "'../src/category-selection-memory.js', '../src/history-feature.js', '../src/recorded-period-domain.js',",
  "'../src/category-selection-memory.js', '../src/history-feature.js', '../src/category-feature.js', '../src/recorded-period-domain.js',",
));

await update('tests/app-view-ownership.test.js', (source) => {
  let next = source;
  next = next.replace(
    "test('app의 전체 렌더는 기록·대분류를 갱신하고 기록 내역 상태를 발행한다'",
    "test('app의 전체 렌더는 기록을 갱신하고 기록 내역·대분류 상태를 발행한다'",
  );
  next = next.replace('  assert.match(body, /renderCategories\\(\\)/);', '  assert.match(body, /publishCategoryState\\(\\)/);');
  next = next.replace('/renderDashboard|renderBudget|renderHistory/', '/renderDashboard|renderBudget|renderHistory|renderCategories/');
  return next;
});
