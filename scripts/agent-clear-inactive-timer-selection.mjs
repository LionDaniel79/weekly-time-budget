import { readFile, writeFile } from 'node:fs/promises';

const path = 'src/persistent-timer-ui.js';
let source = await readFile(path, 'utf8');

const previous = `  const timer = state.controller.active;
  const selectedId = timer?.categoryId
    || state.selectedCategoryId
    || localStorage.getItem(LAST_CATEGORY_KEY)
    || '';
  if (!timer && selectedId !== state.selectedCategoryId) {
    state.selectedCategoryId = selectedId;
    updatePreviewBaseline();
  }`;

const next = `  const timer = state.controller.active;
  let selectedId = timer?.categoryId
    || state.selectedCategoryId
    || localStorage.getItem(LAST_CATEGORY_KEY)
    || '';
  const currentDate = localDateKey(new Date());
  const selectedCategory = state.categories.find((item) => item.id === selectedId);
  if (!timer && selectedId && (!selectedCategory || !isCategoryActiveOnDate(selectedCategory, currentDate))) {
    selectedId = '';
    state.selectedCategoryId = '';
    state.previewBaseline = null;
    localStorage.removeItem(LAST_CATEGORY_KEY);
  }
  if (!timer && selectedId !== state.selectedCategoryId) {
    state.selectedCategoryId = selectedId;
    updatePreviewBaseline();
  }`;

if (!source.includes(previous)) throw new Error('renderTimer selection block not found');
source = source.replace(previous, next);
await writeFile(path, source);
console.log('inactive timer selection cleanup applied');
