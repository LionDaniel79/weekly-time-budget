const pad = (value) => String(value).padStart(2, '0');

export function toDateKey(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
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

export function calculateAchievement(budgetMinutes, actualMinutes) {
  const percentage = budgetMinutes > 0 ? Math.round((actualMinutes / budgetMinutes) * 100) : 0;
  const differenceMinutes = actualMinutes - budgetMinutes;
  return {
    percentage,
    differenceMinutes,
    status: differenceMinutes >= 0 ? 'exceeded' : 'remaining',
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
    return {
      id: category.id,
      name: category.name,
      budgetMinutes: category.budgetMinutes || 0,
      actualMinutes,
      ...calculateAchievement(category.budgetMinutes || 0, actualMinutes),
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
