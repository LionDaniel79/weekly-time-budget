import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import {
  MANUAL_DURATION_ERROR,
  MANUAL_INPUT_MODES,
  createManualDurationEntry,
  manualEntryTimeLabel,
  parseManualDurationMinutes,
} from '../src/manual-entry.js';

const formatMinutes = (minutes) => `${minutes}분`;

test('manual modes expose time-range and duration values', () => {
  assert.deepEqual(MANUAL_INPUT_MODES, {
    TIME_RANGE: 'time-range',
    DURATION: 'duration',
  });
});

test('direct minutes accept inclusive integer boundaries', () => {
  assert.equal(parseManualDurationMinutes('1'), 1);
  assert.equal(parseManualDurationMinutes('30'), 30);
  assert.equal(parseManualDurationMinutes('1440'), 1440);
});

test('direct minutes reject invalid values with one message', () => {
  for (const value of ['', '0', '-1', '1.5', '1441', 'abc', null, undefined]) {
    assert.throws(
      () => parseManualDurationMinutes(value),
      (error) => error instanceof RangeError && error.message === MANUAL_DURATION_ERROR,
    );
  }
});

test('direct payload omits start and end times', () => {
  assert.deepEqual(
    createManualDurationEntry({
      categoryId: 'reading',
      date: '2026-07-26',
      note: '  chapter 3  ',
      durationMinutes: '45',
    }),
    {
      categoryId: 'reading',
      date: '2026-07-26',
      note: 'chapter 3',
      durationMinutes: 45,
      source: 'manual-duration',
    },
  );
});

test('history label covers direct, timed, and legacy records', () => {
  assert.equal(
    manualEntryTimeLabel({ source: 'manual-duration', durationMinutes: 30 }, formatMinutes),
    '직접 입력 · 30분',
  );
  assert.equal(
    manualEntryTimeLabel(
      { startTime: '09:00', endTime: '10:00', durationMinutes: 60 },
      formatMinutes,
    ),
    '09:00–10:00 · 60분',
  );
  assert.equal(manualEntryTimeLabel({ durationMinutes: 15 }, formatMinutes), '15분');
});

test('manual duration controls stay within the mobile viewport', async () => {
  const css = await readFile(new URL('../styles.css', import.meta.url), 'utf8');
  assert.match(css, /\.manual-mode-switch\s*\{[^}]*display\s*:\s*grid/s);
  assert.match(css, /\.manual-mode-switch\s*\{[^}]*grid-template-columns\s*:\s*repeat\(2,minmax\(0,1fr\)\)/s);
  assert.match(css, /\.manual-mode-switch \.tab-button\s*\{[^}]*min-width\s*:\s*0/s);
  assert.match(css, /\.duration-input-row\s*\{[^}]*display\s*:\s*grid/s);
  assert.match(css, /\.duration-input-row\s*\{[^}]*grid-template-columns\s*:\s*minmax\(0,1fr\) auto/s);
  assert.match(css, /@media\(max-width:360px\)/);
});

test('manual entry JavaScript files have valid syntax', () => {
  for (const relativePath of ['../src/manual-entry.js', '../src/app.js']) {
    const path = fileURLToPath(new URL(relativePath, import.meta.url));
    const result = spawnSync(process.execPath, ['--check', path], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr || result.stdout);
  }
});
