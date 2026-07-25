import { visibleComparisonMonthCount } from './statistics-period.js';

const referenceDate = new Date();
let patchScheduled = false;

function monthNumber(text) {
  const match = String(text || '').trim().match(/^(\d{1,2})월/);
  return match ? Number(match[1]) : null;
}

function rescaleVisibleComparisonBars(view) {
  const fills = [...view.querySelectorAll('.comparison-row .stat-bar-fill')];
  const widths = fills.map((fill) => Number.parseFloat(fill.style.width) || 0);
  const maximum = Math.max(0, ...widths);
  if (!maximum) return;
  fills.forEach((fill, index) => {
    fill.style.width = `${widths[index] / maximum * 100}%`;
  });
}

function trimFutureMonths() {
  const view = document.querySelector('#statistics-view');
  if (!view || view.classList.contains('hidden')) return;
  if (!view.querySelector('[data-stat-mode="monthly-comparison"].active')) return;

  const year = Number(view.querySelector('#statistics-year')?.value);
  if (!Number.isFinite(year)) return;
  const lastMonth = visibleComparisonMonthCount(year, referenceDate);
  let removed = false;

  view.querySelectorAll('.comparison-row').forEach((row) => {
    const month = monthNumber(row.querySelector('strong')?.textContent);
    if (month !== null && month > lastMonth) {
      row.remove();
      removed = true;
    }
  });

  view.querySelectorAll('.statistics-table tbody tr').forEach((row) => {
    const month = monthNumber(row.querySelector('td:first-child')?.textContent);
    if (month !== null && month > lastMonth) {
      row.remove();
      removed = true;
    }
  });

  const header = document.querySelector('#week-label');
  if (header) {
    header.textContent = lastMonth > 0
      ? `${year}년 1월~${lastMonth}월 비교 · 예산 대비 통계`
      : `${year}년 · 아직 비교할 통계 기간이 없습니다.`;
  }

  if (removed) rescaleVisibleComparisonBars(view);
}

function schedulePatch() {
  if (patchScheduled) return;
  patchScheduled = true;
  queueMicrotask(() => {
    patchScheduled = false;
    trimFutureMonths();
  });
}

const statisticsView = document.querySelector('#statistics-view');
if (statisticsView) {
  const observer = new MutationObserver(schedulePatch);
  observer.observe(statisticsView, { childList: true, subtree: true });
}

document.addEventListener('click', (event) => {
  if (event.target.closest('[data-stat-mode], [data-view="statistics"]')) schedulePatch();
}, true);

document.addEventListener('change', (event) => {
  if (event.target.matches('#statistics-year')) schedulePatch();
}, true);

schedulePatch();
