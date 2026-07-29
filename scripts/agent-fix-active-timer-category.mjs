import { readFile, writeFile } from 'node:fs/promises';

const path = 'src/persistent-timer-ui.js';
let source = await readFile(path, 'utf8');

const optionBlock = `  const date = localDateKey(new Date());
  const activeCategories = filterCategoriesActiveOnDate(state.categories, date);
  const options = activeCategories.map((category) => \`<option value="\${category.id}" \${category.id === selectedId ? 'selected' : ''}>\${escapeHtml(categoryDisplayName(category))}</option>\`);
  if (selectedId && !activeCategories.some((category) => category.id === selectedId)) {`;
const nextOptionBlock = `  const date = localDateKey(new Date());
  const activeCategories = filterCategoriesActiveOnDate(state.categories, date);
  const activeTimer = state.controller?.active;
  const options = activeCategories.map((category) => \`<option value="\${category.id}" \${category.id === selectedId ? 'selected' : ''}>\${escapeHtml(categoryDisplayName(category))}</option>\`);
  if (selectedId && activeTimer?.categoryId === selectedId && !activeCategories.some((category) => category.id === selectedId)) {`;
if (!source.includes(optionBlock)) throw new Error('timer option block not found');
source = source.replace(optionBlock, nextOptionBlock);

const startLookup = '      const category = knownCategory(categoryId);\n      if (!category || !isCategoryActiveOnDate(category, startedDate)) {';
const nextStartLookup = '      const category = state.categories.find((item) => item.id === categoryId);\n      if (!category || !isCategoryActiveOnDate(category, startedDate)) {';
if (!source.includes(startLookup)) throw new Error('timer start category lookup not found');
source = source.replace(startLookup, nextStartLookup);

await writeFile(path, source);
console.log('active timer category guard applied');
