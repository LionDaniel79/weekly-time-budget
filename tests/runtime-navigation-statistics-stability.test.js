import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('모바일 메뉴와 화면 전환은 앱 셸 하나가 위임 처리한다', async () => {
  const source = await read('src/app-shell.js');
  assert.match(source, /closest\?\.\('#mobile-menu'\)/);
  assert.match(source, /closest\?\.\('\.nav-button\[data-view\]'\)/);
  assert.doesNotMatch(source, /stopImmediatePropagation|stopPropagation/);
  assert.match(source, /alreadyVisible/);
});

test('통계는 복원과 인증 이벤트에서 중복 진입하지 않는다', async () => {
  const source = await read('src/statistics-bootstrap.js');
  assert.match(source, /if \(nextView === currentView\) return/);
  assert.match(source, /feature\.restore\(event\.detail\?\.statistics \|\| \{\}\)/);
  assert.doesNotMatch(source, /activeView === 'statistics'\) feature\.enter/);
  assert.match(source, /refreshQueued/);
});

test('주별 통계는 기록이 없는 인접 주도 유지한다', async () => {
  const source = await read('src/statistics-state.js');
  assert.match(source, /validWeekStart/);
  assert.doesNotMatch(source, /coerceRecordedPeriodSelection/);
  assert.match(source, /selected > currentWeekStart/);
});

test('안정화 빌드 v26가 모든 실행 자산에 적용된다', async () => {
  const [html, worker, registration] = await Promise.all([
    read('index.html'), read('service-worker.js'), read('src/service-worker-registration.js'),
  ]);
  assert.match(html, /data-app-build="2026\.08\.07-stability-v26"/);
  assert.match(html, /앱 버전 v26/);
  assert.match(worker, /APP_BUILD = '2026\.08\.07-stability-v26'/);
  assert.match(registration, /APP_BUILD = '2026\.08\.07-stability-v26'/);
});
