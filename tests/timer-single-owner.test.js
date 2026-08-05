import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('지속 타이머만 타이머 버튼과 상태를 소유한다', async () => {
  const [recordFeature, timerUi] = await Promise.all([
    read('src/record-feature.js'),
    read('src/persistent-timer-ui.js'),
  ]);

  assert.doesNotMatch(recordFeature, /function timerForm\(/);
  assert.doesNotMatch(recordFeature, /function bindTimer\(/);
  assert.doesNotMatch(recordFeature, /id="timer-action"/);
  assert.doesNotMatch(recordFeature, /setInterval\(/);
  assert.match(recordFeature, /data-persistent-timer-host/);

  assert.match(timerUi, /id="timer-action"/);
  assert.match(timerUi, /data-timer-mode="countdown"/);
  assert.match(timerUi, /data-timer-mode="countup"/);
});
