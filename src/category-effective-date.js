const DATE_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const pad = (value) => String(value).padStart(2, '0');
const localDateKey = (date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;

export function normalizeDateKey(value) {
  const text = String(value ?? '').slice(0, 10);
  if (!DATE_KEY_PATTERN.test(text)) return null;
  const [year, month, day] = text.split('-').map(Number);
  const date = new Date(year, month - 1, day, 12, 0, 0, 0);
  return localDateKey(date) === text ? text : null;
}

export function normalizeCategoryCreatedDate(category = {}) {
  return normalizeDateKey(category.createdDate);
}

export function isCategoryActiveOnDate(category = {}, dateKey) {
  const date = normalizeDateKey(dateKey);
  if (!date) return false;
  const createdDate = normalizeCategoryCreatedDate(category);
  return !createdDate || date >= createdDate;
}

export function isCategoryActiveInRange(category = {}, startDate, endDate) {
  const start = normalizeDateKey(startDate);
  const end = normalizeDateKey(endDate);
  if (!start || !end || start > end) return false;
  const createdDate = normalizeCategoryCreatedDate(category);
  return !createdDate || createdDate <= end;
}

export function isEntryWithinCategoryEffectiveDate(entry = {}, category = null) {
  if (!category) return true;
  return isCategoryActiveOnDate(category, entry.date);
}

export function filterCategoriesActiveOnDate(categories = [], dateKey) {
  return categories.filter((category) => isCategoryActiveOnDate(category, dateKey));
}
