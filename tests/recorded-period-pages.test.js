import test from 'node:test';
import assert from 'node:assert/strict';
import { access, mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { preparePagesSite } from '../scripts/prepare-pages-site.mjs';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const env = {
  FIREBASE_API_KEY: 'test-api-key',
  FIREBASE_AUTH_DOMAIN: 'test.firebaseapp.com',
  FIREBASE_PROJECT_ID: 'test-project',
  FIREBASE_STORAGE_BUCKET: 'test.firebasestorage.app',
  FIREBASE_MESSAGING_SENDER_ID: '123456789',
  FIREBASE_APP_ID: '1:123456789:web:test',
};

test('Pages 산출물에 기록 기간 도메인과 화면 연결 모듈이 포함된다', async () => {
  const outputDir = await mkdtemp(path.join(tmpdir(), 'recorded-period-pages-'));
  await preparePagesSite({ rootDir, outputDir, env });
  await access(path.join(outputDir, 'src', 'recorded-period-domain.js'));
  await access(path.join(outputDir, 'src', 'recorded-period-navigation.js'));
  const serviceWorker = await readFile(path.join(outputDir, 'service-worker.js'), 'utf8');
  assert.ok(serviceWorker.includes('weekly-time-budget-shell-v6'));
  assert.ok(serviceWorker.includes('./src/recorded-period-domain.js'));
  assert.ok(serviceWorker.includes('./src/recorded-period-navigation.js'));
});
