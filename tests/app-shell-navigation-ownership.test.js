import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('앱 셸은 모든 메뉴 클릭을 capture 단계에서 단일 처리한다', async () => {
  const source = await read('src/app-shell.js');
  assert.match(source, /document\.addEventListener\('click',[\s\S]*\.nav-button\[data-view\][\s\S]*true\);/);
  assert.match(source, /event\.stopImmediatePropagation\(\)/);
  assert.match(source, /weekly-time-budget:view-changed/);
  assert.doesNotMatch(source, /button\.onclick\s*=/);
});

test('모바일 메뉴는 접근성 상태와 사이드바 상태를 함께 갱신한다', async () => {
  const source = await read('src/app-shell.js');
  assert.match(source, /aria-expanded/);
  assert.match(source, /setSidebarOpen/);
});
