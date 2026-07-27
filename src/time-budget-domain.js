import {
  buildRecordedPeriodIndex,
  nextRecordedPeriodOrCurrent,
  previousRecordedPeriod,
} from './recorded-period-domain.js';

export const DAY_KEYS = Object.freeze(['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']);

export const EQUAL_DAY_WEIGHTS = Object.freeze(
  Object.fromEntries(DAY_KEYS.map((key) => [key, 1 / DAY_KEYS.length])),
);

const hasOwn = (object, key) => Object.prototype.hasOwnProperty.call(object || {}, key);

export function removeUnknownCategoryReferences(values = {}, knownCategoryIds = new Set()) {
  const known = knownCategoryIds instanceof Set ? knownCategoryIds : new Set(knownCategoryIds || []);
  return Object.fromEntries(
    Object.entries(values || {}).filter(([categoryId]) => known.has(categoryId)),
  );
}

export function normalizeDayWeights(rawValues = {}) {
  const values = Object.fromEntries(DAY_KEYS.map((key) => {
    const raw = rawValues[key];
    const value = raw === '' || raw === null || raw === undefined ? 0 : Number(raw);
    if (!Number.isFinite(value)) throw new Error('요일 비율은 숫자로 입력하세요.');
    if (value < 0) throw new Error('요일 비율은 0 이상이어야 합니다.');
    return [key, value];
  }));
  const total = Object.values(values).reduce((sum, value) => sum + value, 0);
  if (!total) return { ...EQUAL_DAY_WEIGHTS };
  return Object.fromEntries(DAY_KEYS.map((key) => [key, values[key] / total]));
}

export function distributeWeeklyMinutes(totalMinutes, rawWeights = EQUAL_DAY_WEIGHTS) {
  const total = Math.max(0, Math.round(Number(totalMinutes) || 0));
  const weights = normalizeDayWeights(rawWeights);
  let assigned = 0;
  return Object.fromEntries(DAY_KEYS.map((key, index) => {
    const remaining = Math.max(0, total - assigned);
    const minutes = index === DAY_KEYS.length - 1
      ? remaining
      : Math.min(remaining, Math.max(0, Math.round(total * weights[key])));
    assigned += minutes;
    return [key, minutes];
  }));
}

export function parseOptionalHours(value) {
  if (value === '' || value === null || value === undefined) {
    return { explicit: false, minutes: null };
  }
  const hours = Number(value);
  if (!Number.isFinite(hours) || hours < 0) throw new Error('예산은 0 이상이어야 합니다.');
  if (!Number.isInteger(hours * 2)) throw new Error('예산은 0.5시간 단위로 입력하세요.');
  return { explicit: true, minutes: Math.round(hours * 60) };
}

export function effectiveDayWeights(weekDocument, defaultDayWeights = EQUAL_DAY_WEIGHTS) {
  return normalizeDayWeights(weekDocument?.dayWeights || defaultDayWeights);
}

export function explicitBudgetIdSet(weekDocument = {}) {
  if (Array.isArray(weekDocument.explicitBudgetIds)) return new Set(weekDocument.explicitBudgetIds);
  return new Set(Object.keys(weekDocument.budgets || {}));
}

export function resolveWeeklyBudgetMinutes(category, weekDocument) {
  const value = weekDocument?.budgets?.[category.id];
  if (value !== undefined) return Math.max(0, Math.round(Number(value) || 0));
  return Math.max(0, Math.round(Number(category.defaultBudgetMinutes ?? category.budgetMinutes ?? 0) || 0));
}

export function buildWeeklyBudgetSnapshot({
  weekStart,
  categories,
  budgetInputs = {},
  dayWeightInputs = {},
}) {
  const budgets = {};
  const explicitBudgetIds = [];
  for (const category of categories) {
    const parsed = parseOptionalHours(budgetInputs[category.id]);
    if (parsed.explicit) {
      budgets[category.id] = parsed.minutes;
      explicitBudgetIds.push(category.id);
    } else {
      budgets[category.id] = Math.max(
        0,
        Math.round(Number(category.defaultBudgetMinutes ?? category.budgetMinutes ?? 0) || 0),
      );
    }
  }
  return {
    weekStart,
    budgets,
    explicitBudgetIds,
    dayWeights: normalizeDayWeights(dayWeightInputs),
  };
}

export function dateKeyToDayKey(dateKey) {
  const date = new Date(`${dateKey}T12:00:00`);
  const index = (date.getDay() + 6) % 7;
  return DAY_KEYS[index];
}

export function resolveDailyBudget({
  category,
  date,
  weekDocument,
  dailyDocument,
  defaultDayWeights = EQUAL_DAY_WEIGHTS,
}) {
  const overrides = dailyDocument?.overrides || {};
  if (hasOwn(overrides, category.id)) {
    return {
      minutes: Math.max(0, Math.round(Number(overrides[category.id]) || 0)),
      source: 'direct',
    };
  }
  const weeklyMinutes = resolveWeeklyBudgetMinutes(category, weekDocument);
  const distributed = distributeWeeklyMinutes(
    weeklyMinutes,
    effectiveDayWeights(weekDocument, defaultDayWeights),
  );
  return { minutes: distributed[dateKeyToDayKey(date)] || 0, source: 'day-weight' };
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

function achievement(budgetMinutes, actualMinutes) {
  if (budgetMinutes <= 0) {
    return actualMinutes > 0
      ? { percentage: null, differenceMinutes: actualMinutes, status: 'unbudgeted' }
      : { percentage: null, differenceMinutes: 0, status: 'unbudgeted' };
  }
  const differenceMinutes = actualMinutes - budgetMinutes;
  return {
    percentage: Math.round((actualMinutes / budgetMinutes) * 100),
    differenceMinutes,
    status: differenceMinutes > 0 ? 'exceeded' : 'remaining',
  };
}

export function summarizeDailyCategories({
  categories,
  entries,
  date,
  weekDocument,
  dailyDocument,
  defaultDayWeights = EQUAL_DAY_WEIGHTS,
}) {
  const relevant = entries.filter((entry) => entry.date === date);
  const categorySummaries = categories.map((category) => {
    const budget = resolveDailyBudget({
      category,
      date,
      weekDocument,
      dailyDocument,
      defaultDayWeights,
    });
    const actualMinutes = relevant
      .filter((entry) => entry.categoryId === category.id)
      .reduce((sum, entry) => sum + Math.max(0, Number(entry.durationMinutes) || 0), 0);
    return {
      id: category.id,
      name: category.name,
      budgetMinutes: budget.minutes,
      actualMinutes,
      budgetSource: budget.source,
      ...achievement(budget.minutes, actualMinutes),
    };
  });
  const totalBudgetMinutes = categorySummaries.reduce((sum, item) => sum + item.budgetMinutes, 0);
  const totalActualMinutes = categorySummaries.reduce((sum, item) => sum + item.actualMinutes, 0);
  return {
    totalBudgetMinutes,
    totalActualMinutes,
    ...achievement(totalBudgetMinutes, totalActualMinutes),
    categorySummaries,
  };
}
