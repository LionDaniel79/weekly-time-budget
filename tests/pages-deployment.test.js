import test from 'node:test';
import assert from 'node:assert/strict';
import { access, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  REQUIRED_FIREBASE_VARIABLES,
  createFirebaseConfigSource,
  preparePagesSite,
} from '../scripts/prepare-pages-site.mjs';

const completeEnv = {
  FIREBASE_API_KEY: 'test-api-key',
  FIREBASE_AUTH_DOMAIN: 'test-project.firebaseapp.com',
  FIREBASE_PROJECT_ID: 'test-project',
  FIREBASE_STORAGE_BUCKET: 'test-project.firebasestorage.app',
  FIREBASE_MESSAGING_SENDER_ID: '123456789',
  FIREBASE_APP_ID: '1:123456789:web:abcdef',
  FIREBASE_MEASUREMENT_ID: 'G-TEST123',
};

async function exists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

test('Firebase 필수 변수 목록은 여섯 값을 고정한다', () => {
  assert.deepEqual(REQUIRED_FIREBASE_VARIABLES, [
    'FIREBASE_API_KEY',
    'FIREBASE_AUTH_DOMAIN',
    'FIREBASE_PROJECT_ID',
    'FIREBASE_STORAGE_BUCKET',
    'FIREBASE_MESSAGING_SENDER_ID',
    'FIREBASE_APP_ID',
  ]);
});

test('Firebase 설정 모듈은 저장소 변수 값을 유효한 ES 모듈로 만든다', () => {
  const source = createFirebaseConfigSource(completeEnv);
  assert.match(source, /^export const firebaseConfig = /);
  assert.match(source, /"apiKey": "test-api-key"/);
  assert.match(source, /"measurementId": "G-TEST123"/);
  assert.doesNotMatch(source, /FIREBASE_API_KEY|REPLACE_ME/);
});

test('선택적인 measurementId가 비어 있으면 설정에서 제외한다', () => {
  const source = createFirebaseConfigSource({
    ...completeEnv,
    FIREBASE_MEASUREMENT_ID: '',
  });
  assert.doesNotMatch(source, /measurementId/);
});

test('필수 Firebase 변수가 없으면 누락된 이름을 모두 표시하고 실패한다', () => {
  assert.throws(
    () => createFirebaseConfigSource({ FIREBASE_API_KEY: 'present' }),
    /FIREBASE_AUTH_DOMAIN, FIREBASE_PROJECT_ID, FIREBASE_STORAGE_BUCKET, FIREBASE_MESSAGING_SENDER_ID, FIREBASE_APP_ID/,
  );
});

test('Pages 준비는 실행 파일만 _site에 복사하고 배포 설정을 생성한다', async () => {
  const rootDir = await mkdtemp(path.join(tmpdir(), 'weekly-time-budget-pages-'));
  const outputDir = path.join(rootDir, '_site');
  await mkdir(path.join(rootDir, 'src'), { recursive: true });
  await mkdir(path.join(rootDir, 'tests'), { recursive: true });
  await mkdir(path.join(rootDir, 'docs'), { recursive: true });
  await mkdir(path.join(rootDir, '.github'), { recursive: true });
  await writeFile(path.join(rootDir, 'index.html'), '<link rel="stylesheet" href="./styles.css"><script type="module" src="./src/app.js"></script>');
  await writeFile(path.join(rootDir, 'styles.css'), 'body{}');
  await writeFile(path.join(rootDir, 'src', 'app.js'), "import { firebaseConfig } from '../firebase-config.js';");
  await writeFile(path.join(rootDir, 'firebase-config.js'), 'export const firebaseConfig = { apiKey: "REPLACE_ME" };');
  await writeFile(path.join(rootDir, 'tests', 'not-deployed.test.js'), 'not deployed');
  await writeFile(path.join(rootDir, 'docs', 'design.md'), 'not deployed');
  await writeFile(path.join(rootDir, '.github', 'workflow.yml'), 'not deployed');
  await writeFile(path.join(rootDir, 'package.json'), '{}');
  await writeFile(path.join(rootDir, 'firestore.rules'), 'not deployed');

  const result = await preparePagesSite({ rootDir, outputDir, env: completeEnv });

  assert.equal(result, outputDir);
  for (const relativePath of ['index.html', 'styles.css', 'src/app.js', 'firebase-config.js', '.nojekyll']) {
    assert.equal(await exists(path.join(outputDir, relativePath)), true, `${relativePath} should exist`);
  }
  for (const relativePath of ['tests', 'docs', '.github', 'package.json', 'firestore.rules']) {
    assert.equal(await exists(path.join(outputDir, relativePath)), false, `${relativePath} should not exist`);
  }

  const deployedConfig = await readFile(path.join(outputDir, 'firebase-config.js'), 'utf8');
  assert.match(deployedConfig, /"apiKey": "test-api-key"/);
  assert.doesNotMatch(deployedConfig, /REPLACE_ME/);
});

test('Pages 준비는 이전 _site 내용을 삭제해 오래된 파일을 남기지 않는다', async () => {
  const rootDir = await mkdtemp(path.join(tmpdir(), 'weekly-time-budget-pages-clean-'));
  const outputDir = path.join(rootDir, '_site');
  await mkdir(path.join(rootDir, 'src'), { recursive: true });
  await mkdir(outputDir, { recursive: true });
  await writeFile(path.join(rootDir, 'index.html'), '<main>app</main>');
  await writeFile(path.join(rootDir, 'styles.css'), 'body{}');
  await writeFile(path.join(rootDir, 'src', 'app.js'), 'export {};');
  await writeFile(path.join(outputDir, 'obsolete.js'), 'old');

  await preparePagesSite({ rootDir, outputDir, env: completeEnv });

  assert.equal(await exists(path.join(outputDir, 'obsolete.js')), false);
});

test('운영 HTML은 저장소 하위 경로에서 동작하도록 루트 절대경로를 사용하지 않는다', async () => {
  const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  assert.doesNotMatch(html, /(?:src|href)=["']\/(?!\/)/);
});
