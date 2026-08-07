import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { calendarMonthCells } from '../src/time-budget-domain.js';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('대시보드 일간 달력은 일요일을 첫 열로 사용한다', () => {
  const cells = calendarMonthCells(2026, 8, ['2026-08-01', '2026-08-02'], '2026-08-07');

  for (let index = 0; index < 6; index += 1) assert.equal(cells[index].date, null);
  assert.equal(cells[6].date, '2026-08-01');
  assert.equal(cells[7].date, '2026-08-02');
});

test('대시보드 달력 요일 헤더는 일요일부터 토요일 순서다', async () => {
  const ui = await read('src/time-budget-ui.js');
  assert.match(ui, /\['일','월','화','수','목','금','토'\]/);
  assert.doesNotMatch(ui, /\['월','화','수','목','금','토','일'\]/);
});
