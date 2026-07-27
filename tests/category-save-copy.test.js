import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('대분류 일괄 적용 버튼은 저장으로 표시한다', async () => {
  const source = await read('src/category-save-label.js');
  assert.ok(source.includes("button.textContent = '저장'"));
  assert.ok(source.includes("button.textContent !== '대분류 변경사항 적용'"));
});

test('저장 문구 패치는 대분류 편집기 뒤에 로드된다', async () => {
  const html = await read('index.html');
  const editor = html.indexOf('./src/category-bulk-editor.js');
  const label = html.indexOf('./src/category-save-label.js');
  assert.ok(editor >= 0 && label > editor);
});

test('PWA 셸 캐시는 변경된 화면을 위해 v7을 사용한다', async () => {
  const source = await read('service-worker.js');
  assert.ok(source.includes("const SHELL_CACHE = 'weekly-time-budget-shell-v7';"));
});
