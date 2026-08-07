import test from 'node:test';
import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('1단계: 앱 셸이 모든 메뉴 전환을 capture 단계에서 소유한다', async () => {
  const shell = await read('src/app-shell.js');
  assert.match(shell, /\.nav-button\[data-view\]/);
  assert.match(shell, /preventDefault/);
  assert.doesNotMatch(shell, /stopImmediatePropagation/);
  assert.match(shell, /weekly-time-budget:view-changed/);
  assert.doesNotMatch(shell, /button\.onclick\s*=/);
});

test('2단계: PWA는 최신 세대와 일회성 캐시 초기화를 사용한다', async () => {
  const [worker, html, registration] = await Promise.all([
    read('service-worker.js'), read('index.html'), read('src/service-worker-registration.js'),
  ]);
  assert.match(worker, /APP_BUILD = '2026\.08\.07-stability-v25'/);
  assert.match(worker, /navigationNetworkFirst/);
  assert.match(worker, /sameOriginNetworkFirst/);
  assert.match(html, /data-app-build="2026\.08\.07-stability-v25"/);
  assert.match(html, /앱 버전 v25/);
  assert.match(registration, /getRegistrations/);
  assert.match(registration, /caches\.keys/);
  assert.match(registration, /updateViaCache: 'none'/);
});

test('3단계: 보관·복원 UI는 category feature와 app data source가 소유한다', async () => {
  const [html, category, dataSource] = await Promise.all([
    read('index.html'), read('src/category-feature.js'), read('src/app-data-source.js'),
  ]);
  assert.doesNotMatch(html, /category-ui-patch\.js/);
  assert.doesNotMatch(html, /category-bulk-editor\.js/);
  assert.doesNotMatch(category, /name="hours"|기본 주간 예산/);
  assert.match(category, /onArchive/);
  assert.match(category, /onRestore/);
  assert.match(dataSource, /archiveCategory/);
  assert.match(dataSource, /restoreCategory/);
  await assert.rejects(access(new URL('../src/category-ui-patch.js', import.meta.url)));
});

test('4단계: 활성·보관 대분류 조회는 공통 데이터 소스에서 함께 수행한다', async () => {
  const [app, dataSource] = await Promise.all([read('src/app.js'), read('src/app-data-source.js')]);
  assert.match(dataSource, /archivedCategories/);
  assert.match(app, /archivedCategories/);
  assert.match(app, /allKnownCategories/);
});

test('5단계: 중복 데이터 갱신은 공유 promise와 후속 재조회로 합쳐진다', async () => {
  const app = await read('src/app.js');
  assert.match(app, /loadingPromise/);
  assert.match(app, /reloadRequested/);
  assert.match(app, /do \{[\s\S]*performLoadData\(\)[\s\S]*\} while \(reloadRequested/);
});

test('6단계: 모바일 메뉴 접근성과 사용자 전환 초기화를 회귀 보호한다', async () => {
  const [html, shell, app] = await Promise.all([read('index.html'), read('src/app-shell.js'), read('src/app.js')]);
  assert.match(html, /aria-controls="app-navigation"/);
  assert.match(shell, /aria-expanded/);
  assert.match(app, /state\.archivedCategories = \[\]/);
  assert.match(app, /loadingPromise = null/);
});
