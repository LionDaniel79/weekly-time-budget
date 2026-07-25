export function visibleComparisonMonthCount(year, referenceDate = new Date()) {
  const selectedYear = Number(year);
  const currentYear = referenceDate.getFullYear();
  if (selectedYear < currentYear) return 12;
  if (selectedYear > currentYear) return 0;
  return referenceDate.getMonth() + 1;
}
