import { readFile, writeFile, rm } from 'node:fs/promises';

async function replace(path, search, replacement) {
  const source = await readFile(path, 'utf8');
  if (!source.includes(search)) throw new Error(`${path}: expected text not found`);
  await writeFile(path, source.replace(search, replacement));
}

await replace(
  'src/time-budget-feature.js',
  "import { getWeekRange, moveWeekStart, summarizeCategories, summarizeWeeklyBudgetPeriod, toDateKey } from './domain.js';",
  "import { getWeekRange, summarizeCategories, summarizeWeeklyBudgetPeriod, toDateKey } from './domain.js';",
);

await replace(
  'src/time-budget-feature.js',
  "import { filterCategoriesActiveOnDate, isCategoryActiveInRange } from './category-effective-date.js';",
  "import { filterCategoriesActiveOnDate, isCategoryActiveInRange } from './category-effective-date.js';\nimport {\n  buildRecordedPeriodIndex,\n  previousRecordedPeriod,\n  nextRecordedPeriodOrCurrent,\n  coerceRecordedPeriodSelection,\n} from './recorded-period-domain.js';",
);

await replace(
  'src/time-budget-feature.js',
  "function weeklySummary(key) {\n  const range = weekRange(key);\n  const week = normalizeWeek(key);\n  const categories = periodCategories({ start: range.start, end: range.end, weekDocument: week });\n  return summarizeWeeklyBudgetPeriod(state.entries, categories, state.weekly, key);\n}\n\nfunction renderDashboard() {",
  "function weeklySummary(key) {\n  const range = weekRange(key);\n  const week = normalizeWeek(key);\n  const categories = periodCategories({ start: range.start, end: range.end, weekDocument: week });\n  return summarizeWeeklyBudgetPeriod(state.entries, categories, state.weekly, key);\n}\n\nfunction dashboardRecordedWeekModel() {\n  const current = state.dashboard.currentWeekStart;\n  const periods = buildRecordedPeriodIndex(state.entries, state.dashboard.today);\n  const selected = coerceRecordedPeriodSelection({\n    selected: state.dashboard.selectedWeekStart,\n    current,\n    recordedPeriods: periods.weekStarts,\n  });\n  return {\n    selected,\n    previousWeekStart: previousRecordedPeriod(periods.weekStarts, selected),\n    nextWeekStart: nextRecordedPeriodOrCurrent(periods.weekStarts, selected, current),\n  };\n}\n\nfunction renderDashboard() {",
);

await replace(
  'src/time-budget-feature.js',
  "  if (state.dashboard.mode === 'weekly') {\n    root.innerHTML = `<div data-feature-ui=\"dashboard\">${renderDashboardHtml({\n      mode: 'weekly',\n      selectedWeekStart: state.dashboard.selectedWeekStart,\n      currentWeekStart: state.dashboard.currentWeekStart,\n      weekRangeLabel: weekLabel(state.dashboard.selectedWeekStart),\n      weeklySummary: weeklySummary(state.dashboard.selectedWeekStart),\n    })}</div>`;",
  "  if (state.dashboard.mode === 'weekly') {\n    const recordedWeek = dashboardRecordedWeekModel();\n    if (recordedWeek.selected !== state.dashboard.selectedWeekStart) {\n      state.dashboard.selectedWeekStart = recordedWeek.selected;\n      saveFeatureUiState({ dashboard: { ...state.dashboard } });\n    }\n    root.innerHTML = `<div data-feature-ui=\"dashboard\">${renderDashboardHtml({\n      mode: 'weekly',\n      selectedWeekStart: recordedWeek.selected,\n      currentWeekStart: state.dashboard.currentWeekStart,\n      previousWeekStart: recordedWeek.previousWeekStart,\n      nextWeekStart: recordedWeek.nextWeekStart,\n      weekRangeLabel: weekLabel(recordedWeek.selected),\n      weeklySummary: weeklySummary(recordedWeek.selected),\n    })}</div>`;",
);

