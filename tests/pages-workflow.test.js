import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const workflowUrl = new URL('../.github/workflows/deploy-pages.yml', import.meta.url);

async function workflow() {
  return readFile(workflowUrl, 'utf8');
}

test('Pages workflow는 main push와 수동 실행만 배포 트리거로 사용한다', async () => {
  const source = await workflow();
  assert.match(source, /push:\s*\n\s*branches:\s*\[main\]/);
  assert.match(source, /workflow_dispatch:/);
  assert.doesNotMatch(source, /pull_request:/);
});

test('Pages workflow는 최소 권한과 동시 실행 제어를 선언한다', async () => {
  const source = await workflow();
  assert.match(source, /contents:\s*read/);
  assert.match(source, /pages:\s*write/);
  assert.match(source, /id-token:\s*write/);
  assert.match(source, /group:\s*pages/);
  assert.match(source, /cancel-in-progress:\s*false/);
});

test('Pages workflow는 테스트 후 Firebase 변수로 _site를 준비한다', async () => {
  const source = await workflow();
  assert.match(source, /run:\s*npm test/);
  assert.match(source, /run:\s*npm run prepare:pages/);
  for (const name of [
    'FIREBASE_API_KEY',
    'FIREBASE_AUTH_DOMAIN',
    'FIREBASE_PROJECT_ID',
    'FIREBASE_STORAGE_BUCKET',
    'FIREBASE_MESSAGING_SENDER_ID',
    'FIREBASE_APP_ID',
    'FIREBASE_MEASUREMENT_ID',
  ]) {
    const expected = `${name}: \${{ vars.${name} }}`;
    assert.equal(source.includes(expected), true, `${expected} should exist`);
  }
});

test('Pages workflow는 공식 Pages actions로 _site만 배포한다', async () => {
  const source = await workflow();
  assert.match(source, /actions\/configure-pages@v5/);
  assert.match(source, /actions\/upload-pages-artifact@v3/);
  assert.match(source, /path:\s*_site/);
  assert.match(source, /actions\/deploy-pages@v4/);
  assert.match(source, /environment:\s*\n\s*name:\s*github-pages/);
});
