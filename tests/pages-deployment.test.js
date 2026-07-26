import test from 'node:test';
import assert from 'node:assert/strict';
import { access, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  REQUIRED_FIREBASE_VARIABLES,
  createFirebaseConfigSource,
  materializeWebAppIcons,
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

function pngSize(buffer) {
  const signature = buffer.subarray(0, 8).toString('hex');
  assert.equal(signature, '89504e470d0a1a0a');
  return {
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20),
  };
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
  await writeFile(path.join(rootDir, 'manifest.webmanifest'), '{"start_url":"./"}');
  await writeFile(path.join(rootDir, 'firebase-config.js'), 'export const firebaseConfig = { apiKey: "REPLACE_ME" };');
  await writeFile(path.join(rootDir, 'tests', 'not-deployed.test.js'), 'not deployed');
  await writeFile(path.join(rootDir, 'docs', 'design.md'), 'not deployed');
  await writeFile(path.join(rootDir, '.github', 'workflow.yml'), 'not deployed');
  await writeFile(path.join(rootDir, 'package.json'), '{}');
  await writeFile(path.join(rootDir, 'firestore.rules'), 'not deployed');

  const result = await preparePagesSite({ rootDir, outputDir, env: completeEnv });

  assert.equal(result, outputDir);
  for (const relativePath of [
    'index.html',
    'styles.css',
    'src/app.js',
    'firebase-config.js',
    'manifest.webmanifest',
    'icons/apple-touch-icon.png',
    'icons/icon-192.png',
    'icons/icon-512.png',
    '.nojekyll',
  ]) {
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
  await writeFile(path.join(rootDir, 'manifest.webmanifest'), '{}');
  await writeFile(path.join(outputDir, 'obsolete.js'), 'old');

  await preparePagesSite({ rootDir, outputDir, env: completeEnv });

  assert.equal(await exists(path.join(outputDir, 'obsolete.js')), false);
});

test('운영 HTML은 저장소 하위 경로에서 동작하도록 루트 절대경로를 사용하지 않는다', async () => {
  const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  assert.doesNotMatch(html, /(?:src|href)=["']\/(?!\/)/);
});

test('운영 HTML은 아이폰 아이콘과 웹앱 manifest를 상대 경로로 연결한다', async () => {
  const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  assert.match(html, /rel="apple-touch-icon"/);
  assert.match(html, /sizes="180x180"/);
  assert.match(html, /href="\.\/icons\/apple-touch-icon\.png"/);
  assert.match(html, /rel="manifest" href="\.\/manifest\.webmanifest"/);
  assert.match(html, /name="apple-mobile-web-app-title" content="주간 시간 예산"/);
});

test('웹앱 manifest는 GitHub Pages 하위 경로에서 독립 실행되도록 설정한다', async () => {
  const manifest = JSON.parse(await readFile(new URL('../manifest.webmanifest', import.meta.url), 'utf8'));
  assert.equal(manifest.name, '주간 시간 예산');
  assert.equal(manifest.short_name, '시간 예산');
  assert.equal(manifest.start_url, './');
  assert.equal(manifest.scope, './');
  assert.equal(manifest.display, 'standalone');
  assert.deepEqual(
    manifest.icons.map(({ src, sizes, type }) => ({ src, sizes, type })),
    [
      { src: './icons/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: './icons/icon-512.png', sizes: '512x512', type: 'image/png' },
    ],
  );
});

test('웹앱 아이콘 세 개는 이름에 맞는 정사각형 PNG로 생성된다', async () => {
  const outputDir = await mkdtemp(path.join(tmpdir(), 'weekly-time-budget-icons-'));
  await materializeWebAppIcons({ outputDir });

  const expected = new Map([
    ['apple-touch-icon.png', 180],
    ['icon-192.png', 192],
    ['icon-512.png', 512],
  ]);

  for (const [filename, size] of expected) {
    const buffer = await readFile(path.join(outputDir, filename));
    assert.deepEqual(pngSize(buffer), { width: size, height: size }, filename);
    assert.ok(buffer.length > 1000, `${filename} should contain rendered artwork`);
  }
});
