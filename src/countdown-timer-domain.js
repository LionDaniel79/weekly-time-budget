const normalizedMinutes = (value) => Math.max(0, Math.round(Number(value) || 0));

export function buildCountdownBaseline({ budgetMinutes, recordedMinutes }) {
  const initialBudgetMinutes = normalizedMinutes(budgetMinutes);
  const priorRecordedMinutes = normalizedMinutes(recordedMinutes);
  return {
    initialBudgetMinutes,
    priorRecordedMinutes,
    initialRemainingMs: (initialBudgetMinutes - priorRecordedMinutes) * 60_000,
  };
}

export function timerDisplayMilliseconds(timer, elapsedMs = 0) {
  const elapsed = Math.max(0, Number(elapsedMs) || 0);
  return timer?.mode === 'countdown'
    ? Number(timer.initialRemainingMs || 0) - elapsed
    : elapsed;
}

export function formatSignedTimerMilliseconds(value, { countdown = false } = {}) {
  const number = Number(value) || 0;
  const sign = number < 0 ? '-' : '';
  const absoluteSeconds = Math.abs(number) / 1000;
  const totalSeconds = countdown
    ? Math.ceil(absoluteSeconds)
    : Math.floor(absoluteSeconds);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return `${sign}${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}
