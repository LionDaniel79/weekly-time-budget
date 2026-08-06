import { getWeekRange, toDateKey } from './domain.js';
import { filterCategoriesActiveOnDate } from './category-effective-date.js';
import { buildPreviousWeekBudgetDefaults } from './time-budget-domain.js';

const DEFAULT_SOURCE_VERSION = 'previous-results-v2';
let runningFor = '';

async function migrateCurrentWeek(detail = {}) {
  const user = detail.user;
  const dataSource = detail.dataSource;
  const categories = Array.isArray(detail.categories) ? detail.categories : [];
  const entries = Array.isArray(detail.entries) ? detail.entries : [];
  if (!user?.uid || !dataSource?.loadTimeBudgetData || !dataSource?.ensureCurrentWeekBudget) return;

  const today = toDateKey(new Date());
  const weekStart = getWeekRange(new Date(`${today}T12:00:00`)).start;
  const runKey = `${user.uid}:${weekStart}`;
  if (runningFor === runKey) return;
  runningFor = runKey;

  try {
    const data = await dataSource.loadTimeBudgetData(user.uid);
    const current = (data.weeklyBudgets || []).find((item) => (item.weekStart || item.id) === weekStart);
    if (current?.defaultSourceVersion === DEFAULT_SOURCE_VERSION) return;

    const activeCategories = filterCategoriesActiveOnDate(categories, today);
    const budgets = buildPreviousWeekBudgetDefaults({ categories: activeCategories, entries, weekStart });
    await dataSource.ensureCurrentWeekBudget(user.uid, {
      id: current?.id || weekStart,
      weekStart,
      budgets,
      explicitBudgetIds: [],
      initializedFromPreviousResults: true,
      defaultSourceVersion: DEFAULT_SOURCE_VERSION,
    });
    document.dispatchEvent(new CustomEvent('weekly-time-budget:data-changed'));
  } catch (error) {
    console.error('지난주 결과 기반 예산 마이그레이션 실패', error);
  } finally {
    runningFor = '';
  }
}

document.addEventListener('weekly-time-budget:infrastructure-state', (event) => {
  migrateCurrentWeek(event.detail || {});
});
