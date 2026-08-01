import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const statisticsUrl = new URL('../src/statistics-offline-rescue.js', import.meta.url);
const primaryStyleUrl = new URL('../src/statistics-primary.css', import.meta.url);
const overflowFixUrl = new URL('../src/statistics-mobile-overflow.js', import.meta.url);

async function source() {
  const [statistics, primaryStyle, overflowFix] = await Promise.all([
    readFile(statisticsUrl, 'utf8'),
    readFile(primaryStyleUrl, 'utf8'),
    readFile(overflowFixUrl, 'utf8'),
  ]);
  return `${statistics}\n${primaryStyle}\n${overflowFix}`;
}

test('모든 통계 표 셀은 모바일 항목명을 위한 data-label을 가진다', async () => {
  const code = await source();
  for (const label of [
    '대분류', '기간', '기간 예산', '실제 기록', '달성률', '차이',
    '목표 준수', '기록 일수', '전월 대비', '전년 대비',
  ]) {
    assert.match(code, new RegExp(`data-label=["']${label}["']`));
  }
});

test('800px 이하에서는 통계 표가 가로 스크롤 없는 카드형으로 전환된다', async () => {
  const code = await source();
  assert.match(code, /@media\s*\(max-width:\s*800px\)/);
  assert.match(code, /\.statistics-rescue-table thead\s*\{[^}]*display\s*:\s*none/s);
  assert.match(code, /\.statistics-rescue-table,.statistics-rescue-table tbody\s*\{[^}]*display\s*:\s*grid/s);
  assert.match(code, /\.statistics-rescue-table tr\s*\{[^}]*display\s*:\s*grid/s);
  assert.match(code, /\.statistics-rescue-table td::before\s*\{[^}]*content\s*:\s*attr\(data-label\)/s);
});

test('통계 요약과 표는 모바일 화면 폭을 넓히지 않는다', async () => {
  const code = await source();
  assert.match(code, /\.statistics-card\s*\{[^}]*min-width\s*:\s*0/s);
  assert.match(code, /\.statistics-card\s*\{[^}]*max-width\s*:\s*100%/s);
  assert.match(code, /\.statistics-summary\s*\{[^}]*grid-template-columns/s);
});

test('모바일 가로 스크롤 보정 모듈이 주 통계 모듈 다음에 로드된다', async () => {
  const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  const statisticsPosition = html.indexOf('statistics-offline-rescue.js');
  const overflowPosition = html.indexOf('statistics-mobile-overflow.js');
  assert.ok(statisticsPosition >= 0);
  assert.ok(overflowPosition > statisticsPosition);
});

test('데스크톱 통계 표는 과도한 고정 최소 폭을 사용하지 않는다', async () => {
  const code = await source();
  assert.doesNotMatch(code, /min-width\s*:\s*760px/);
  assert.doesNotMatch(code, /padding\s*:\s*12px 10px/);
  assert.match(code, /\.statistics-rescue-table th,.statistics-rescue-table td\s*\{[^}]*padding\s*:\s*9px 7px/s);
});

test('모바일 통계 스타일 변경 후에도 자바스크립트 문법이 유효하다', () => {
  for (const url of [statisticsUrl, overflowFixUrl]) {
    const path = fileURLToPath(url);
    const result = spawnSync(process.execPath, ['--check', path], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr || result.stdout);
  }
});
