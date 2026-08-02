import test from 'node:test';
import assert from 'node:assert/strict';
import { access, mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { preparePagesSite } from '../scripts/prepare-pages-site.mjs';

const rootDir = path.dirname(fileURLToPath(new URL('../package.json', import.meta.url)));
const testFirebaseEnv = {
  FIREBASE_API_KEY: 'test-api-key', FIREBASE_AUTH_DOMAIN: 'test.firebaseapp.com',
  FIREBASE_PROJECT_ID: 'test-project', FIREBASE_STORAGE_BUCKET: 'test.firebasestorage.app',
  FIREBASE_MESSAGING_SENDER_ID: '123456789', FIREBASE_APP_ID: '1:123456789:web:test',
};

async function exists(file) {
  try { await access(file); return true; } catch { return false; }
}

test('Pages 산출물에 새 통계와 오프라인 실행 파일만 포함된다', async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'weekly-time-budget-pages-'));
  const outputDir = path.join(tempRoot, '_site');
  try {
    await preparePagesSite({ rootDir, outputDir, env: testFirebaseEnv });
    for (const file of [
      'index.html', 'service-worker.js', 'src/offline-entry-domain.js', 'src/offline-store.js',
      'src/offline-entry-repository.js', 'src/offline-sync.js', 'src/offline-runtime.js',
      'src/app-toast.js', 'src/ui-session-state.js', 'src/service-worker-cache.js',
      'src/service-worker-registration.js', 'src/statistics-state.js',
      'src/statistics-data-source.js', 'src/statistics-view.js', 'src/statistics-feature.js',
      'src/statistics-bootstrap.js', 'src/statistics-primary.css', 'src/view-change-events.js',
    ]) await access(path.join(outputDir, file));

    for (const file of [
      'src/statistics-offline-rescue.js', 'src/statistics-ui.js',
      'src/statistics-session-state.js', 'src/statistics-mobile-overflow.js',
    ]) assert.equal(await exists(path.join(outputDir, file)), false, file);

    const html = await readFile(path.join(outputDir, 'index.html'), 'utf8');
    assert.ok(html.includes('./src/statistics-bootstrap.js'));
    assert.ok(html.includes('./src/statistics-primary.css'));
    assert.doesNotMatch(html, /statistics-offline-rescue|statistics-ui|statistics-session-state|statistics-mobile-overflow/);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});
