import {
  calculateGoalAchievement,
  calculateGoalComplianceScore,
  calculateGoalContribution,
  calculateGoalProgress,
  categoryDisplayName,
  normalizeGoalType,
} from './goal-domain.js';

const pad = (value) => String(value).padStart(2, '0');

export function toDateKey(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function fromDateKey(value) {
  const [year, month, day] = String(value || '').slice(0, 10).split('-').map(Number);
  const date = new Date(year, month - 1, day);
  date.setHours(12, 0, 0, 0);
  return date;
}

function addDays(value, amount) {
  const date = typeof value === 'string' ? fromDateKey(value) : new Date(value);
  date.setDate(date.getDate() + amount);
  return date;
}

function dateKeys(start, end) {
  const values = [];
  for (let current = fromDateKey(start); toDateKey(current) <= end; current = addDays(current, 1)) {
    values.push(toDateKey(current));
  }
  return values;
}

function isDateKey(value) {
  const text = String(value || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return false;
  return toDateKey(fromDateKey(text)) === text;
}

function normalizedTimestampDate(value) {
  if (!value) return null;
  if (typeof value === 'string') return value.slice(0, 10);
  if (value instanceof Date) return toDateKey(value);
  if (typeof value.toDate === 'function') return toDateKey(value.toDate());
  if (Number.isFinite(value.seconds)) return toDateKey(new Date(value.seconds * 1000));
  return null;
}

export function isManagedDay() {
  return true;
}

export function getWeekRange(date = new Date()) {
  const current = new Date(date);
  const day = current.getDay();
  const offset = day === 0 ? -6 : 1 - day;
  const monday = new Date(current);
  monday.setDate(current.getDate() + offset);
  monday.setHours(0, 0, 0, 0);
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  return { start: toDateKey(monday), end: toDateKey(sunday) };
}

export function getBudgetWeekKey(date = new Date()) {
  return getWeekRange(date).start;
}

export function getMonthRange(year, month) {
  const first = new Date(Number(year), Number(month) - 1, 1);
  const last = new Date(Number(year), Number(month), 0);
  return { start: toDateKey(first), end: toDateKey(last) };
}

export function getYearRange(year) {
  return { start: `${year}-01-01`, end: `${year}-12-31` };
}

export function recordedWeekKeysForMonth(entries, year, month) {
  const { start, end } = getMonthRange(year, month);
  const keys = new Set();
  (entries || []).forEach((entry) => {
    if (!isDateKey(entry.date) || entry.date < start || entry.date > end) return;
    keys.add(getBudgetWeekKey(fromDateKey(entry.date)));
  });
  return [...keys].sort();
}

export function recordedMonthsForYear(entries, year) {
  const prefix = `${Number(year)}-`;
  const months = new Set();
  (entries || []).forEach((entry) => {
    if (!isDateKey(entry.date) || !entry.date.startsWith(prefix)) return;
    months.add(Number(entry.date.slice(5, 7)));
  });
  return [...months].sort((a, b) => a - b);
}

export function moveWeekStart(weekStart, offsetWeeks, referenceDate = new Date()) {
  const currentWeekStart = getWeekRange(referenceDate).start;
  const normalizedStart = isDateKey(weekStart)
    ? getWeekRange(fromDateKey(weekStart)).start
    : currentWeekStart;
  const candidate = toDateKey(addDays(normalizedStart, Number(offsetWeeks) * 7));
  return candidate > currentWeekStart ? currentWeekStart : candidate;
}

export function reorderItems(items, itemId, direction) {
  const reordered = [...items];
  const currentIndex = reordered.findIndex((item) => item.id === itemId);
  const targetIndex = currentIndex + Number(direction);
  if (currentIndex < 0 || targetIndex < 0 || targetIndex >= reordered.length) return reordered;
  [reordered[currentIndex], reordered[targetIndex]] = [reordered[targetIndex], reordered[currentIndex]];
  return reordered;
}

export function calculateAchievement(budgetMinutes, actualMinutes) {
  const percentage = budgetMinutes > 0 ? Math.round((actualMinutes / budgetMinutes) * 100) : 0;
  const differenceMinutes = actualMinutes - budgetMinutes;
  return {
    percentage,
    differenceMinutes,
    status: differenceMinutes >= 0 ? 'exceeded' : 'remaining',
  };
}

function categoryGoalSummary(category, budgetMinutes, actualMinutes) {
  const goalType = normalizeGoalType(category?.goalType);
  const achievement = calculateGoalAchievement({ goalType, budgetMinutes, actualMinutes });
  return {
    goalType,
    name: categoryDisplayName(category),
    ...achievement,
    contributionScore: calculateGoalContribution(achievement),
    progress: calculateGoalProgress({ goalType, budgetMinutes, actualMinutes }),
  };
}

function totalDifferenceStatus(totalBudgetMinutes, totalActualMinutes) {
  const differenceMinutes = totalActualMinutes - totalBudgetMinutes;
  if (totalBudgetMinutes <= 0) {
    return {
      differenceMinutes,
      status: totalActualMinutes > 0 ? 'unbudgeted' : 'remaining',
    };
  }
  return {
    differenceMinutes,
    status: differenceMinutes > 0 ? 'exceeded' : differenceMinutes === 0 ? 'exact' : 'remaining',
  };
}

export function minutesBetween(startTime, endTime) {
  const [startHour, startMinute] = startTime.split(':').map(Number);
  const [endHour, endMinute] = endTime.split(':').map(Number);
  const start = startHour * 60 + startMinute;
  let end = endHour * 60 + endMinute;
  if (end < start) end += 24 * 60;
  return end - start;
}

export function summarizeCategories(categories, entries, start, end) {
  return categories.map((category) => {
    const actualMinutes = entries
      .filter((entry) => entry.categoryId === category.id && entry.date >= start && entry.date <= end)
      .reduce((sum, entry) => sum + Number(entry.durationMinutes || 0), 0);
    const budgetMinutes = category.budgetMinutes || 0;
    return {
      id: category.id,
      budgetMinutes,
      actualMinutes,
      ...categoryGoalSummary(category, budgetMinutes, actualMinutes),
    };
  });
}

export function summarizePeriod(entries, categoryNames, start, end) {
  const filtered = entries.filter((entry) => entry.date >= start && entry.date <= end);
  const categoryTotals = {};
  const days = new Set();
  let totalMinutes = 0;
  filtered.forEach((entry) => {
    const minutes = Number(entry.durationMinutes || 0);
    totalMinutes += minutes;
    if (entry.date) days.add(entry.date);
    const name = categoryNames instanceof Map
      ? (categoryNames.get(entry.categoryId) || '삭제된 대분류')
      : (categoryNames?.[entry.categoryId] || '삭제된 대분류');
    categoryTotals[name] = (categoryTotals[name] || 0) + minutes;
  });
  const recordDays = days.size;
  return {
    totalMinutes,
    recordDays,
    dailyAverageMinutes: recordDays ? Math.round(totalMinutes / recordDays) : 0,
    categoryTotals,
  };
}

export function categoryBreakdown(summary) {
  const total = Number(summary?.totalMinutes) || 0;
  return Object.entries(summary?.categoryTotals || {})
    .map(([name, minutes]) => ({
      name,
      minutes: Number(minutes) || 0,
      percentage: total ? Math.round((Number(minutes) || 0) / total * 100) : 0,
    }))
    .sort((a, b) => b.minutes - a.minutes || a.name.localeCompare(b.name, 'ko'));
}

function defaultBudgetMinutes(category) {
  return Number(category?.defaultBudgetMinutes ?? category?.budgetMinutes ?? 0) || 0;
}

function weeklyBudgetMap(weeklyBudgets) {
  return new Map((weeklyBudgets || []).map((week) => [week.weekStart || week.id, week]));
}

function effectiveWeeklyBudget(category, week, dateKey) {
  const archivedDate = normalizedTimestampDate(category.archivedAt);
  if (archivedDate && dateKey > archivedDate) return 0;
  const override = week?.budgets?.[category.id];
  return override === undefined ? defaultBudgetMinutes(category) : Number(override) || 0;
}

function sortedCategories(categories) {
  return [...(categories || [])]
    .sort((a, b) => (Number(a.order) || 999999) - (Number(b.order) || 999999)
      || String(a.name).localeCompare(String(b.name), 'ko'));
}

function finalizeBudgetSummary(entries, categoryList, categoryById, budgetById, start, end) {
  const filteredEntries = (entries || []).filter((entry) => (
    isDateKey(entry.date) && entry.date >= start && entry.date <= end
  ));
  const actualById = new Map();
  const entryGoalTypeById = new Map();
  const days = new Set();
  filteredEntries.forEach((entry) => {
    const minutes = Number(entry.durationMinutes || 0);
    actualById.set(entry.categoryId, (actualById.get(entry.categoryId) || 0) + minutes);
    if (!entryGoalTypeById.has(entry.categoryId) && entry.goalType !== undefined) {
      entryGoalTypeById.set(entry.categoryId, normalizeGoalType(entry.goalType));
    }
    days.add(entry.date);
  });

  const categorySummaries = categoryList.map((category) => {
    const budgetMinutes = Math.round(budgetById.get(category.id) || 0);
    const actualMinutes = Math.round(actualById.get(category.id) || 0);
    return {
      id: category.id,
      budgetMinutes,
      actualMinutes,
      ...categoryGoalSummary(category, budgetMinutes, actualMinutes),
    };
  });

  actualById.forEach((actualMinutes, categoryId) => {
    if (categoryById.has(categoryId)) return;
    const category = {
      name: '삭제된 대분류',
      goalType: entryGoalTypeById.get(categoryId),
    };
    const roundedActual = Math.round(actualMinutes);
    categorySummaries.push({
      id: categoryId,
      budgetMinutes: 0,
      actualMinutes: roundedActual,
      ...categoryGoalSummary(category, 0, roundedActual),
    });
  });

  const totalBudgetMinutes = categorySummaries.reduce((sum, item) => sum + item.budgetMinutes, 0);
  const totalActualMinutes = categorySummaries.reduce((sum, item) => sum + item.actualMinutes, 0);
  const compliance = calculateGoalComplianceScore(categorySummaries);
  const difference = totalDifferenceStatus(totalBudgetMinutes, totalActualMinutes);
  const recordDays = days.size;
  return {
    totalBudgetMinutes,
    totalActualMinutes,
    goalComplianceScore: compliance.score,
    goalComplianceStatus: compliance.status,
    percentage: compliance.score,
    differenceMinutes: difference.differenceMinutes,
    status: difference.status,
    recordDays,
    dailyAverageMinutes: recordDays ? Math.round(totalActualMinutes / recordDays) : 0,
    categorySummaries,
  };
}

function summarizeBudgetRange(entries, categories, weeklyBudgets, start, end, includedWeekKeys = null) {
  const categoryList = sortedCategories(categories);
  const categoryById = new Map(categoryList.map((category) => [category.id, category]));
  const weeks = weeklyBudgetMap(weeklyBudgets);
  const budgetById = new Map(categoryList.map((category) => [category.id, 0]));

  dateKeys(start, end).forEach((dateKey) => {
    const weekKey = getBudgetWeekKey(fromDateKey(dateKey));
    if (includedWeekKeys && !includedWeekKeys.has(weekKey)) return;
    const week = weeks.get(weekKey);
    categoryList.forEach((category) => {
      const weeklyMinutes = effectiveWeeklyBudget(category, week, dateKey);
      budgetById.set(category.id, (budgetById.get(category.id) || 0) + weeklyMinutes / 7);
    });
  });

  return finalizeBudgetSummary(entries, categoryList, categoryById, budgetById, start, end);
}

export function summarizeBudgetPeriod(entries, categories, weeklyBudgets, start, end) {
  return summarizeBudgetRange(entries, categories, weeklyBudgets, start, end);
}

export function summarizeWeeklyBudgetPeriod(entries, categories, weeklyBudgets, weekStart) {
  const normalizedStart = isDateKey(weekStart)
    ? getWeekRange(fromDateKey(weekStart)).start
    : getWeekRange().start;
  const end = toDateKey(addDays(normalizedStart, 6));
  return summarizeBudgetRange(entries, categories, weeklyBudgets, normalizedStart, end);
}

export function summarizeRecordedMonthlyBudgetPeriod(entries, categories, weeklyBudgets, year, month) {
  const range = getMonthRange(year, month);
  const weekKeys = recordedWeekKeysForMonth(entries, year, month);
  const summary = summarizeBudgetRange(
    entries,
    categories,
    weeklyBudgets,
    range.start,
    range.end,
    new Set(weekKeys),
  );
  return { ...summary, recordWeekCount: weekKeys.length };
}

function combineBudgetSummaries(summaries, categories, recordDates) {
  const categoryList = sortedCategories(categories);
  const totals = new Map(categoryList.map((category) => [category.id, {
    id: category.id,
    name: category.name,
    goalType: normalizeGoalType(category.goalType),
    budgetMinutes: 0,
    actualMinutes: 0,
  }]));

  summaries.forEach((summary) => {
    summary.categorySummaries.forEach((item) => {
      const current = totals.get(item.id) || {
        id: item.id,
        name: item.name,
        goalType: normalizeGoalType(item.goalType),
        budgetMinutes: 0,
        actualMinutes: 0,
      };
      current.budgetMinutes += Number(item.budgetMinutes) || 0;
      current.actualMinutes += Number(item.actualMinutes) || 0;
      totals.set(item.id, current);
    });
  });

  const categorySummaries = [...totals.values()].map((item) => ({
    id: item.id,
    budgetMinutes: item.budgetMinutes,
    actualMinutes: item.actualMinutes,
    ...categoryGoalSummary(item, item.budgetMinutes, item.actualMinutes),
  }));
  const totalBudgetMinutes = categorySummaries.reduce((sum, item) => sum + item.budgetMinutes, 0);
  const totalActualMinutes = categorySummaries.reduce((sum, item) => sum + item.actualMinutes, 0);
  const compliance = calculateGoalComplianceScore(categorySummaries);
  const difference = totalDifferenceStatus(totalBudgetMinutes, totalActualMinutes);
  const recordDays = recordDates.size;
  return {
    totalBudgetMinutes,
    totalActualMinutes,
    goalComplianceScore: compliance.score,
    goalComplianceStatus: compliance.status,
    percentage: compliance.score,
    differenceMinutes: difference.differenceMinutes,
    status: difference.status,
    recordDays,
    dailyAverageMinutes: recordDays ? Math.round(totalActualMinutes / recordDays) : 0,
    categorySummaries,
  };
}

export function summarizeRecordedYearlyBudgetPeriod(entries, categories, weeklyBudgets, year) {
  const months = recordedMonthsForYear(entries, year);
  const summaries = months.map((month) => summarizeRecordedMonthlyBudgetPeriod(
    entries,
    categories,
    weeklyBudgets,
    year,
    month,
  ));
  const prefix = `${Number(year)}-`;
  const recordDates = new Set((entries || [])
    .filter((entry) => isDateKey(entry.date) && entry.date.startsWith(prefix))
    .map((entry) => entry.date));
  return {
    ...combineBudgetSummaries(summaries, categories, recordDates),
    recordMonthCount: months.length,
  };
}

export function calculateRecordedMonthAverage(totalMinutes, recordMonthCount) {
  const divisor = Number(recordMonthCount) || 0;
  return divisor ? Math.round((Number(totalMinutes) || 0) / divisor) : 0;
}

export function calculatePeriodChange(currentMinutes, previousMinutes) {
  const current = Number(currentMinutes) || 0;
  const previous = Number(previousMinutes) || 0;
  const minutes = current - previous;
  if (!previous) {
    return { minutes, percentage: current ? null : 0 };
  }
  return { minutes, percentage: Math.round(minutes / previous * 100) };
}

export function detailedMonthlyBudgetComparison(entries, categories, weeklyBudgets, year) {
  const rows = Array.from({ length: 12 }, (_, index) => {
    const month = index + 1;
    const range = getMonthRange(year, month);
    return { month, ...summarizeBudgetPeriod(entries, categories, weeklyBudgets, range.start, range.end) };
  });
  return rows.map((row, index) => {
    const change = index
      ? calculatePeriodChange(row.totalActualMinutes, rows[index - 1].totalActualMinutes)
      : { minutes: null, percentage: null };
    return { ...row, changeMinutes: change.minutes, changePercentage: change.percentage };
  });
}

export function detailedRecordedMonthlyBudgetComparison(entries, categories, weeklyBudgets, year) {
  const rows = recordedMonthsForYear(entries, year).map((month) => ({
    month,
    ...summarizeRecordedMonthlyBudgetPeriod(entries, categories, weeklyBudgets, year, month),
  }));
  return rows.map((row, index) => {
    const change = index
      ? calculatePeriodChange(row.totalActualMinutes, rows[index - 1].totalActualMinutes)
      : { minutes: null, percentage: null };
    return { ...row, changeMinutes: change.minutes, changePercentage: change.percentage };
  });
}

function yearsRepresented(entries, weeklyBudgets) {
  const years = new Set();
  (entries || []).forEach((entry) => {
    const year = Number(String(entry.date || '').slice(0, 4));
    if (Number.isFinite(year)) years.add(year);
  });
  (weeklyBudgets || []).forEach((week) => {
    const start = week.weekStart || week.id;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(start || ''))) return;
    years.add(Number(start.slice(0, 4)));
    years.add(addDays(start, 6).getFullYear());
  });
  return [...years].sort((a, b) => a - b);
}

