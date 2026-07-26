export const MANUAL_INPUT_MODES = Object.freeze({
  TIME_RANGE: 'time-range',
  DURATION: 'duration',
});

export const MANUAL_DURATION_ERROR =
  '기록 시간은 1분 이상 1,440분 이하의 정수로 입력하세요.';

export function parseManualDurationMinutes(value) {
  const text = String(value ?? '').trim();
  if (!/^\d+$/.test(text)) throw new RangeError(MANUAL_DURATION_ERROR);

  const minutes = Number(text);
  if (!Number.isSafeInteger(minutes) || minutes < 1 || minutes > 1440) {
    throw new RangeError(MANUAL_DURATION_ERROR);
  }
  return minutes;
}

export function createManualDurationEntry({
  categoryId,
  date,
  note = '',
  durationMinutes,
}) {
  return {
    categoryId,
    date,
    note: String(note).trim(),
    durationMinutes: parseManualDurationMinutes(durationMinutes),
    source: 'manual-duration',
  };
}

export function manualEntryTimeLabel(entry, formatMinutes) {
  const duration = formatMinutes(Number(entry?.durationMinutes) || 0);
  if (entry?.source === 'manual-duration') return `직접 입력 · ${duration}`;
  if (entry?.startTime && entry?.endTime) {
    return `${entry.startTime}–${entry.endTime} · ${duration}`;
  }
  return duration;
}
