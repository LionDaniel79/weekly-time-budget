import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('대분류 일괄 적용 버튼은 저장으로 표시한다', async () => {
  const source = await read('src/category-bulk-editor.js');
  assert.ok(source.includes('<button id="category-bulk-apply" type="button" class="primary-button">저장</button>'));
  assert.ok(!source.includes('>대분류 변경사항 적용</button>'));
});

test('PWA 셸 캐시는 최신 화면을 사용한다', async () => {
  const source = await read('service-worker.js');
  assert.ok(source.includes("const APP_BUILD = '2026.08.07-stability-v25';"));
  assert.ok(source.includes('navigationNetworkFirst'));
  assert.ok(source.includes('sameOriginNetworkFirst'));
  assert.ok(source.includes('./src/countdown-timer-domain.js'));
  assert.ok(source.includes('./src/previous-results-budget-migration.js'));
});
