import { readFile, writeFile } from 'node:fs/promises';

async function edit(path, transform) {
  const source = await readFile(path, 'utf8');
  const next = transform(source);
  if (next === source) throw new Error(`${path}: no changes applied`);
  await writeFile(path, next);
}

function replaceOnce(source, search, replacement, label) {
  const index = source.indexOf(search);
  if (index < 0) throw new Error(`missing ${label}`);
  if (source.indexOf(search, index + search.length) >= 0) throw new Error(`duplicate ${label}`);
  return `${source.slice(0, index)}${replacement}${source.slice(index + search.length)}`;
}

function replaceRegex(source, pattern, replacement, label) {
  if (!pattern.test(source)) throw new Error(`missing ${label}`);
  pattern.lastIndex = 0;
  return source.replace(pattern, replacement);
}

await edit('src/app.js', (input) => {
  let source = input;
  source = replaceOnce(
    source,
    "  summarizeCategories,\n  toDateKey,",
    "  summarizeCategories,\n  summarizeWeeklyBudgetPeriod,\n  toDateKey,",
    'app weekly summary import',
  );
  source = replaceOnce(
    source,
    "} from './goal-domain.js';\n",
    "} from './goal-domain.js';\nimport {\n  filterCategoriesActiveOnDate,\n  isCategoryActiveOnDate,\n  isEntryWithinCategoryEffectiveDate,\n} from './category-effective-date.js';\n",
    'app effective date import',
  );
  source = replaceRegex(
    source,
    /const optionHtml = \(selectedId = ''\) => state\.categories\n  \.map\(\(category\) => `<option value="\$\{category\.id\}" \$\{category\.id === selectedId \? 'selected' : ''\}>\$\{escapeHtml\(categoryDisplayName\(category\)\)\}<\/option>`\)\n  \.join\(''\);/,
    `const categoryOptionHtml = ({ date, selectedId = '' }) => filterCategoriesActiveOnDate(state.categories, date)\n  .map((category) => \`<option value="\${category.id}" \${category.id === selectedId ? 'selected' : ''}>\${escapeHtml(categoryDisplayName(category))}</option>\`)\n  .join('');\nconst optionHtml = (selectedId = '') => categoryOptionHtml({ date: toDateKey(new Date()), selectedId });`,
    'app category options',
  );
  source = replaceOnce(
    source,
    "  if (id) await firebase.setDoc(firebase.doc(collectionRef, id), basePayload, { merge: true });\n  else await firebase.addDoc(collectionRef, { ...basePayload, goalType: normalizeGoalType(goalType) });",
    `  if (id) {\n    await firebase.setDoc(firebase.doc(collectionRef, id), basePayload, { merge: true });\n  } else {\n    await firebase.addDoc(collectionRef, {\n      ...basePayload,\n      goalType: normalizeGoalType(goalType),\n      createdDate: toDateKey(new Date()),\n    });\n  }`,
    'app saveCategory create branch',
  );
  source = replaceRegex(
    source,
    /function renderDashboard\(\) \{[\s\S]*?\n\}\n\nfunction renderRecord/,
    `function renderDashboard() {\n  const range = getWeekRange();\n  const summary = summarizeWeeklyBudgetPeriod(\n    state.entries,\n    state.categories,\n    state.weeklyBudget ? [state.weeklyBudget] : [],\n    range.start,\n  );\n  const scoreText = summary.goalComplianceStatus === 'excluded' ? '계산 제외' : \`\${summary.goalComplianceScore}점\`;\n  const rows = summary.categorySummaries;\n  $('#dashboard-view').innerHTML = \`<div class="grid grid-3">\n    <article class="card"><p class="muted">목표 준수</p><div class="metric">\${scoreText}</div></article>\n    <article class="card"><p class="muted">이번 주 예산</p><div class="metric">\${formatMinutes(summary.totalBudgetMinutes)}</div><p class="muted">월요일부터 주일까지</p></article>\n    <article class="card"><p class="muted">실제 기록</p><div class="metric">\${formatMinutes(summary.totalActualMinutes)}</div><p class="muted">월요일부터 주일까지 모두 포함</p></article>\n  </div><div class="card" style="margin-top:18px"><div class="section-title"><h2>대분류별 달성률</h2><span class="badge">\${rows.length}개 분야</span></div>\n  \${rows.length ? rows.map((item) => \`<div class="budget-row"><div><strong>\${escapeHtml(item.name)}</strong>\${legacyGoalProgressHtml(item)}</div><div>\${formatMinutes(item.actualMinutes)} / \${formatMinutes(item.budgetMinutes)}</div><strong>\${item.hasBudget ? \`\${item.percentage}%\` : '—'}</strong><span class="muted">\${legacyGoalDetail(item)}</span></div>\`).join('') : $('#empty-template').innerHTML}</div>\`;\n}\n\nfunction renderRecord`,
    'app dashboard function',
  );
  source = replaceOnce(
    source,
    "      const categoryId = $('#timer-category').value;\n      if (!categoryId) return alert('대분류를 선택하세요.');\n      state.timer = { categoryId, note: $('#timer-note').value.trim(), startedAt: Date.now() };",
    `      const categoryId = $('#timer-category').value;\n      if (!categoryId) return alert('대분류를 선택하세요.');\n      const startedDate = toDateKey(new Date());\n      const category = state.categories.find((item) => item.id === categoryId);\n      if (!category || !isCategoryActiveOnDate(category, startedDate)) {\n        return alert('이 대분류는 추가일부터 타이머를 시작할 수 있습니다.');\n      }\n      state.timer = { categoryId, note: $('#timer-note').value.trim(), startedAt: Date.now() };`,
    'legacy timer start guard',
  );
  source = replaceOnce(
    source,
    '${optionHtml(state.manualCategoryId)}</select></label><label>날짜',
    '${categoryOptionHtml({ date: toDateKey(now), selectedId: state.manualCategoryId })}</select></label><label>날짜',
    'manual category options',
  );
  source = replaceOnce(
    source,
    'function bindManual() {\n',
    `function refreshManualCategoryOptions() {\n  const select = $('#manual-category');\n  const date = $('#manual-date')?.value;\n  if (!select || !date) return;\n  const selectedId = select.value;\n  select.innerHTML = \`<option value="">선택하세요</option>\${categoryOptionHtml({ date, selectedId })}\`;\n  if (![...select.options].some((option) => option.value === selectedId)) {\n    select.value = '';\n    state.manualCategoryId = '';\n  }\n}\n\nfunction bindManual() {\n  $('#manual-date')?.addEventListener('change', refreshManualCategoryOptions);\n`,
    'manual refresh function',
  );
  source = replaceOnce(
    source,
    "    if (!categoryId) return alert('대분류를 선택하세요.');\n    if (!date) return alert('날짜를 선택하세요.');\n    state.manualCategoryId = categoryId;",
    `    if (!categoryId) return alert('대분류를 선택하세요.');\n    if (!date) return alert('날짜를 선택하세요.');\n    const category = state.categories.find((item) => item.id === categoryId);\n    if (!category || !isCategoryActiveOnDate(category, date)) {\n      alert('이 대분류는 추가일 이전 날짜에 기록할 수 없습니다.');\n      refreshManualCategoryOptions();\n      return;\n    }\n    state.manualCategoryId = categoryId;`,
    'manual save guard',
  );
  source = replaceRegex(
    source,
    /function renderBudget\(\) \{[\s\S]*?\n\}\n\nfunction renderHistory/,
    `function renderBudget() {\n  const categories = filterCategoriesActiveOnDate(state.categories, toDateKey(new Date()));\n  $('#budget-view').innerHTML = \`<div class="card"><div class="section-title"><div><h2>이번 주 시간 예산</h2><p class="muted">이번 주에만 적용됩니다. 다음 주에는 대분류의 기본 예산이 다시 표시됩니다.</p></div></div>\${categories.length ? \`<form id="budget-bulk-form"><div class="category-list">\${categories.map((category) => \`<div class="category-item budget-edit-row" data-id="\${category.id}"><div><strong>\${escapeHtml(categoryDisplayName(category))}</strong><div class="muted">기본 \${formatMinutes(defaultBudgetMinutes(category))}</div></div><input type="number" name="hours" min="0" step="0.5" value="\${effectiveBudgetMinutes(category) / 60}" aria-label="\${escapeHtml(categoryDisplayName(category))} 이번 주 예산 시간"></div>\`).join('')}</div><div class="bulk-save-actions"><button class="primary-button" type="submit">이번 주 예산 저장</button></div></form>\` : $('#empty-template').innerHTML}</div>\`;\n  if ($('#budget-bulk-form')) $('#budget-bulk-form').onsubmit = async (event) => { event.preventDefault(); const budgets = {}; document.querySelectorAll('.budget-edit-row').forEach((row) => { budgets[row.dataset.id] = Number(row.querySelector('[name="hours"]').value) * 60; }); await saveWeeklyBudget(budgets); alert('이번 주 예산을 저장했습니다.'); };\n}\n\nfunction renderHistory`,
    'legacy budget function',
  );
  source = replaceRegex(
    source,
    /function renderHistory\(\) \{[\s\S]*?\n\}\n\nfunction renderCategories/,
    `function renderHistory() {\n  const categoryById = new Map(state.categories.map((category) => [category.id, category]));\n  const entries = state.entries.filter((entry) => isEntryWithinCategoryEffectiveDate(entry, categoryById.get(entry.categoryId)));\n  $('#history-view').innerHTML = \`<div class="card"><div class="section-title"><h2>최근 기록</h2><span class="badge">\${entries.length}건</span></div>\${entries.length ? entries.map((entry) => { const category = state.categories.find((item) => item.id === entry.categoryId); const timeDescription = manualEntryTimeLabel(entry, formatMinutes); const pending = entry.syncStatus === 'pending'; const failed = entry.syncStatus === 'failed'; return \`<div class="entry"><strong>\${entry.date}</strong><div><strong>\${escapeHtml(category ? categoryDisplayName(category) : '삭제된 대분류')}</strong><div>\${escapeHtml(timeDescription)}</div>\${entry.note ? \`<p class="muted">\${escapeHtml(entry.note)}</p>\` : ''}\${pending ? '<span class="sync-status pending">동기화 대기</span>' : ''}\${failed ? \`<span class="sync-status failed">동기화 실패</span><button class="sync-retry" data-id="\${entry.id}" type="button">다시 시도</button>\` : ''}</div><div class="entry-actions"><button class="text-button delete-entry" data-id="\${entry.id}">삭제</button></div></div>\`; }).join('') : '<div class="empty-state"><h3>아직 기록이 없습니다.</h3><p>타이머 또는 수동 입력으로 첫 시간을 기록하세요.</p></div>'}</div>\`;\n  document.querySelectorAll('.delete-entry').forEach((button) => { button.onclick = () => deleteEntry(button.dataset.id); });\n  document.querySelectorAll('.sync-retry').forEach((button) => { button.onclick = () => retryEntry(button.dataset.id).catch((error) => showToast({ type: 'error', title: '동기화하지 못했습니다.', message: error.message })); });\n}\n\nfunction renderCategories`,
    'legacy history function',
  );
  return source;
});

