import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('공통 절제 이름을 기록·예산·타이머·보관 화면에서 사용한다', async () => {
  const files = await Promise.all([
    read('src/app.js'),
    read('src/time-budget-ui.js'),
    read('src/persistent-timer-ui.js'),
    read('src/category-ui-patch.js'),
  ]);
  files.forEach((source) => assert.ok(source.includes('categoryDisplayName')));
});

test('모든 새 기록은 목표 방식 스냅샷을 저장한다', async () => {
  const [app, timer] = await Promise.all([read('src/app.js'), read('src/persistent-timer-ui.js')]);
  assert.match(app, /normalizedEntry[\s\S]*goalType: normalizeGoalType/);
  assert.match(timer, /source: 'timer',[\s\S]*goalType: normalizeGoalType/);
});

test('대시보드는 목표 준수 점수와 절제 진행 막대를 표시한다', async () => {
  const [ui, app, css] = await Promise.all([read('src/time-budget-ui.js'), read('src/app.js'), read('styles.css')]);
  assert.ok(ui.includes('목표 준수'));
  assert.ok(ui.includes('goalComplianceScore'));
  assert.ok(app.includes('목표 준수'));
  assert.ok(ui.includes('restraint-remaining'));
  assert.ok(ui.includes('restraint-overage'));
  assert.ok(css.includes('.restraint-remaining'));
  assert.ok(css.includes('.restraint-overage'));
});

test('온라인과 오프라인 통계는 목표 준수와 절제 상태를 지원한다', async () => {
  const [online, offline] = await Promise.all([read('src/statistics-ui.js'), read('src/statistics-offline-rescue.js')]);
  for (const source of [online, offline]) {
    assert.ok(source.includes('목표 준수'));
    assert.ok(source.includes('goalComplianceScore'));
    assert.ok(source.includes('달성률 계산 제외'));
  }
  assert.ok(online.includes('restraint-remaining'));
  assert.ok(online.includes('restraint-overage'));
});

test('절제 카운트다운 음수는 경고색과 초과 사용 문구를 사용한다', async () => {
  const source = await read('src/persistent-timer-ui.js');
  assert.ok(source.includes('is-restraint-overage'));
  assert.ok(source.includes('초과 사용시간'));
  assert.doesNotMatch(source, /AudioContext|new Audio|\.vibrate\(|Notification\(/);
});

test('PWA 앱 셸 v9에 목표 계산 모듈을 포함한다', async () => {
  const worker = await read('service-worker.js');
  assert.ok(worker.includes('weekly-time-budget-shell-v9'));
  assert.ok(worker.includes('./src/goal-domain.js'));
});
