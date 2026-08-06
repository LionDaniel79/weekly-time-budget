import { getWeekRange } from './domain.js';

const DATE_KEY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

function isValidDateKey(value) {
  const match = DATE_KEY_PATTERN.exec(String(value || ''));
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(year, month - 1, day, 12);
  return date.getFullYear() === year
    && date.getMonth() === month - 1
    && date.getDate() === day;
}

const uniqueSorted = (values) => [...new Set(values)].sort();

function isRecordedEntry(entry, currentDateKey) {
  const date = String(entry?.date || '');
  return isValidDateKey(date)
    && date <= currentDateKey
    && Number(entry?.durationMinutes) > 0
    && entry?.deleted !== true
    && entry?.isDeleted !== true
    && entry?.syncStatus !== 'deleted';
}

export function buildRecordedPeriodIndex(entries = [], currentDateKey) {
  const dates = uniqueSorted(entries
    .filter((entry) => isRecordedEntry(entry, currentDateKey))
    .map((entry) => entry.date));
  const weekStarts = uniqueSorted(dates.map((date) => (
    getWeekRange(new Date(`${date}T12:00:00`)).start
  )));
  const months = uniqueSorted(dates.map((date) => date.slice(0, 7)));
  const years = [...new Set(months.map((month) => Number(month.slice(0, 4))))]
    .sort((left, right) => left - right);
  return { dates, weekStarts, months, years };
}

export function previousRecordedPeriod(periods = [], selected) {
  return [...periods].reverse().find((item) => item < selected) || null;
}

export function nextRecordedPeriodOrCurrent(periods = [], selected, current) {
  if (!selected || selected >= current) return null;
  return periods.find((item) => item > selected && item <= current) || current;
}

export function adjacentWeekStart(selected, direction, current) {
  if (!isValidDateKey(selected) || !isValidDateKey(current)) return null;
  const date = new Date(`${selected}T12:00:00`);
  date.setDate(date.getDate() + (direction === 'previous' ? -7 : 7));
  const target = getWeekRange(date).start;
  if (direction !== 'previous' && target > current) return null;
  return target;
}

export function coerceRecordedPeriodSelection({ selected, current, recordedPeriods = [] }) {
  if (!selected || selected > current) return current;
  if (selected === current || recordedPeriods.includes(selected)) return selected;
  return previousRecordedPeriod(recordedPeriods, selected)
    || recordedPeriods.find((item) => item > selected && item <= current)
    || current;
}

export function monthOptionStates({ recordedMonths = [], year, currentYear, currentMonth }) {
  const recorded = new Set(recordedMonths);
  return Array.from({ length: 12 }, (_, index) => {
    const month = index + 1;
    const key = `${year}-${String(month).padStart(2, '0')}`;
    const current = year === currentYear && month === currentMonth;
    const future = year > currentYear || (year === currentYear && month > currentMonth);
    return { month, enabled: !future && (current || recorded.has(key)), current };
  });
}

export function recordedYearOptions(recordedYears = [], currentYear) {
  return [...new Set([...recordedYears, currentYear])]
    .filter((year) => Number.isInteger(year) && year <= currentYear)
    .sort((left, right) => right - left);
}

export function defaultMonthForYear({ year, currentYear, currentMonth, recordedMonths = [] }) {
  if (year === currentYear) return currentMonth;
  if (year > currentYear) return null;
  const months = recordedMonths
    .filter((key) => Number(key.slice(0, 4)) === year)
    .map((key) => Number(key.slice(5, 7)))
    .filter((month) => month >= 1 && month <= 12)
    .sort((left, right) => right - left);
  return months[0] ?? null;
}

export function coerceMonthlySelection({
  year,
  month,
  currentYear,
  currentMonth,
  recordedMonths = [],
}) {
  const selectedYear = Number(year);
  const selectedMonth = Number(month);
  if (!Number.isInteger(selectedYear) || !Number.isInteger(selectedMonth)
    || selectedMonth < 1 || selectedMonth > 12 || selectedYear > currentYear) {
    return { year: currentYear, month: currentMonth };
  }

  if (selectedYear === currentYear && selectedMonth === currentMonth) {
    return { year: selectedYear, month: selectedMonth };
  }

  const monthsForYear = recordedMonths
    .filter((key) => Number(key.slice(0, 4)) === selectedYear)
    .map((key) => Number(key.slice(5, 7)))
    .filter((value) => value >= 1 && value <= 12
      && (selectedYear < currentYear || value <= currentMonth))
    .sort((left, right) => left - right);

  if (monthsForYear.includes(selectedMonth)) {
    return { year: selectedYear, month: selectedMonth };
  }

  const previous = [...monthsForYear].reverse().find((value) => value < selectedMonth);
  if (previous) return { year: selectedYear, month: previous };
  const next = monthsForYear.find((value) => value > selectedMonth);
  if (next) return { year: selectedYear, month: next };
  return { year: currentYear, month: currentMonth };
}
