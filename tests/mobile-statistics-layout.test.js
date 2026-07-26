import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const sourceUrl = new URL('../src/statistics-ui.js', import.meta.url);

async function source() {
  return readFile(sourceUrl, 'utf8');
}

test('모든 통계 표 셀은 모바일 항목명을 위한 data-label을 가진다', async () => {
  const code = await source();
  for (const label of [
    '대분류', '기간', '기간 예산', '실제 기록', '달성률', '차이',
    '기록 일수', '하루 평균', '전월 대비', '전년 대비', '전체',
  ]) {
    assert.match(code, new RegExp(`data-label=["']${label}["']`));
  }
});

test('800px 이하에서는 통계 표가 가로 스크롤 없는 카드형으로 전환된다', async () => {
  const code = await source();
  assert.match(code, /@media\(max-width:800px\)/);
  assert.match(code, /\.statistics-table-wrap\s*\{[^}]*overflow-x\s*:\s*hidden/s);
  assert.match(code, /\.statistics-table-wrap\s*\{[^}]*width\s*:\s*100%/s);
  assert.match(code, /\.statistics-table\s*\{[^}]*min-width\s*:\s*0/s);
  assert.match(code, /\.statistics-table\s*\{[^}]*max-width\s*:\s*100%/s);
  assert.match(code, /\.statistics-table thead\s*\{[^}]*display\s*:\s*none/s);
  assert.match(code, /\.statistics-table tbody\s*\{[^}]*display\s*:\s*grid/s);
  assert.match(code, /\.statistics-table tr\s*\{[^}]*display\s*:\s*grid/s);
  assert.match(code, /\.statistics-table td::before\s*\{[^}]*content\s*:\s*attr\(data-label\)/s);
});

test('월간·연도별 비교 카드는 내부 내용이 화면 폭을 넓히지 않는다', async () => {
  const code = await source();
  assert.match(code, /\.statistics-card\s*\{[^}]*min-width\s*:\s*0/s);
  assert.match(code, /\.statistics-card\s*\{[^}]*max-width\s*:\s*100%/s);
  assert.match(code, /\.comparison-row\s*\{[^}]*min-width\s*:\s*0/s);
  assert.match(code, /\.comparison-bars\s*\{[^}]*min-width\s*:\s*0/s);
  assert.match(code, /\.statistics-table td[^}]*overflow-wrap\s*:\s*anywhere/s);
  assert.match(code, /\.matrix-cell strong\s*\{[^}]*overflow-wrap\s*:\s*anywhere/s);
});

test('데스크톱 통계 표는 기존 760px보다 작은 최소 폭과 압축된 셀 여백을 사용한다', async () => {
  const code = await source();
  assert.doesNotMatch(code, /min-width\s*:\s*760px/);
  assert.doesNotMatch(code, /padding\s*:\s*12px 10px/);
  assert.match(code, /\.achievement-cell\s*\{[^}]*min-width\s*:\s*1[4-8]0px/s);
});

test('모바일 통계 스타일 변경 후에도 자바스크립트 문법이 유효하다', () => {
  const path = fileURLToPath(sourceUrl);
  const result = spawnSync(process.execPath, ['--check', path], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr || result.stdout);
});
