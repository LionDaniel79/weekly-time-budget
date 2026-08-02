import test from 'node:test';
import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

async function missing(path) {
  try {
    await access(new URL(`../${path}`, import.meta.url));
    return false;
  } catch {
    return true;
  }
}

test('통계 화면은 새 bootstrap 하나만 로드한다', async () => {
  const html = await read('index.html');
  assert.match(html, /src="\.\/src\/statistics-bootstrap\.js"/);
  assert.doesNotMatch(html, /statistics-offline-rescue|statistics-ui|statistics-session-state|statistics-mobile-overflow/);
});

test('기록 기간 모듈은 통계 DOM을 참조하지 않는다', async () => {
  const source = await read('src/recorded-period-navigation.js');
  assert.doesNotMatch(source, /statistics-view|data-rescue-stat-mode|statistics-rescue-month|patchStatistics/);
});

test('통계 feature만 통계 DOM 이벤트를 소유한다', async () => {
  const source = await read('src/statistics-feature.js');
  assert.match(source, /root\.addEventListener\('click', onClick\)/);
  assert.match(source, /root\.addEventListener\('change', onChange\)/);
  assert.doesNotMatch(source, /MutationObserver|stopImmediatePropagation/);
});

test('과거 통계 제품 파일은 삭제한다', async () => {
  for (const path of [
    'src/statistics-offline-rescue.js',
    'src/statistics-ui.js',
    'src/statistics-session-state.js',
    'src/statistics-mobile-overflow.js',
  ]) {
    assert.equal(await missing(path), true, path);
  }
});