await edit('src/category-ui-patch.js', (input) => {
  let source = input;
  source = replaceOnce(
    source,
    "import { categoryDisplayName, normalizeGoalType } from './goal-domain.js';\n",
    "import { categoryDisplayName, normalizeGoalType } from './goal-domain.js';\nimport { isEntryWithinCategoryEffectiveDate } from './category-effective-date.js';\n",
    'lifecycle effective date import',
  );
  source = replaceOnce(
    source,
    "      goalType: normalizeGoalType(data.goalType),\n    });",
    "      goalType: normalizeGoalType(data.goalType),\n      ...(data.createdDate !== undefined ? { createdDate: data.createdDate } : {}),\n    });",
    'restore createdDate',
  );
  source = replaceOnce(
    source,
    "    const entries = entriesSnapshot.docs.map((docSnapshot) => ({ id: docSnapshot.id, ...docSnapshot.data() }));",
    `    const categoryById = new Map([...archivedCategories, ...activeCategories]);\n    const entries = entriesSnapshot.docs\n      .map((docSnapshot) => ({ id: docSnapshot.id, ...docSnapshot.data() }))\n      .filter((entry) => isEntryWithinCategoryEffectiveDate(entry, categoryById.get(entry.categoryId)));`,
    'history entry effective date filter',
  );
  return source;
});

