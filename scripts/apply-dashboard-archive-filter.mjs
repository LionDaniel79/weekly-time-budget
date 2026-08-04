import { readFile, writeFile, rm } from 'node:fs/promises';

const path = 'src/time-budget-feature.js';
let source = await readFile(path, 'utf8');
const oldImport = "import { filterCategoriesActiveOnDate, isCategoryActiveInRange } from './category-effective-date.js';";
const newImport = "import { filterCategoriesActiveOnDate, isArchivedCategoryVisibleInRange, isCategoryActiveInRange } from './category-effective-date.js';";
if (!source.includes(oldImport)) throw new Error('category effective date import not found');
source = source.replace(oldImport, newImport);
const oldFilter = "    .filter((category) => isCategoryActiveInRange(category, start, end))\n    .filter((category) => activeIds.has(category.id) || budgetIds.has(category.id) || overrideIds.has(category.id) || entryIds.has(category.id))";
const newFilter = "    .filter((category) => isCategoryActiveInRange(category, start, end))\n    .filter((category) => activeIds.has(category.id) || isArchivedCategoryVisibleInRange(category, start, end))\n    .filter((category) => activeIds.has(category.id) || budgetIds.has(category.id) || overrideIds.has(category.id) || entryIds.has(category.id))";
if (!source.includes(oldFilter)) throw new Error('period category filter not found');
source = source.replace(oldFilter, newFilter);
await writeFile(path, source);
await rm('scripts/apply-dashboard-archive-filter.mjs');
await rm('.github/workflows/apply-dashboard-archive-filter.yml');
