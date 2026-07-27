import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('통계 화면이 이미 보이지만 로딩 중이면 통계 메뉴를 다시 클릭하지 않는다', async () => {
  const source = await read('src/statistics-session-state.js');
  const hiddenBranch = source.match(/if \(view\.classList\.contains\('hidden'\)\) \{[\s\S]*?button\.click\(\);[\s\S]*?return;[\s\S]*?\}/);

  assert.ok(hiddenBranch, '숨겨진 통계 화면에서만 메뉴를 클릭하는 분기가 필요합니다.');
  assert.match(source, /if \(!view\.querySelector\('\[data-stat-mode\]'\)\) return;/);
  assert.doesNotMatch(source, /view\.classList\.contains\('hidden'\) \|\| !view\.querySelector\('\[data-stat-mode\]'\)/);
});

test('통계 로딩이 끝나 탭 DOM이 생기면 저장된 탭과 기간 복원을 다시 시도한다', async () => {
  const source = await read('src/statistics-session-state.js');

  assert.match(
    source,
    /new MutationObserver\(\(\) => \{[\s\S]*desiredState\?\.activeView === 'statistics'[\s\S]*scheduleRestore\(\);[\s\S]*\}\)/,
  );
});
