import { getWeekRange, toDateKey } from './domain.js';
import { filterCategoriesActiveOnDate } from './category-effective-date.js';
import { buildPreviousWeekBudgetDefaults, previousSameWeekdayMinutes } from './time-budget-domain.js';

const DEFAULT_SOURCE_VERSION = 'previous-results-v3';
let runningFor = '';

async function migrateCurrentBudgets(detail = {}) {
  const user = detail.user;
  const dataSource = detail.dataSource;
  const categories = Array.isArray(detail.categories) ? detail.categories : [];
  const entries = Array.isArray(detail.entries) ? detail.entries : [];
  if (!user?.uid || !dataSource?.loadTimeBudgetData || !dataSource?.ensureCurrentWeekBudget) return;

  const today = toDateKey(new Date());
  const weekStart = getWeekRange(new Date(`${today}T12:00:00`)).start;
  const runKey = `${user.uid}:${weekStart}:${entries.length}:${categories.length}`;
  if (runningFor === runKey) return;
  runningFor = runKey;

  try {
    const data = await dataSource.loadTimeBudgetData(user.uid);
    const currentWeek = (data.weeklyBudgets || []).find((item) => (item.weekStart || item.id) === weekStart);
    const activeCategories = filterCategoriesActiveOnDate(categories, today);

    if (currentWeek?.defaultSourceVersion !== DEFAULT_SOURCE_VERSION) {
      const budgets = buildPreviousWeekBudgetDefaults({ categories: activeCategories, entries, weekStart });
      await dataSource.ensureCurrentWeekBudget(user.uid, {
        id: currentWeek?.id || weekStart,
        weekStart,
        budgets,
        explicitBudgetIds: [],
        initializedFromPreviousResults: true,
        userModified: false,
        defaultSourceVersion: DEFAULT_SOURCE_VERSION,
      });
    }

    const currentDay = (data.dailyBudgets || []).find((item) => (item.date || item.id) === today);
    if (currentDay?.defaultSourceVersion !== DEFAULT_SOURCE_VERSION && dataSource.saveDailyBudgetSnapshot) {
      const overrides = Object.fromEntries(activeCategories.map((category) => [
        category.id,
        previousSameWeekdayMinutes(entries, category.id, today),
      ]));
      await dataSource.saveDailyBudgetSnapshot(user.uid, today, {
        overrides,
        userModified: false,
        defaultSourceVersion: DEFAULT_SOURCE_VERSION,
      });
    }

    document.dispatchEvent(new CustomEvent('weekly-time-budget:data-changed'));
  } catch (error) {
    console.error('지난주 결과 기반 예산 마이그레이션 실패', error);
  } finally {
    runningFor = '';
  }
}

document.addEventListener('weekly-time-budget:infrastructure-state', (event) => {
  migrateCurrentBudgets(event.detail || {});
});
