import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const viewUrl = new URL('../src/statistics-view.js', import.meta.url);
const featureUrl = new URL('../src/statistics-feature.js', import.meta.url);
const bootstrapUrl = new URL('../src/statistics-bootstrap.js', import.meta.url);
const primaryStyleUrl = new URL('../src/statistics-primary.css', import.meta.url);

async function source() {
  const [view, primaryStyle] = await Promise.all([
    readFile(viewUrl, 'utf8'),
    readFile(primaryStyleUrl, 'utf8'),
  ]);
  return `${view}\n${primaryStyle}`;
}

test('모든 통계 표 셀은 모바일 항목명을 위한 data-label을 가진다', async () => {
  const code = await source();
  for (const label of [
    '대분류', '기간', '기간 예산', '실제 기록', '달성률', '차이',
    '목표 준수', '기록 일수',
  ]) assert.match(code, new RegExp(`data-label=["']${label}["']`));
  assert.ok(code.includes('data-label="${changeLabel}"'));
  assert.ok(code.includes("'전월 대비'"));
  assert.ok(code.includes("'전년 대비'"));
});

test('800px 이하에서는 통계 표가 가로 스크롤 없는 카드형으로 전환된다', async () => {
  const code = await source();
  assert.match(code, /@media\s*\(max-width:\s*800px\)/);
  assert.match(code, /\.statistics-rescue-table thead\s*\{[^}]*display\s*:\s*none/s);
  assert.match(code, /\.statistics-rescue-table,[\s\S]*?\.statistics-rescue-table tbody\s*\{[^}]*display\s*:\s*grid/s);
  assert.match(code, /\.statistics-rescue-table tr\s*\{[^}]*display\s*:\s*grid/s);
  assert.match(code, /\.statistics-rescue-table td::before\s*\{[^}]*content\s*:\s*attr\(data-label\)/s);
});

test('통계 요약과 표는 모바일 화면 폭을 넓히지 않는다', async () => {
  const code = await source();
  assert.match(code, /\.statistics-card\s*\{[^}]*min-width\s*:\s*0/s);
  assert.match(code, /\.statistics-card\s*\{[^}]*max-width\s*:\s*100%/s);
  assert.match(code, /\.statistics-summary\s*\{[^}]*grid-template-columns/s);
});

test('모바일 통계 스타일은 CSS에 통합되고 별도 삽입 모듈은 로드하지 않는다', async () => {
  const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  assert.ok(html.includes('./src/statistics-primary.css'));
  assert.ok(html.includes('./src/statistics-bootstrap.js'));
  assert.doesNotMatch(html, /statistics-mobile-overflow\.js/);
});

test('데스크톱 통계 표는 과도한 고정 최소 폭을 사용하지 않는다', async () => {
  const code = await source();
  assert.doesNotMatch(code, /min-width\s*:\s*760px/);
  assert.match(code, /\.statistics-rescue-table th,[\s\S]*?\.statistics-rescue-table td\s*\{[^}]*padding\s*:\s*9px 7px/s);
});

test('통계 화면 모듈의 자바스크립트 문법이 유효하다', () => {
  for (const url of [viewUrl, featureUrl, bootstrapUrl]) {
    const result = spawnSync(process.execPath, ['--check', fileURLToPath(url)], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr || result.stdout);
  }
});
