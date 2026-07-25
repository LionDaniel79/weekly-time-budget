import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { visibleComparisonMonthCount } from '../src/statistics-period.js';

const referenceDate = new Date('2026-07-26T12:00:00+09:00');

test('현재 연도의 월간 비교는 현재 월까지만 표시한다', () => {
  assert.equal(visibleComparisonMonthCount(2026, referenceDate), 7);
});

test('과거 연도의 월간 비교는 12개월 전체를 표시한다', () => {
  assert.equal(visibleComparisonMonthCount(2025, referenceDate), 12);
});

test('미래 연도의 월간 비교는 아직 표시하지 않는다', () => {
  assert.equal(visibleComparisonMonthCount(2027, referenceDate), 0);
});

test('현재 월 필터 모듈은 월간 비교의 미래 월 행을 제거하고 제목을 동적으로 바꾼다', async () => {
  const [indexHtml, source] = await Promise.all([
    readFile(new URL('../index.html', import.meta.url), 'utf8'),
    readFile(new URL('../src/current-month-statistics.js', import.meta.url), 'utf8'),
  ]);
  assert.match(indexHtml, /current-month-statistics\.js/);
  assert.match(source, /visibleComparisonMonthCount/);
  assert.match(source, /remove\(\)/);
  assert.match(source, /1월~\$\{lastMonth\}월 비교/);
  const path = fileURLToPath(new URL('../src/current-month-statistics.js', import.meta.url));
  const result = spawnSync(process.execPath, ['--check', path], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr || result.stdout);
});
