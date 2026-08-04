import { readFile, writeFile, unlink } from 'node:fs/promises';

const path = 'src/app.js';
let source = await readFile(path, 'utf8');

function replaceOnce(pattern, replacement, label) {
  const next = source.replace(pattern, replacement);
  if (next === source) throw new Error(`Missing app.js section: ${label}`);
  source = next;
}

replaceOnce(
  /\nasync function saveWeeklyBudget\([\s\S]*?\nasync function deleteCategory/,
  '\nasync function deleteCategory',
  'legacy weekly budget save',
);

replaceOnce(
  /\nfunction legacyGoalProgressHtml[\s\S]*?\nfunction renderRecord/,
  '\nfunction renderRecord',
  'legacy dashboard renderer',
);

replaceOnce(
  /\nfunction renderBudget\([\s\S]*?\nfunction renderHistory/,
  '\nfunction renderHistory',
  'legacy budget renderer',
);

replaceOnce(
  /function renderAll\(\) \{[\s\S]*?\n\}/,
  `function renderAll() {
  const range = getWeekRange();
  $('#week-label').textContent = \`${'${range.start}'} — ${'${range.end}'} · 월~주일\`;
  renderRecord(); renderHistory(); renderCategories();
}`,
  'renderAll ownership',
);

source = source.replaceAll('renderDashboard(); renderHistory();', 'renderHistory();');
source = source.replaceAll('renderDashboard(); renderHistory();', 'renderHistory();');

if (/function renderDashboard\(|function renderBudget\(|legacyGoalProgressHtml|legacyGoalDetail|function saveWeeklyBudget\(/.test(source)) {
  throw new Error('Legacy dashboard or budget ownership remains in app.js');
}

await writeFile(path, source);
await unlink('docs/app-view-single-owner-plan.md').catch(() => {});
await unlink('scripts/apply-app-view-single-owner.mjs').catch(() => {});
