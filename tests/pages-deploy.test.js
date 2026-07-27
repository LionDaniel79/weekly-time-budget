import test from 'node:test';
import assert from 'node:assert/strict';
import { access, mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { preparePagesSite } from '../scripts/prepare-pages-site.mjs';

const rootDir = path.dirname(fileURLToPath(new URL('../package.json', import.meta.url)));
const testFirebaseEnv = {
  FIREBASE_API_KEY: 'test-api-key',
  FIREBASE_AUTH_DOMAIN: 'test.firebaseapp.com',
  FIREBASE_PROJECT_ID: 'test-project',
  FIREBASE_STORAGE_BUCKET: 'test.firebasestorage.app',
  FIREBASE_MESSAGING_SENDER_ID: '123456789',
  FIREBASE_APP_ID: '1:123456789:web:test',
};

test('Pages 산출물에 오프라인 실행 파일이 모두 포함된다', async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'weekly-time-budget-pages-'));
  const outputDir = path.join(tempRoot, '_site');
  try {
    await preparePagesSite({ rootDir, outputDir, env: testFirebaseEnv });
    for (const file of [
      'index.html',
      'service-worker.js',
      'src/offline-entry-domain.js',
      'src/offline-store.js',
      'src/offline-entry-repository.js',
      'src/offline-sync.js',
      'src/offline-runtime.js',
      'src/app-toast.js',
      'src/ui-session-state.js',
      'src/service-worker-cache.js',
      'src/service-worker-registration.js',
      'src/statistics-session-state.js',
    ]) await access(path.join(outputDir, file));

    const html = await readFile(path.join(outputDir, 'index.html'), 'utf8');
    assert.ok(html.includes('./src/service-worker-registration.js'));
    assert.ok(html.includes('./src/statistics-session-state.js'));
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});