function recordedYears(entries) {
  const years = new Set();
  (entries || []).forEach((entry) => {
    if (!isDateKey(entry.date)) return;
    years.add(Number(entry.date.slice(0, 4)));
  });
  return [...years].sort((a, b) => a - b);
}

export function detailedYearlyBudgetComparison(entries, categories, weeklyBudgets) {
  const rows = yearsRepresented(entries, weeklyBudgets).map((year) => {
    const range = getYearRange(year);
    return { year, ...summarizeBudgetPeriod(entries, categories, weeklyBudgets, range.start, range.end) };
  });
  return rows.map((row, index) => {
    const change = index
      ? calculatePeriodChange(row.totalActualMinutes, rows[index - 1].totalActualMinutes)
      : { minutes: null, percentage: null };
    return { ...row, changeMinutes: change.minutes, changePercentage: change.percentage };
  });
}

export function detailedRecordedYearlyBudgetComparison(entries, categories, weeklyBudgets) {
  const rows = recordedYears(entries).map((year) => ({
    year,
    ...summarizeRecordedYearlyBudgetPeriod(entries, categories, weeklyBudgets, year),
  }));
  return rows.map((row, index) => {
    const change = index
      ? calculatePeriodChange(row.totalActualMinutes, rows[index - 1].totalActualMinutes)
      : { minutes: null, percentage: null };
    return { ...row, changeMinutes: change.minutes, changePercentage: change.percentage };
  });
}

