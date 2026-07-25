const pad = (value) => String(value).padStart(2, '0');

export function toDateKey(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function isManagedDay(date) {
  const day = date.getDay();
  return day >= 1 && day <= 6;
}

export function getWeekRange(date = new Date()) {
  const current = new Date(date);
  const day = current.getDay();
  const offset = day === 0 ? -6 : 1 - day;
  const monday = new Date(current);
  monday.setDate(current.getDate() + offset);
  monday.setHours(0, 0, 0, 0);
  const saturday = new Date(monday);
  saturday.setDate(monday.getDate() + 5);
  return { start: toDateKey(monday), end: toDateKey(saturday) };
}

export function getBudgetWeekKey(date = new Date()) {
  return getWeekRange(date).start;
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
      .reduce((sum, entry) => sum + entry.durationMinutes, 0);
    return {
      id: category.id,
      name: category.name,
      budgetMinutes: category.budgetMinutes || 0,
      actualMinutes,
      ...calculateAchievement(category.budgetMinutes || 0, actualMinutes),
    };
  });
}

export function formatMinutes(minutes) {
  const absolute = Math.abs(Math.round(minutes));
  const hours = Math.floor(absolute / 60);
  const mins = absolute % 60;
  if (!hours) return `${mins}분`;
  if (!mins) return `${hours}시간`;
  return `${hours}시간 ${mins}분`;
}