await edit('src/time-budget-domain.js', (input) => {
  let source = input;
  source = replaceOnce(
    source,
    "} from './goal-domain.js';\n",
    "} from './goal-domain.js';\nimport { isCategoryActiveOnDate } from './category-effective-date.js';\n",
    'daily effective date import',
  );
  source = replaceOnce(
    source,
    "}) {\n  const overrides = dailyDocument?.overrides || {};",
    "}) {\n  if (!isCategoryActiveOnDate(category, date)) return { minutes: 0, source: 'inactive' };\n  const overrides = dailyDocument?.overrides || {};",
    'inactive daily budget guard',
  );
  source = replaceOnce(
    source,
    "}) {\n  const budget = resolveDailyBudget({",
    "}) {\n  if (!isCategoryActiveOnDate(category, date)) return null;\n  const budget = resolveDailyBudget({",
    'inactive countdown guard',
  );
  source = replaceRegex(
    source,
    /export function summarizeDailyCategories\(\{[\s\S]*?\n\}\s*$/,
    `export function summarizeDailyCategories({\n  categories,\n  entries,\n  date,\n  weekDocument,\n  dailyDocument,\n  defaultDayWeights = EQUAL_DAY_WEIGHTS,\n}) {\n  const activeCategories = categories.filter((category) => isCategoryActiveOnDate(category, date));\n  const categoryById = new Map(activeCategories.map((category) => [category.id, category]));\n  const relevant = entries.filter((entry) => (\n    entry.date === date\n    && categoryById.has(entry.categoryId)\n    && isCategoryActiveOnDate(categoryById.get(entry.categoryId), entry.date)\n  ));\n  const categorySummaries = activeCategories.map((category) => {\n    const budget = resolveDailyBudget({\n      category,\n      date,\n      weekDocument,\n      dailyDocument,\n      defaultDayWeights,\n    });\n    const actualMinutes = relevant\n      .filter((entry) => entry.categoryId === category.id)\n      .reduce((sum, entry) => sum + Math.max(0, Number(entry.durationMinutes) || 0), 0);\n    const goalType = normalizeGoalType(category.goalType);\n    const achievement = calculateGoalAchievement({\n      goalType,\n      budgetMinutes: budget.minutes,\n      actualMinutes,\n    });\n    return {\n      id: category.id,\n      name: categoryDisplayName(category),\n      goalType,\n      budgetMinutes: budget.minutes,\n      actualMinutes,\n      budgetSource: budget.source,\n      ...achievement,\n      contributionScore: calculateGoalContribution(achievement),\n      progress: calculateGoalProgress({\n        goalType,\n        budgetMinutes: budget.minutes,\n        actualMinutes,\n      }),\n    };\n  });\n  const totalBudgetMinutes = categorySummaries.reduce((sum, item) => sum + item.budgetMinutes, 0);\n  const totalActualMinutes = categorySummaries.reduce((sum, item) => sum + item.actualMinutes, 0);\n  const compliance = calculateGoalComplianceScore(categorySummaries);\n  return {\n    totalBudgetMinutes,\n    totalActualMinutes,\n    goalComplianceScore: compliance.score,\n    goalComplianceStatus: compliance.status,\n    percentage: compliance.score,\n    differenceMinutes: totalActualMinutes - totalBudgetMinutes,\n    status: compliance.status === 'excluded' ? 'excluded' : totalActualMinutes > totalBudgetMinutes ? 'exceeded' : totalActualMinutes === totalBudgetMinutes ? 'exact' : 'remaining',\n    categorySummaries,\n  };\n}\n`,
    'daily summary function',
  );
  return source;
});

await edit('src/domain.js', (input) => {
  let source = input;
  source = replaceOnce(
    source,
    "} from './goal-domain.js';\n",
    "} from './goal-domain.js';\nimport {\n  isCategoryActiveInRange,\n  isCategoryActiveOnDate,\n  isEntryWithinCategoryEffectiveDate,\n} from './category-effective-date.js';\n",
    'period effective date import',
  );
  source = replaceOnce(
    source,
    "function effectiveWeeklyBudget(category, week, dateKey) {\n  const archivedDate",
    "function effectiveWeeklyBudget(category, week, dateKey) {\n  if (!isCategoryActiveOnDate(category, dateKey)) return 0;\n  const archivedDate",
    'period inactive budget guard',
  );
  source = replaceOnce(
    source,
    "function sortedCategories(categories) {\n  return [...(categories || [])]\n    .sort((a, b) => (Number(a.order) || 999999) - (Number(b.order) || 999999)\n      || String(a.name).localeCompare(String(b.name), 'ko'));\n}\n",
    `function sortedCategories(categories) {\n  return [...(categories || [])]\n    .sort((a, b) => (Number(a.order) || 999999) - (Number(b.order) || 999999)\n      || String(a.name).localeCompare(String(b.name), 'ko'));\n}\n\nfunction effectiveEntries(entries, categories) {\n  const categoryById = new Map(sortedCategories(categories).map((category) => [category.id, category]));\n  return (entries || []).filter((entry) => isEntryWithinCategoryEffectiveDate(entry, categoryById.get(entry.categoryId)));\n}\n`,
    'period effective entries helper',
  );
  source = replaceOnce(
    source,
    "  const filteredEntries = (entries || []).filter((entry) => (\n    isDateKey(entry.date) && entry.date >= start && entry.date <= end\n  ));",
    `  const filteredEntries = (entries || []).filter((entry) => {\n    if (!isDateKey(entry.date) || entry.date < start || entry.date > end) return false;\n    return isEntryWithinCategoryEffectiveDate(entry, categoryById.get(entry.categoryId));\n  });`,
    'period entry filter',
  );
  source = replaceOnce(
    source,
    "function summarizeBudgetRange(entries, categories, weeklyBudgets, start, end, includedWeekKeys = null) {\n  const categoryList = sortedCategories(categories);\n  const categoryById = new Map(categoryList.map((category) => [category.id, category]));\n  const weeks = weeklyBudgetMap(weeklyBudgets);\n  const budgetById = new Map(categoryList.map((category) => [category.id, 0]));",
    `function summarizeBudgetRange(entries, categories, weeklyBudgets, start, end, includedWeekKeys = null) {\n  const allCategoryList = sortedCategories(categories);\n  const categoryById = new Map(allCategoryList.map((category) => [category.id, category]));\n  const categoryList = allCategoryList\n    .filter((category) => isCategoryActiveInRange(category, start, end));\n  const weeks = weeklyBudgetMap(weeklyBudgets);\n  const budgetById = new Map(categoryList.map((category) => [category.id, 0]));`,
    'period category range filter',
  );
  source = replaceOnce(
    source,
    "export function summarizeRecordedMonthlyBudgetPeriod(entries, categories, weeklyBudgets, year, month) {\n  const range = getMonthRange(year, month);\n  const weekKeys = recordedWeekKeysForMonth(entries, year, month);\n  const summary = summarizeBudgetRange(\n    entries,",
    `export function summarizeRecordedMonthlyBudgetPeriod(entries, categories, weeklyBudgets, year, month) {\n  const range = getMonthRange(year, month);\n  const validEntries = effectiveEntries(entries, categories);\n  const weekKeys = recordedWeekKeysForMonth(validEntries, year, month);\n  const summary = summarizeBudgetRange(\n    validEntries,`,
    'recorded month valid entries',
  );
  source = replaceRegex(
    source,
    /function combineBudgetSummaries\(summaries, categories, recordDates\) \{[\s\S]*?\n\}\n\nexport function summarizeRecordedYearlyBudgetPeriod/,
    `function combineBudgetSummaries(summaries, categories, recordDates) {\n  const categoryById = new Map(sortedCategories(categories).map((category) => [category.id, category]));\n  const totals = new Map();\n  summaries.forEach((summary) => {\n    summary.categorySummaries.forEach((item) => {\n      const source = categoryById.get(item.id) || item;\n      const current = totals.get(item.id) || {\n        id: item.id,\n        name: source.name || item.name,\n        goalType: normalizeGoalType(source.goalType ?? item.goalType),\n        budgetMinutes: 0,\n        actualMinutes: 0,\n      };\n      current.budgetMinutes += Number(item.budgetMinutes) || 0;\n      current.actualMinutes += Number(item.actualMinutes) || 0;\n      totals.set(item.id, current);\n    });\n  });\n\n  const categorySummaries = [...totals.values()].map((item) => ({\n    id: item.id,\n    budgetMinutes: item.budgetMinutes,\n    actualMinutes: item.actualMinutes,\n    ...categoryGoalSummary(item, item.budgetMinutes, item.actualMinutes),\n  }));\n  const totalBudgetMinutes = categorySummaries.reduce((sum, item) => sum + item.budgetMinutes, 0);\n  const totalActualMinutes = categorySummaries.reduce((sum, item) => sum + item.actualMinutes, 0);\n  const compliance = calculateGoalComplianceScore(categorySummaries);\n  const difference = totalDifferenceStatus(totalBudgetMinutes, totalActualMinutes);\n  const recordDays = recordDates.size;\n  return {\n    totalBudgetMinutes,\n    totalActualMinutes,\n    goalComplianceScore: compliance.score,\n    goalComplianceStatus: compliance.status,\n    percentage: compliance.score,\n    differenceMinutes: difference.differenceMinutes,\n    status: difference.status,\n    recordDays,\n    dailyAverageMinutes: recordDays ? Math.round(totalActualMinutes / recordDays) : 0,\n    categorySummaries,\n  };\n}\n\nexport function summarizeRecordedYearlyBudgetPeriod`,
    'year summary combine',
  );
  source = replaceOnce(
    source,
    "export function summarizeRecordedYearlyBudgetPeriod(entries, categories, weeklyBudgets, year) {\n  const months = recordedMonthsForYear(entries, year);\n  const summaries = months.map((month) => summarizeRecordedMonthlyBudgetPeriod(\n    entries,",
    `export function summarizeRecordedYearlyBudgetPeriod(entries, categories, weeklyBudgets, year) {\n  const validEntries = effectiveEntries(entries, categories);\n  const months = recordedMonthsForYear(validEntries, year);\n  const summaries = months.map((month) => summarizeRecordedMonthlyBudgetPeriod(\n    validEntries,`,
    'year valid entries start',
  );
  source = replaceOnce(
    source,
    "  const recordDates = new Set((entries || [])\n    .filter((entry) => isDateKey(entry.date) && entry.date.startsWith(prefix))",
    "  const recordDates = new Set(validEntries\n    .filter((entry) => isDateKey(entry.date) && entry.date.startsWith(prefix))",
    'year valid record dates',
  );
  source = replaceOnce(
    source,
    "export function detailedRecordedMonthlyBudgetComparison(entries, categories, weeklyBudgets, year) {\n  const rows = recordedMonthsForYear(entries, year).map((month) => ({",
    `export function detailedRecordedMonthlyBudgetComparison(entries, categories, weeklyBudgets, year) {\n  const validEntries = effectiveEntries(entries, categories);\n  const rows = recordedMonthsForYear(validEntries, year).map((month) => ({`,
    'monthly comparison valid periods',
  );
  source = source.replace(
    /\.\.\.summarizeRecordedMonthlyBudgetPeriod\(entries, categories, weeklyBudgets, year, month\),/,
    '...summarizeRecordedMonthlyBudgetPeriod(validEntries, categories, weeklyBudgets, year, month),',
  );
  source = replaceOnce(
    source,
    "export function detailedRecordedYearlyBudgetComparison(entries, categories, weeklyBudgets) {\n  const rows = recordedYears(entries).map((year) => ({",
    `export function detailedRecordedYearlyBudgetComparison(entries, categories, weeklyBudgets) {\n  const validEntries = effectiveEntries(entries, categories);\n  const rows = recordedYears(validEntries).map((year) => ({`,
    'yearly comparison valid periods',
  );
  source = source.replace(
    /\.\.\.summarizeRecordedYearlyBudgetPeriod\(entries, categories, weeklyBudgets, year\),/,
    '...summarizeRecordedYearlyBudgetPeriod(validEntries, categories, weeklyBudgets, year),',
  );
  return source;
});

await edit('src/time-budget-feature.js', (input) => {
  let source = input;
  source = replaceOnce(
    source,
    "import { getWeekRange, moveWeekStart, summarizeCategories, toDateKey } from './domain.js';",
    "import { getWeekRange, moveWeekStart, summarizeCategories, summarizeWeeklyBudgetPeriod, toDateKey } from './domain.js';",
    'feature weekly summary import',
  );
  source = replaceOnce(
    source,
    "import { showOfflineNotice, showToast } from './app-toast.js';\n",
    "import { showOfflineNotice, showToast } from './app-toast.js';\nimport { filterCategoriesActiveOnDate, isCategoryActiveInRange } from './category-effective-date.js';\n",
    'feature effective date import',
  );
  source = replaceOnce(
    source,
    'const activeCategories = () => state.categories;',
    'const activeCategories = (date = today()) => filterCategoriesActiveOnDate(state.categories, date);',
    'feature active categories helper',
  );
  source = replaceOnce(
    source,
    "  return allKnownCategories()\n    .filter((category) => activeIds.has(category.id) || budgetIds.has(category.id) || overrideIds.has(category.id) || entryIds.has(category.id))",
    "  return allKnownCategories()\n    .filter((category) => isCategoryActiveInRange(category, start, end))\n    .filter((category) => activeIds.has(category.id) || budgetIds.has(category.id) || overrideIds.has(category.id) || entryIds.has(category.id))",
    'feature period category range filter',
  );
  source = replaceOnce(
    source,
    '  for (const category of state.categories) {\n    if (budgets[category.id] !== undefined) continue;',
    '  for (const category of activeCategories(today())) {\n    if (budgets[category.id] !== undefined) continue;',
    'feature snapshot active categories',
  );
  source = replaceRegex(
    source,
    /function weeklySummary\(key\) \{[\s\S]*?\n\}\n\nfunction renderDashboard/,
    `function weeklySummary(key) {\n  const range = weekRange(key);\n  const week = normalizeWeek(key);\n  const categories = periodCategories({ start: range.start, end: range.end, weekDocument: week });\n  return summarizeWeeklyBudgetPeriod(state.entries, categories, state.weekly, key);\n}\n\nfunction renderDashboard`,
    'feature weekly summary function',
  );
  source = replaceOnce(
    source,
    '    categories: activeCategories(),',
    '    categories: activeCategories(state.budget.today),',
    'feature budget active date',
  );
  source = replaceOnce(
    source,
    "async function saveDaily(inputs) {\n  const date = today();\n  const activeIds = new Set(state.categories.map((category) => category.id));",
    "async function saveDaily(inputs) {\n  const date = today();\n  const currentCategories = activeCategories(date);\n  const activeIds = new Set(currentCategories.map((category) => category.id));",
    'save daily active categories',
  );
  source = replaceOnce(
    source,
    '  for (const category of state.categories) {\n    const parsed = parseOptionalHours(inputs[category.id]);',
    '  for (const category of currentCategories) {\n    const parsed = parseOptionalHours(inputs[category.id]);',
    'save daily loop',
  );
  source = replaceOnce(
    source,
    "async function saveWeekly({ budgetInputs, dayWeightInputs }) {\n  const weekStart = currentWeekStart();\n  const existing = normalizeWeek(weekStart);\n  const activeIds = new Set(state.categories.map((category) => category.id));",
    "async function saveWeekly({ budgetInputs, dayWeightInputs }) {\n  const weekStart = currentWeekStart();\n  const existing = normalizeWeek(weekStart);\n  const currentCategories = activeCategories(today());\n  const activeIds = new Set(currentCategories.map((category) => category.id));",
    'save weekly active categories',
  );
  source = replaceOnce(
    source,
    '  const snapshot = buildWeeklyBudgetSnapshot({ weekStart, categories: state.categories, budgetInputs, dayWeightInputs });',
    '  const snapshot = buildWeeklyBudgetSnapshot({ weekStart, categories: currentCategories, budgetInputs, dayWeightInputs });',
    'save weekly snapshot categories',
  );
  return source;
});

await edit('src/persistent-timer-ui.js', (input) => {
  let source = input;
  source = replaceOnce(
    source,
    "import { categoryDisplayName, normalizeGoalType } from './goal-domain.js';\n",
    "import { categoryDisplayName, normalizeGoalType } from './goal-domain.js';\nimport { filterCategoriesActiveOnDate, isCategoryActiveOnDate } from './category-effective-date.js';\n",
    'timer effective date import',
  );
  source = replaceRegex(
    source,
    /function categoryOptions\(selectedId\) \{[\s\S]*?\n\}/,
    `function categoryOptions(selectedId) {\n  const all = new Map([...state.archived, ...state.categories].map((item) => [item.id, item]));\n  const date = localDateKey(new Date());\n  const activeCategories = filterCategoriesActiveOnDate(state.categories, date);\n  const options = activeCategories.map((category) => \`<option value="\${category.id}" \${category.id === selectedId ? 'selected' : ''}>\${escapeHtml(categoryDisplayName(category))}</option>\`);\n  if (selectedId && !activeCategories.some((category) => category.id === selectedId)) {\n    const selected = all.get(selectedId);\n    options.unshift(\`<option value="\${selectedId}" selected>\${escapeHtml(selected ? categoryDisplayName(selected) : '보관된 대분류')}</option>\`);\n  }\n  return options.join('');\n}`,
    'timer category options',
  );
  source = replaceOnce(
    source,
    "      const startedDate = localDateKey(new Date());\n      const baseline = state.selectedMode === 'countdown'",
    `      const startedDate = localDateKey(new Date());\n      const category = knownCategory(categoryId);\n      if (!category || !isCategoryActiveOnDate(category, startedDate)) {\n        showToast({\n          type: 'error',\n          title: '이 대분류는 아직 사용할 수 없습니다.',\n          message: '대분류 추가일부터 타이머를 시작할 수 있습니다.',\n        });\n        return;\n      }\n      const baseline = state.selectedMode === 'countdown'`,
    'timer start effective guard',
  );
  return source;
});

await edit('src/statistics-ui.js', (input) => {
  let source = input;
  source = replaceOnce(
    source,
    "          const category = byId.get(id) || { budgetMinutes: 0, actualMinutes: 0, percentage: 0, hasBudget: false };\n          const categoryName = escapeHtml(categoryById.get(id) ? categoryDisplayName(categoryById.get(id)) : '삭제된 대분류');\n          return `<td data-label=\"${categoryName}\"><div class=\"matrix-cell\"><strong>${formatMinutes(category.actualMinutes)} / ${formatMinutes(category.budgetMinutes)}</strong><small>${achievementText(category)}</small></div></td>`;",
    "          const categoryName = escapeHtml(categoryById.get(id) ? categoryDisplayName(categoryById.get(id)) : '삭제된 대분류');\n          const category = byId.get(id);\n          if (!category) {\n            return `<td data-label=\"${categoryName}\"><span class=\"muted\">—</span></td>`;\n          }\n          return `<td data-label=\"${categoryName}\"><div class=\"matrix-cell\"><strong>${formatMinutes(category.actualMinutes)} / ${formatMinutes(category.budgetMinutes)}</strong><small>${achievementText(category)}</small></div></td>`;",
    'statistics missing matrix cell',
  );
  return source;
});

await edit('service-worker.js', (input) => {
  let source = input.replace("weekly-time-budget-shell-v9", "weekly-time-budget-shell-v10");
  source = replaceOnce(
    source,
    "  './src/goal-domain.js',",
    "  './src/category-effective-date.js',\n  './src/goal-domain.js',",
    'service worker effective module',
  );
  return source;
});

await edit('.github/workflows/ci.yml', (input) => replaceOnce(
  input,
  '          test -f _site/src/goal-domain.js',
  '          test -f _site/src/category-effective-date.js\n          test -f _site/src/goal-domain.js',
  'CI effective module check',
));

await edit('tests/recorded-period-navigation-integration.test.js', (input) => {
  let source = input.replaceAll('weekly-time-budget-shell-v9', 'weekly-time-budget-shell-v10');
  if (!source.includes("assert.ok(serviceWorker.includes('./src/category-effective-date.js'));")) {
    source = replaceOnce(
      source,
      "  assert.ok(serviceWorker.includes('./src/recorded-period-domain.js'));",
      "  assert.ok(serviceWorker.includes('./src/category-effective-date.js'));\n  assert.ok(serviceWorker.includes('./src/recorded-period-domain.js'));",
      'navigation effective module assertion',
    );
  }
  return source;
});

console.log('category effective date implementation applied');
