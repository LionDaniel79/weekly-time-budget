const RETRYABLE_CODES = new Set([
  'unavailable',
  'deadline-exceeded',
  'resource-exhausted',
  'aborted',
  'network-request-failed',
]);

function normalizedErrorCode(error = {}) {
  const value = String(error?.code || '').toLowerCase();
  const parts = value.split('/');
  return parts[parts.length - 1];
}

function sortableTimestamp(value) {
  if (value && typeof value.toMillis === 'function') return value.toMillis();
  const number = Number(value);
  if (Number.isFinite(number)) return number;
  const parsed = Date.parse(String(value || ''));
  return Number.isFinite(parsed) ? parsed : 0;
}

export function createPendingEntry({
  userId,
  entry,
  localId,
  createdAt = Date.now(),
  clearActiveTimer = null,
}) {
  if (!userId) throw new Error('사용자 정보가 필요합니다.');
  if (!localId) throw new Error('기록 ID가 필요합니다.');
  if (!entry?.categoryId) throw new Error('대분류 정보가 필요합니다.');

  return {
    localId,
    userId,
    categoryId: entry.categoryId,
    entry: { ...entry, id: localId },
    status: 'pending',
    attempts: 0,
    createdAt,
    lastAttemptAt: null,
    lastError: null,
    clearActiveTimer,
  };
}

export function classifySyncError(error = {}) {
  const code = normalizedErrorCode(error);
  const message = String(error?.message || error || '');
  if (RETRYABLE_CODES.has(code)) return 'retryable';
  if (/network|offline|failed to fetch|connection|timeout/i.test(message)) return 'retryable';
  return 'permanent';
}

export function mergeRemoteAndPendingEntries(remoteEntries = [], pendingRecords = []) {
  const merged = new Map();

  remoteEntries.forEach((entry) => {
    if (!entry?.id) return;
    merged.set(entry.id, { ...entry, syncStatus: 'synced' });
  });

  pendingRecords.forEach((record) => {
    if (!record?.localId || !record?.entry) return;
    merged.set(record.localId, {
      ...record.entry,
      id: record.localId,
      createdAt: record.entry.createdAt ?? record.createdAt,
      syncStatus: record.status || 'pending',
      syncError: record.lastError || null,
    });
  });

  return [...merged.values()].sort((left, right) => {
    const timeDifference = sortableTimestamp(right.createdAt) - sortableTimestamp(left.createdAt);
    if (timeDifference) return timeDifference;
    const dateDifference = String(right.date || '').localeCompare(String(left.date || ''));
    if (dateDifference) return dateDifference;
    return String(right.id || '').localeCompare(String(left.id || ''));
  });
}
