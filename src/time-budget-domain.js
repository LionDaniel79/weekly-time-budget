import {
  buildRecordedPeriodIndex,
  nextRecordedPeriodOrCurrent,
  previousRecordedPeriod,
} from './recorded-period-domain.js';
import { buildCountdownBaseline } from './countdown-timer-domain.js';
import {
  calculateGoalAchievement,
  calculateGoalComplianceScore,
  calculateGoalContribution,
  calculateGoalProgress,
  categoryDisplayName,
  normalizeGoalType,
} from './goal-domain.js';
import { isCategoryActiveOnDate } from './category-effective-date.js';

const hasOwn = (object, key) => Object.prototype.hasOwnProperty.call(object || {}, key);
const pad = (value) => String(value).padStart(2, '0');

function shiftedDateKey(dateKey, days) {
  const date = new Date(`${dateKey}T12:00:00`);
  date.setDate(date.getDate() + days);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function isUsableEntry(entry) {
  return Number(entry?.durationMinutes) > 0
    && entry?.deleted !== true
    && entry?.isDeleted !== true
    && entry?.syncStatus !== 'deleted';
}

function categoryMinutesInRange(entries, categoryId, start, end) {
  return (entries || [])
    .filter((entry) => entry?.categoryId === categoryId
      && entry.date >= start
      && entry.date <= end
      && isUsableEntry(entry))
    .reduce((sum, entry) => sum + Math.max(0, Number(entry.durationMinutes) || 0), 0);
}

export function removeUnknownCategoryReferences(values = {}, knownCategoryIds = new Set()) {
  const known = knownCategoryIds instanceof Set ? knownCategoryIds : new Set(knownCategoryIds || []);
  return Object.fromEntries(
    Object.entries(values || {}).filter(([categoryId]) => known.has(categoryId)),
  );
}

export function parseOptionalHours(value) {
  if (value === '' || value === null || value === undefined) {
    return { explicit: false, minutes: null };
  }
  const hours = Number(value);
  if (!Number.isFinite(hours) || hours < 0) throw new Error('예산은 0 이상이어야 합니다.');
  if (!Number.isInteger(hours * 2)) throw new Error('이번 주 예산은 0.5시간 단위로 입력하세요.');
  return { explicit: true, minutes: Math.round(hours * 60) };
}

export function parseOptionalDailyHours(value) {
  if (value === '' || value === null || value === undefined) {
    return { explicit: false, minutes: null };
  }
  const hours = Number(value);
  if (!Number.isFinite(hours) || hours < 0) throw new Error('예산은 0 이상이어야 합니다.');
  return { explicit: true, minutes: Math.round(hours * 60) };
}

export function previousSameWeekdayMinutes(entries, categoryId, date) {
  const previousDate = shiftedDateKey(date, -7);
  return categoryMinutesInRange(entries, categoryId, previousDate, previousDate);
}

export function roundUpToHalfHourMinutes(minutes) {
  const value = Math.max(0, Number(minutes) || 0);
  return value ? Math.ceil(value / 30) * 30 : 0;
}

export function roundedPreviousWeekBudgetMinutes(entries, categoryId, weekStart) {
  const previousStart = shiftedDateKey(weekStart, -7);
  const previousEnd = shiftedDateKey(weekStart, -1);
  return roundUpToHalfHourMinutes(categoryMinutesInRange(entries, categoryId, previousStart, previousEnd));
}

export function buildPreviousWeekBudgetDefaults({ categories = [], entries = [], weekStart }) {
  return Object.fromEntries(categories.map((category) => [
    category.id,
    roundedPreviousWeekBudgetMinutes(entries, category.id, weekStart),
  ]));
}

export function explicitBudgetIdSet(weekDocument = {}) {
  if (Array.isArray(weekDocument.explicitBudgetIds)) return new Set(weekDocument.explicitBudgetIds);
  return new Set(Object.keys(weekDocument.budgets || {}));
}

export function resolveWeeklyBudgetMinutes(category, weekDocument) {
  const value = weekDocument?.budgets?.[category.id];
  if (value !== undefined) return Math.max(0, Math.round(Number(value) || 0));
  return 0;
}

export function buildWeeklyBudgetSnapshot({
  weekStart,
  categories,
  budgetInputs = {},
  defaultBudgets = {},
}) {
  const budgets = {};
  const explicitBudgetIds = [];
  for (const category of categories) {
    const parsed = parseOptionalHours(budgetInputs[category.id]);
    if (parsed.explicit) {
      budgets[category.id] = parsed.minutes;
      explicitBudgetIds.push(category.id);
    } else {
      budgets[category.id] = Math.max(0, Math.round(Number(defaultBudgets[category.id]) || 0));
    }
  }
  return { weekStart, budgets, explicitBudgetIds };
}

function weekdayIndex(dateKey) {
  const date = new Date(`${dateKey}T12:00:00`);
  return (date.getDay() + 6) % 7;
}

export function equalDailyBudgetMinutes(totalMinutes, dateKey) {
  const total = Math.max(0, Math.round(Number(totalMinutes) || 0));
  const base = Math.floor(total / 7);
  const remainder = total % 7;
  return base + (weekdayIndex(dateKey) < remainder ? 1 : 0);
}

export function resolveDailyBudget({ category, date, weekDocument, dailyDocument }) {
  if (!isCategoryActiveOnDate(category, date)) return { minutes: 0, source: 'inactive' };
  const overrides = dailyDocument?.overrides || {};
  if (hasOwn(overrides, category.id)) {
    return {
      minutes: Math.max(0, Math.round(Number(overrides[category.id]) || 0)),
      source: 'direct',
    };
  }
  const weeklyMinutes = resolveWeeklyBudgetMinutes(category, weekDocument);
  return { minutes: equalDailyBudgetMinutes(weeklyMinutes, date), source: 'equal' };
}

export function resolveCountdownBudgetBaseline({
  category,
  date,
  entries = [],
  weekDocument,
  dailyDocument,
}) {
  if (!isCategoryActiveOnDate(category, date)) return null;
  const budget = resolveDailyBudget({ category, date, weekDocument, dailyDocument });
  const recordedMinutes = entries
    .filter((entry) => entry.date === date && entry.categoryId === category.id)
    .reduce((sum, entry) => sum + Math.max(0, Number(entry.durationMinutes) || 0), 0);
  return {
    ...buildCountdownBaseline({ budgetMinutes: budget.minutes, recordedMinutes }),
    budgetSource: budget.source,
  };
}

export function recordedDateKeys(entries, today) {
  return buildRecordedPeriodIndex(entries, today).dates;
}

export const previousRecordedDate = previousRecordedPeriod;
export const nextRecordedDateOrToday = nextRecordedPeriodOrCurrent;

export function calendarMonthCells(year, month, recordedDates, today) {
  const active = new Set(recordedDates);
  const first = new Date(year, month - 1, 1, 12);
  const last = new Date(year, month, 0, 12);
  const mondayOffset = (first.getDay() + 6) % 7;
  const cells = [];
  for (let index = 0; index < 42; index += 1) {
    const day = index - mondayOffset + 1;
    if (day < 1 || day > last.getDate()) {
      cells.push({ date: null, day: null, active: false, disabled: true });
      continue;
    }
    const date = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    const isActive = date <= today && (active.has(date) || date === today);
    cells.push({ date, day, active: isActive, disabled: !isActive });
  }
  return cells;
}

export function summarizeDailyCategories({ categories, entries, date, weekDocument, dailyDocument }) {
  const activeCategories = categories.filter((category) => isCategoryActiveOnDate(category, date));
  const categoryById = new Map(activeCategories.map((category) => [category.id, category]));
  const relevant = entries.filter((entry) => (
    entry.date === date
    && categoryById.has(entry.categoryId)
    && isCategoryActiveOnDate(categoryById.get(entry.categoryId), entry.date)
  ));
  const categorySummaries = activeCategories.map((category) => {
    const budget = resolveDailyBudget({ category, date, weekDocument, dailyDocument });
    const actualMinutes = relevant
      .filter((entry) => entry.categoryId === category.id)
      .reduce((sum, entry) => sum + Math.max(0, Number(entry.durationMinutes) || 0), 0);
    const goalType = normalizeGoalType(category.goalType);
    const achievement = calculateGoalAchievement({
      goalType,
      budgetMinutes: budget.minutes,
      actualMinutes,
    });
    return {
      id: category.id,
      name: categoryDisplayName(category),
      goalType,
      budgetMinutes: budget.minutes,
      actualMinutes,
      budgetSource: budget.source,
      ...achievement,
      contributionScore: calculateGoalContribution(achievement),
      progress: calculateGoalProgress({ goalType, budgetMinutes: budget.minutes, actualMinutes }),
    };
  });
  const totalBudgetMinutes = categorySummaries.reduce((sum, item) => sum + item.budgetMinutes, 0);
  const totalActualMinutes = categorySummaries.reduce((sum, item) => sum + item.actualMinutes, 0);
  const compliance = calculateGoalComplianceScore(categorySummaries);
  return {
    totalBudgetMinutes,
    totalActualMinutes,
    goalComplianceScore: compliance.score,
    goalComplianceStatus: compliance.status,
    percentage: compliance.score,
    differenceMinutes: totalActualMinutes - totalBudgetMinutes,
    status: compliance.status === 'excluded' ? 'excluded' : totalActualMinutes > totalBudgetMinutes ? 'exceeded' : totalActualMinutes === totalBudgetMinutes ? 'exact' : 'remaining',
    categorySummaries,
  };
}