export function detailedMonthlyComparison(entries, categoryNames, year) {
  const rows = Array.from({ length: 12 }, (_, index) => {
    const month = index + 1;
    const range = getMonthRange(year, month);
    return { month, ...summarizePeriod(entries, categoryNames, range.start, range.end) };
  });
  return rows.map((row, index) => {
    const change = index ? calculatePeriodChange(row.totalMinutes, rows[index - 1].totalMinutes) : { minutes: null, percentage: null };
    return {
      ...row,
      changeMinutes: change.minutes,
      changePercentage: change.percentage,
    };
  });
}

export function detailedYearlyComparison(entries, categoryNames) {
  const years = [...new Set(entries
    .map((entry) => Number(String(entry.date || '').slice(0, 4)))
    .filter(Number.isFinite))]
    .sort((a, b) => a - b);
  const rows = years.map((year) => {
    const range = getYearRange(year);
    return { year, ...summarizePeriod(entries, categoryNames, range.start, range.end) };
  });
  return rows.map((row, index) => {
    const change = index ? calculatePeriodChange(row.totalMinutes, rows[index - 1].totalMinutes) : { minutes: null, percentage: null };
    return {
      ...row,
      changeMinutes: change.minutes,
      changePercentage: change.percentage,
    };
  });
}

export function calculateYearMonthlyAverage(totalMinutes, year, referenceDate = new Date()) {
  const selectedYear = Number(year);
  const currentYear = referenceDate.getFullYear();
  const divisor = selectedYear === currentYear ? referenceDate.getMonth() + 1 : 12;
  return divisor ? Math.round((Number(totalMinutes) || 0) / divisor) : 0;
}

export function monthlyComparison(entries, year) {
  return Array.from({ length: 12 }, (_, index) => {
    const month = index + 1;
    const { start, end } = getMonthRange(year, month);
    const totalMinutes = entries
      .filter((entry) => entry.date >= start && entry.date <= end)
      .reduce((sum, entry) => sum + Number(entry.durationMinutes || 0), 0);
    return { month, totalMinutes };
  });
}

export function yearlyComparison(entries) {
  const totals = new Map();
  entries.forEach((entry) => {
    const year = Number(String(entry.date || '').slice(0, 4));
    if (!Number.isFinite(year)) return;
    totals.set(year, (totals.get(year) || 0) + Number(entry.durationMinutes || 0));
  });
  return [...totals.entries()]
    .sort(([a], [b]) => a - b)
    .map(([year, totalMinutes]) => ({ year, totalMinutes }));
}

export function formatMinutes(minutes) {
  const absolute = Math.abs(Math.round(minutes));
  const hours = Math.floor(absolute / 60);
  const mins = absolute % 60;
  if (!hours) return `${mins}분`;
  if (!mins) return `${hours}시간`;
  return `${hours}시간 ${mins}분`;
}
