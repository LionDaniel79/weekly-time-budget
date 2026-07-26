import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('신규 모듈과 연결 파일은 올바른 자바스크립트 문법이다', () => {
  for (const relative of [
    '../src/app.js',
    '../src/time-budget-domain.js',
    '../src/time-budget-ui.js',
    '../src/persistent-timer.js',
    '../src/category-delete-guard.js',
  ]) {
    const path = fileURLToPath(new URL(relative, import.meta.url));
    const result = spawnSync(process.execPath, ['--check', path], { encoding: 'utf8' });
    assert.equal(result.status, 0, `${relative}: ${result.stderr || result.stdout}`);
  }
});

test('메뉴와 페이지 제목은 시간 예산으로 변경된다', async () => {
  const [html, app] = await Promise.all([read('index.html'), read('src/app.js')]);
  assert.match(html, /data-view="budget"[^>]*>시간 예산</);
  assert.match(app, /budget:\s*'시간 예산'/);
});

test('앱은 일간·주간 예산 문서와 기본 비율을 읽고 저장한다', async () => {
  const app = await read('src/app.js');
  for (const token of ['weeklyBudgets', 'dailyBudgets', "'settings', 'timeBudget'", 'defaultDayWeights', 'explicitBudgetIds']) {
    assert.match(app, new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
  assert.match(app, /async function saveDailyBudgetOverrides/);
  assert.match(app, /async function saveCurrentWeekBudget/);
  assert.match(app, /writeBatch/);
  const start = app.indexOf('async function saveCurrentWeekBudget');
  const end = app.indexOf('async function', start + 30);
  assert.doesNotMatch(app.slice(start, end), /dailyBudgets/);
});

test('타이머는 Firestore와 localStorage에서 복구하고 절대 시각으로 표시한다', async () => {
  const app = await read('src/app.js');
  for (const token of ['activeTimer', 'localStorage', 'createPersistentTimerController', 'visibilitychange', 'timer-${Math.round(timer.startedAt)}']) {
    assert.match(app, new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
  assert.match(app, /batch\.delete\(activeRef\)/);
});

test('완전 삭제는 일간·주간 예산과 진행 중 타이머 참조를 정리한다', async () => {
  const source = await read('src/category-delete-guard.js');
  for (const token of ['weeklyBudgets', 'dailyBudgets', 'explicitBudgetIds', 'overrides', 'activeTimer', 'categoryId']) {
    assert.match(source, new RegExp(token));
  }
});

test('신규 경로는 사용자 하위 wildcard 보안 규칙으로 보호된다', async () => {
  const rules = await read('firestore.rules');
  assert.match(rules, /match \/users\/\{userId\}\/\{document=\*\*\}/);
  assert.match(rules, /request\.auth\.uid == userId/);
});

test('화면 폭 선택 버튼 없이 적응형 화면을 사용한다', async () => {
  const [css, html, ui] = await Promise.all([read('styles.css'), read('index.html'), read('src/time-budget-ui.js')]);
  assert.doesNotMatch(html + ui, /넓은 화면|모바일 화면/);
  for (const token of ['.time-budget-tabs', '.dashboard-tabs', '.day-weight-grid', '.record-calendar', 'minmax(0,1fr)', '@media(max-width:600px)']) {
    assert.match(css.replace(/\s+/g, ''), new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\\ /g, '')));
  }
});
