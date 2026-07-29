import { readFile, writeFile } from 'node:fs/promises';

const path = 'src/domain.js';
let source = await readFile(path, 'utf8');

const previousFunction = `function effectiveWeeklyBudget(category, week, dateKey) {
  if (!isCategoryActiveOnDate(category, dateKey)) return 0;
  const archivedDate = normalizedTimestampDate(category.archivedAt);
  if (archivedDate && dateKey > archivedDate) return 0;
  const override = week?.budgets?.[category.id];
  return override === undefined ? defaultBudgetMinutes(category) : Number(override) || 0;
}`;

const nextFunction = `const PERIOD_DAY_KEYS = Object.freeze(['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']);

function periodDayKey(dateKey) {
  const index = (fromDateKey(dateKey).getDay() + 6) % 7;
  return PERIOD_DAY_KEYS[index];
}

function distributedWeeklyMinutes(totalMinutes, rawWeights = {}) {
  const total = Math.max(0, Math.round(Number(totalMinutes) || 0));
  const values = Object.fromEntries(PERIOD_DAY_KEYS.map((key) => {
    const value = Number(rawWeights?.[key]);
    return [key, Number.isFinite(value) && value > 0 ? value : 0];
  }));
  const weightTotal = Object.values(values).reduce((sum, value) => sum + value, 0);
  const weights = weightTotal
    ? Object.fromEntries(PERIOD_DAY_KEYS.map((key) => [key, values[key] / weightTotal]))
    : Object.fromEntries(PERIOD_DAY_KEYS.map((key) => [key, 1 / PERIOD_DAY_KEYS.length]));
  let assigned = 0;
  return Object.fromEntries(PERIOD_DAY_KEYS.map((key, index) => {
    const remaining = Math.max(0, total - assigned);
    const minutes = index === PERIOD_DAY_KEYS.length - 1
      ? remaining
      : Math.min(remaining, Math.max(0, Math.round(total * weights[key])));
    assigned += minutes;
    return [key, minutes];
  }));
}

function effectiveDailyBudget(category, week, dateKey) {
  if (!isCategoryActiveOnDate(category, dateKey)) return 0;
  const archivedDate = normalizedTimestampDate(category.archivedAt);
  if (archivedDate && dateKey > archivedDate) return 0;
  const override = week?.budgets?.[category.id];
  const weeklyMinutes = override === undefined ? defaultBudgetMinutes(category) : Number(override) || 0;
  return distributedWeeklyMinutes(weeklyMinutes, week?.dayWeights)[periodDayKey(dateKey)] || 0;
}`;

if (!source.includes(previousFunction)) throw new Error('effectiveWeeklyBudget function not found');
source = source.replace(previousFunction, nextFunction);

const previousAggregation = `      const weeklyMinutes = effectiveWeeklyBudget(category, week, dateKey);
      budgetById.set(category.id, (budgetById.get(category.id) || 0) + weeklyMinutes / 7);`;
const nextAggregation = `      const dailyMinutes = effectiveDailyBudget(category, week, dateKey);
      budgetById.set(category.id, (budgetById.get(category.id) || 0) + dailyMinutes);`;
if (!source.includes(previousAggregation)) throw new Error('weekly budget aggregation not found');
source = source.replace(previousAggregation, nextAggregation);

await writeFile(path, source);
console.log('weighted effective-date budget fix applied');