await replace(
  'src/time-budget-feature.js',
  "    onWeekMove: (direction) => {\n      const next = moveWeekStart(state.dashboard.selectedWeekStart, direction === 'prev' ? -1 : 1);\n      if (next > state.dashboard.currentWeekStart) return;\n      state.dashboard.selectedWeekStart = next;\n      saveFeatureUiState({ dashboard: { ...state.dashboard } });\n      renderDashboard(); updateHeader('dashboard');\n    },",
  "    onWeekMove: (direction) => {\n      const recordedWeek = dashboardRecordedWeekModel();\n      const next = direction === 'prev'\n        ? recordedWeek.previousWeekStart\n        : recordedWeek.nextWeekStart;\n      if (!next) return;\n      state.dashboard.selectedWeekStart = next;\n      saveFeatureUiState({ dashboard: { ...state.dashboard } });\n      renderDashboard(); updateHeader('dashboard');\n    },",
);

await replace(
  'src/time-budget-ui.js',
  "  if (mode === 'weekly') {\n    const isCurrent = model.selectedWeekStart >= model.currentWeekStart;\n    return `${renderDashboardTabs(mode)}<div class=\"period-navigation\"><button type=\"button\" class=\"secondary-button\" data-week-direction=\"prev\">전주</button><strong>${escapeHtml(model.weekRangeLabel || model.selectedWeekStart)}</strong><button type=\"button\" class=\"secondary-button\" data-week-direction=\"next\" ${isCurrent ? 'disabled' : ''}>다음 주</button></div>${renderSummaryCards(model.weeklySummary, '주간 예산')}${renderCategorySummary(model.weeklySummary)}`;\n  }",
  "  if (mode === 'weekly') {\n    const previousDisabled = !model.previousWeekStart;\n    const nextDisabled = !model.nextWeekStart;\n    return `${renderDashboardTabs(mode)}<div class=\"period-navigation\"><button type=\"button\" class=\"secondary-button\" data-week-direction=\"prev\" ${previousDisabled ? 'disabled aria-disabled=\"true\"' : 'aria-disabled=\"false\"'}>전주</button><strong>${escapeHtml(model.weekRangeLabel || model.selectedWeekStart)}</strong><button type=\"button\" class=\"secondary-button\" data-week-direction=\"next\" ${nextDisabled ? 'disabled aria-disabled=\"true\"' : 'aria-disabled=\"false\"'}>다음 주</button></div>${renderSummaryCards(model.weeklySummary, '주간 예산')}${renderCategorySummary(model.weeklySummary)}`;\n  }",
);

for (const path of ['index.html', 'service-worker.js', '.github/workflows/ci.yml']) {
  const source = await readFile(path, 'utf8');
  await writeFile(path, source.replace(/^.*recorded-period-navigation\.js.*\n/gm, ''));
}

await writeFile('tests/recorded-period-navigation-integration.test.js', `import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const read = (path) => readFile(new URL(\`../\${path}\`, import.meta.url), 'utf8');

test('대시보드 기록 기간은 시간 예산 기능의 local-first 기록으로 계산한다', async () => {
  const source = await read('src/time-budget-feature.js');
  for (const token of [
    'buildRecordedPeriodIndex',
    'previousRecordedPeriod',
    'nextRecordedPeriodOrCurrent',
    'coerceRecordedPeriodSelection',
    'state.runtime.mergedEntries',
  ]) assert.ok(source.includes(token), token);
});

test('대시보드 주간 이동은 기록 기간 목적지를 직접 사용한다', async () => {
  const source = await read('src/time-budget-feature.js');
  assert.match(source, /onWeekMove:[\\s\\S]*previousWeekStart[\\s\\S]*nextWeekStart/);
  assert.doesNotMatch(source, /moveWeekStart/);
});

test('기록 기간 후처리 스크립트는 앱과 서비스 워커에서 제거된다', async () => {
  const [html, worker] = await Promise.all([read('index.html'), read('service-worker.js')]);
  assert.doesNotMatch(html, /recorded-period-navigation/);
  assert.doesNotMatch(worker, /recorded-period-navigation/);
});

test('대시보드 기록 기간 관련 모듈은 올바른 자바스크립트 문법이다', () => {
  for (const relative of [
    '../src/recorded-period-domain.js',
    '../src/time-budget-feature.js',
    '../src/time-budget-ui.js',
  ]) {
    const result = spawnSync(process.execPath, ['--check', fileURLToPath(new URL(relative, import.meta.url))], { encoding: 'utf8' });
    assert.equal(result.status, 0, \`\${relative}: \${result.stderr || result.stdout}\`);
  }
});
`);

await rm('src/recorded-period-navigation.js');
await rm('scripts/apply-dashboard-single-owner.mjs');
await rm('.github/workflows/apply-dashboard-single-owner.yml');
