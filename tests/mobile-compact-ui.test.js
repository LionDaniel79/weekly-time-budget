import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('모바일 기록 내역은 날짜와 삭제 버튼을 같은 행에 두고 높이를 줄인다', async () => {
  const source = await read('styles.css');
  const mobile = source.slice(source.indexOf('@media(max-width:600px)'));
  assert.match(mobile, /\.entry\s*\{[^}]*grid-template-columns:\s*auto minmax\(0,1fr\) auto;/);
  assert.match(mobile, /\.entry\s*>\s*strong:first-child\s*\{[^}]*white-space:\s*nowrap;/);
  assert.match(mobile, /\.entry \.entry-actions\s*\{[^}]*grid-column:\s*auto;/);
  assert.match(mobile, /\.entry\s*\{[^}]*padding:\s*(?:8|9|10)px 0;/);
  assert.match(mobile, /\.entry p\s*\{[^}]*margin:\s*2px 0 0;/);
});

test('모바일 메뉴 버튼은 두 줄로 나뉘지 않는다', async () => {
  const source = await read('styles.css');
  assert.match(source, /\.mobile-menu\s*\{[^}]*white-space:\s*nowrap;[^}]*word-break:\s*keep-all;[^}]*flex-shrink:\s*0;/s);
  assert.match(source, /\.topbar\s*>\s*div\s*\{[^}]*min-width:\s*0;/);
});
